// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IFeeExposureControllerView {
    function LANE_COUNT() external view returns (uint256);
    function bondVault() external view returns (address);
    function registry() external view returns (address);
    function rosterHash() external view returns (bytes32);
    function lanes(uint256 index) external view returns (address);
    function laneIds(uint256 index) external view returns (bytes32);
    function settlementLane(bytes32 settlementId) external view returns (address);
}

interface IFeeRosterRewardIndexView {
    function rewardIndex() external view returns (address);
    function workRecorder() external view returns (address);
}

interface IFeeEpochRewardIndex {
    function bondVault() external view returns (address);
    function treasury() external view returns (address);
    function rewardAssets(uint256 index) external view returns (address);
    function creditBondRisk(bytes32 rosterHash, address asset, uint256 amount) external returns (uint256);
}

interface IFeeWorkRecorderView {
    function workRewardIndex() external view returns (address);
    function exposureController() external view returns (address);
    function rosterHash() external view returns (bytes32);
    function epochStartBlock() external view returns (uint256);
    function epochEndBlock() external view returns (uint256);
    function finalized() external view returns (bool);
}

interface IFeeWorkRewardIndexView {
    function treasury() external view returns (address);
    function workRecorder() external view returns (address);
}

/// @notice Research-only custody and accounting for confirmed bridge fees and bootstrap security funds.
/// @dev This contract never receives bridge principal and deliberately exposes no claim, withdrawal,
///      rescue, sweep, owner, administrator or upgrade function.
contract AttestorFeeRewardTreasuryV1 {
    uint256 public constant LANE_COUNT = 2;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct FeePolicy {
        uint256 attestorBps;
        uint256 safetyBps;
        uint256 relayerBps;
        uint256 operationsBps;
        uint256 readinessBps;
        uint256 participationBps;
        uint256 bondRiskBps;
    }

    struct AssetLedger {
        uint256 minimumEpochSecurityBudget;
        uint256 minimumRunwayEpochs;
        uint256 totalProtocolFees;
        uint256 attestorRewardPool;
        uint256 readinessRewardPool;
        uint256 participationRewardPool;
        uint256 bondRiskRewardPool;
        uint256 safetyReserve;
        uint256 relayerBudget;
        uint256 operationsBudget;
        uint256 bootstrapSecurityFunds;
        bool configured;
    }

    struct FeeAllocation {
        uint256 attestor;
        uint256 readiness;
        uint256 participation;
        uint256 bondRisk;
        uint256 safety;
        uint256 relayer;
        uint256 operations;
    }

    IFeeExposureControllerView public immutable exposureController;
    IFeeEpochRewardIndex public immutable rewardIndex;
    bytes32 public immutable rosterHash;
    FeePolicy public feePolicy;
    address public workRewardIndex;
    address public workRecorder;

    address[LANE_COUNT] public lanes;
    bytes32[LANE_COUNT] public laneIds;
    address[LANE_COUNT] public assets;
    mapping(address => bool) public authorizedLane;
    mapping(address => address) public laneAsset;
    mapping(address => AssetLedger) public assetLedgers;
    mapping(bytes32 => bool) public feeSettlementConsumed;
    mapping(address => uint256) public epochReadinessRewardPool;
    mapping(address => uint256) public epochParticipationRewardPool;
    mapping(address => bool) public workRewardsConsumed;

    uint256 private entered;

    error InvalidController();
    error InvalidRewardIndex();
    error InvalidLane(uint256 index);
    error InvalidLaneId(uint256 index);
    error InvalidAsset(uint256 index);
    error DuplicateLane(address lane);
    error DuplicateAsset(address asset);
    error InvalidFeePolicy();
    error InvalidRunwayPolicy(uint256 index);
    error UnauthorizedLane();
    error ZeroIdentity();
    error ZeroAmount();
    error SettlementNotConfirmedForLane();
    error FeeAlreadyCollected();
    error AssetNotConfigured();
    error TokenBalanceQueryFailed();
    error TransferFailed();
    error IncorrectReceivedAmount(uint256 expected, uint256 received);
    error ReentrantCall();
    error WorkRewardIndexAlreadyRegistered();
    error InvalidWorkRewardIndex();
    error WorkRewardRegistrationTooLate();
    error UnauthorizedWorkRewardIndex();
    error WorkEpochNotFinalized();
    error WorkRewardsAlreadyConsumed();

    event ConfirmedFeeCollected(
        bytes32 indexed rosterHash,
        bytes32 indexed laneId,
        bytes32 indexed settlementId,
        address asset,
        uint256 feeAmount,
        uint256 attestorAmount,
        uint256 safetyAmount,
        uint256 relayerAmount,
        uint256 operationsAmount
    );
    event BootstrapSecurityFunded(address indexed asset, address indexed contributor, uint256 amount);
    event WorkRewardIndexRegistered(address indexed workRecorder, address indexed workRewardIndex);
    event FinalizedWorkRewardsConsumed(
        address indexed asset,
        address indexed workRecorder,
        uint256 readinessAmount,
        uint256 participationAmount
    );

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(
        address controllerAddress,
        address rewardIndexAddress,
        address[LANE_COUNT] memory assets_,
        uint256[LANE_COUNT] memory minimumEpochSecurityBudgets,
        uint256[LANE_COUNT] memory minimumRunwayEpochs_,
        FeePolicy memory policy
    ) {
        if (controllerAddress == address(0) || controllerAddress.code.length == 0) {
            revert InvalidController();
        }
        IFeeExposureControllerView controller = IFeeExposureControllerView(controllerAddress);
        if (controller.LANE_COUNT() != LANE_COUNT) revert InvalidController();
        if (rewardIndexAddress == address(0) || rewardIndexAddress.code.length == 0) {
            revert InvalidRewardIndex();
        }
        IFeeEpochRewardIndex rewardIndex_ = IFeeEpochRewardIndex(rewardIndexAddress);
        if (
            rewardIndex_.treasury() != address(this) ||
            rewardIndex_.bondVault() != controller.bondVault() ||
            IFeeRosterRewardIndexView(controller.registry()).rewardIndex() != rewardIndexAddress
        ) {
            revert InvalidRewardIndex();
        }
        if (
            policy.attestorBps == 0 ||
            policy.safetyBps == 0 ||
            policy.relayerBps == 0 ||
            policy.operationsBps == 0 ||
            policy.attestorBps + policy.safetyBps + policy.relayerBps + policy.operationsBps !=
                BPS_DENOMINATOR ||
            policy.readinessBps == 0 ||
            policy.participationBps == 0 ||
            policy.bondRiskBps == 0 ||
            policy.readinessBps + policy.participationBps + policy.bondRiskBps != BPS_DENOMINATOR
        ) revert InvalidFeePolicy();

        exposureController = controller;
        rewardIndex = rewardIndex_;
        rosterHash = controller.rosterHash();
        feePolicy = policy;
        for (uint256 i = 0; i < LANE_COUNT; ++i) {
            address lane = controller.lanes(i);
            bytes32 laneId = controller.laneIds(i);
            address asset = assets_[i];
            if (lane == address(0) || lane.code.length == 0 || lane == address(this)) revert InvalidLane(i);
            if (laneId == bytes32(0)) revert InvalidLaneId(i);
            if (asset == address(0) || asset.code.length == 0) revert InvalidAsset(i);
            if (rewardIndex_.rewardAssets(i) != asset) revert InvalidRewardIndex();
            if (minimumEpochSecurityBudgets[i] == 0 || minimumRunwayEpochs_[i] == 0) {
                revert InvalidRunwayPolicy(i);
            }
            for (uint256 j = 0; j < i; ++j) {
                if (lanes[j] == lane) revert DuplicateLane(lane);
                if (assets[j] == asset) revert DuplicateAsset(asset);
            }
            lanes[i] = lane;
            laneIds[i] = laneId;
            assets[i] = asset;
            authorizedLane[lane] = true;
            laneAsset[lane] = asset;
            assetLedgers[asset].minimumEpochSecurityBudget = minimumEpochSecurityBudgets[i];
            assetLedgers[asset].minimumRunwayEpochs = minimumRunwayEpochs_[i];
            assetLedgers[asset].configured = true;
        }
    }

    function collectConfirmedFee(bytes32 settlementId, uint256 feeAmount) external nonReentrant {
        if (!authorizedLane[msg.sender]) revert UnauthorizedLane();
        if (settlementId == bytes32(0)) revert ZeroIdentity();
        if (feeAmount == 0) revert ZeroAmount();
        if (exposureController.settlementLane(settlementId) != msg.sender) {
            revert SettlementNotConfirmedForLane();
        }
        if (feeSettlementConsumed[settlementId]) revert FeeAlreadyCollected();

        address asset = laneAsset[msg.sender];
        uint256 beforeBalance = tokenBalance(asset);
        safeTransferFrom(asset, msg.sender, address(this), feeAmount);
        uint256 afterBalance = tokenBalance(asset);
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != feeAmount) revert IncorrectReceivedAmount(feeAmount, received);

        feeSettlementConsumed[settlementId] = true;
        FeeAllocation memory allocation = creditFee(asset, feeAmount);
        if (workRewardIndex != address(0)) {
            IFeeWorkRecorderView recorder = IFeeWorkRecorderView(workRecorder);
            if (block.number >= recorder.epochStartBlock() && block.number <= recorder.epochEndBlock()) {
                epochReadinessRewardPool[asset] += allocation.readiness;
                epochParticipationRewardPool[asset] += allocation.participation;
            }
        }
        if (allocation.bondRisk != 0) {
            rewardIndex.creditBondRisk(rosterHash, asset, allocation.bondRisk);
        }
        emit ConfirmedFeeCollected(
            rosterHash,
            laneIdFor(msg.sender),
            settlementId,
            asset,
            feeAmount,
            allocation.attestor,
            allocation.safety,
            allocation.relayer,
            allocation.operations
        );
    }

    function registerWorkRewardIndex() external {
        if (workRewardIndex != address(0)) revert WorkRewardIndexAlreadyRegistered();
        if (msg.sender.code.length == 0) revert InvalidWorkRewardIndex();
        IFeeWorkRewardIndexView index = IFeeWorkRewardIndexView(msg.sender);
        if (index.treasury() != address(this)) revert InvalidWorkRewardIndex();
        address recorderAddress = index.workRecorder();
        if (recorderAddress == address(0) || recorderAddress.code.length == 0) {
            revert InvalidWorkRewardIndex();
        }
        IFeeWorkRecorderView recorder = IFeeWorkRecorderView(recorderAddress);
        if (
            recorder.workRewardIndex() != msg.sender ||
            recorder.exposureController() != address(exposureController) ||
            recorder.rosterHash() != rosterHash ||
            IFeeRosterRewardIndexView(exposureController.registry()).workRecorder() != recorderAddress
        ) revert InvalidWorkRewardIndex();
        if (block.number >= recorder.epochStartBlock()) revert WorkRewardRegistrationTooLate();
        workRewardIndex = msg.sender;
        workRecorder = recorderAddress;
        emit WorkRewardIndexRegistered(recorderAddress, msg.sender);
    }

    function consumeFinalizedWorkRewards(
        address asset
    ) external returns (uint256 readinessAmount, uint256 participationAmount) {
        if (msg.sender != workRewardIndex || workRewardIndex == address(0)) {
            revert UnauthorizedWorkRewardIndex();
        }
        AssetLedger storage ledger = assetLedgers[asset];
        if (!ledger.configured) revert AssetNotConfigured();
        if (!IFeeWorkRecorderView(workRecorder).finalized()) revert WorkEpochNotFinalized();
        if (workRewardsConsumed[asset]) revert WorkRewardsAlreadyConsumed();
        workRewardsConsumed[asset] = true;
        readinessAmount = epochReadinessRewardPool[asset];
        participationAmount = epochParticipationRewardPool[asset];
        emit FinalizedWorkRewardsConsumed(asset, workRecorder, readinessAmount, participationAmount);
    }

    function fundBootstrapSecurity(address asset, uint256 amount) external nonReentrant {
        AssetLedger storage ledger = assetLedgers[asset];
        if (!ledger.configured) revert AssetNotConfigured();
        if (amount == 0) revert ZeroAmount();
        uint256 beforeBalance = tokenBalance(asset);
        safeTransferFrom(asset, msg.sender, address(this), amount);
        uint256 afterBalance = tokenBalance(asset);
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert IncorrectReceivedAmount(amount, received);
        ledger.bootstrapSecurityFunds += amount;
        emit BootstrapSecurityFunded(asset, msg.sender, amount);
    }

    function securityRunwayEpochs(address asset) public view returns (uint256) {
        AssetLedger storage ledger = assetLedgers[asset];
        if (!ledger.configured) revert AssetNotConfigured();
        return (ledger.attestorRewardPool + ledger.bootstrapSecurityFunds) / ledger.minimumEpochSecurityBudget;
    }

    function securityRunwayReady(address asset) external view returns (bool) {
        AssetLedger storage ledger = assetLedgers[asset];
        if (!ledger.configured) revert AssetNotConfigured();
        return securityRunwayEpochs(asset) >= ledger.minimumRunwayEpochs;
    }

    function laneIdFor(address lane) private view returns (bytes32) {
        if (lanes[0] == lane) return laneIds[0];
        return laneIds[1];
    }

    function creditFee(address asset, uint256 feeAmount) private returns (FeeAllocation memory allocation) {
        allocation.attestor = feeAmount * feePolicy.attestorBps / BPS_DENOMINATOR;
        allocation.safety = feeAmount * feePolicy.safetyBps / BPS_DENOMINATOR;
        allocation.relayer = feeAmount * feePolicy.relayerBps / BPS_DENOMINATOR;
        allocation.operations = feeAmount - allocation.attestor - allocation.safety - allocation.relayer;
        allocation.readiness = allocation.attestor * feePolicy.readinessBps / BPS_DENOMINATOR;
        allocation.participation = allocation.attestor * feePolicy.participationBps / BPS_DENOMINATOR;
        allocation.bondRisk = allocation.attestor - allocation.readiness - allocation.participation;

        AssetLedger storage ledger = assetLedgers[asset];
        ledger.totalProtocolFees += feeAmount;
        ledger.attestorRewardPool += allocation.attestor;
        ledger.readinessRewardPool += allocation.readiness;
        ledger.participationRewardPool += allocation.participation;
        ledger.bondRiskRewardPool += allocation.bondRisk;
        ledger.safetyReserve += allocation.safety;
        ledger.relayerBudget += allocation.relayer;
        ledger.operationsBudget += allocation.operations;
    }

    function tokenBalance(address asset) private view returns (uint256 value) {
        (bool success, bytes memory data) = asset.staticcall(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        if (!success || data.length != 32) revert TokenBalanceQueryFailed();
        value = abi.decode(data, (uint256));
    }

    function safeTransferFrom(address asset, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = asset.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        if (!success) revert TransferFailed();
        if (data.length == 0) return;
        if (data.length != 32 || !abi.decode(data, (bool))) revert TransferFailed();
    }
}
