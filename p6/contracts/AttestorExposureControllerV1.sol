// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IExposureRosterView {
    function bridgeId() external view returns (bytes32);
    function epoch() external view returns (uint256);
    function bondReadiness() external view returns (address);
    function equalBondAmount() external view returns (uint256);
    function exposureCapBps() external view returns (uint256);
    function policyHash() external view returns (bytes32);
    function rosterHash() external view returns (bytes32);
    function active() external view returns (bool);
}

interface IExposureBondReadiness {
    function allBondsPosted(bytes32 rosterHash) external view returns (bool);
}

/// @notice Research-only aggregate liability controller for the two current bridge lanes.
/// @dev Authorized lane contracts are immutable and committed by the roster policy hash.
///      Liability release remains callable even when new exposure is blocked.
contract AttestorExposureControllerV1 {
    uint256 public constant LANE_COUNT = 2;
    uint256 public constant QUORUM = 5;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    bytes32 public constant POLICY_DOMAIN = keccak256("CANONICAL_BRIDGE_EXPOSURE_POLICY_V1");

    IExposureRosterView public immutable registry;
    IExposureBondReadiness public immutable bondVault;
    bytes32 public immutable rosterHash;
    uint256 public immutable maximumAggregateLiability;

    address[LANE_COUNT] public lanes;
    bytes32[LANE_COUNT] public laneIds;
    mapping(address => bool) public authorizedLane;
    mapping(address => bytes32) public laneIdByAddress;
    mapping(bytes32 => address) public laneAddressById;
    mapping(bytes32 => uint256) public laneLiability;
    mapping(bytes32 => bool) public consumedSettlement;
    mapping(bytes32 => address) public settlementLane;
    mapping(bytes32 => bool) public consumedResolution;
    uint256 public totalLiability;

    error InvalidRegistry();
    error InvalidBondVault();
    error InvalidLane(uint256 index);
    error DuplicateLane(address lane);
    error InvalidLaneId(uint256 index);
    error DuplicateLaneId(bytes32 laneId);
    error WrongBondVault();
    error PolicyHashMismatch();
    error UnauthorizedLane();
    error ZeroIdentity();
    error ZeroAmount();
    error RosterInactive();
    error BondsNotReady();
    error LiabilityCapExceeded(uint256 requestedTotal, uint256 maximumTotal);
    error SettlementAlreadyConsumed();
    error ResolutionAlreadyConsumed();
    error ReleaseExceedsLaneLiability(uint256 requested, uint256 available);

    event LiabilityIncreased(
        bytes32 indexed rosterHash,
        bytes32 indexed laneId,
        bytes32 indexed settlementId,
        uint256 amount,
        uint256 laneTotal,
        uint256 aggregateTotal
    );
    event LiabilityReleased(
        bytes32 indexed rosterHash,
        bytes32 indexed laneId,
        bytes32 indexed resolutionId,
        uint256 amount,
        uint256 laneTotal,
        uint256 aggregateTotal
    );

    constructor(
        address registryAddress,
        address bondVaultAddress,
        address[LANE_COUNT] memory lanes_,
        bytes32[LANE_COUNT] memory laneIds_
    ) {
        if (registryAddress == address(0) || registryAddress.code.length == 0) revert InvalidRegistry();
        if (bondVaultAddress == address(0) || bondVaultAddress.code.length == 0) revert InvalidBondVault();
        IExposureRosterView registry_ = IExposureRosterView(registryAddress);
        if (registry_.bondReadiness() != bondVaultAddress) revert WrongBondVault();

        for (uint256 i = 0; i < LANE_COUNT; ++i) {
            address lane = lanes_[i];
            bytes32 laneId = laneIds_[i];
            if (
                lane == address(0) ||
                lane.code.length == 0 ||
                lane == registryAddress ||
                lane == bondVaultAddress ||
                lane == address(this)
            ) revert InvalidLane(i);
            if (laneId == bytes32(0)) revert InvalidLaneId(i);
            for (uint256 j = 0; j < i; ++j) {
                if (lanes_[j] == lane) revert DuplicateLane(lane);
                if (laneIds_[j] == laneId) revert DuplicateLaneId(laneId);
            }
            lanes[i] = lane;
            laneIds[i] = laneId;
            authorizedLane[lane] = true;
            laneIdByAddress[lane] = laneId;
            laneAddressById[laneId] = lane;
        }

        bytes32 expectedPolicyHash = keccak256(
            abi.encode(
                POLICY_DOMAIN,
                block.chainid,
                registry_.bridgeId(),
                registry_.epoch(),
                address(this),
                bondVaultAddress,
                lanes_,
                laneIds_
            )
        );
        if (registry_.policyHash() != expectedPolicyHash) revert PolicyHashMismatch();

        uint256 maximum = registry_.equalBondAmount() * QUORUM * registry_.exposureCapBps() / BPS_DENOMINATOR;
        if (maximum == 0) revert LiabilityCapExceeded(0, 0);
        registry = registry_;
        bondVault = IExposureBondReadiness(bondVaultAddress);
        rosterHash = registry_.rosterHash();
        maximumAggregateLiability = maximum;
    }

    function increaseLiability(bytes32 settlementId, uint256 amount) external {
        if (!authorizedLane[msg.sender]) revert UnauthorizedLane();
        if (settlementId == bytes32(0)) revert ZeroIdentity();
        if (amount == 0) revert ZeroAmount();
        if (!registry.active()) revert RosterInactive();
        if (!bondVault.allBondsPosted(rosterHash)) revert BondsNotReady();
        if (consumedSettlement[settlementId]) revert SettlementAlreadyConsumed();
        uint256 requestedTotal = totalLiability + amount;
        if (requestedTotal > maximumAggregateLiability) {
            revert LiabilityCapExceeded(requestedTotal, maximumAggregateLiability);
        }

        bytes32 laneId = laneIdByAddress[msg.sender];
        consumedSettlement[settlementId] = true;
        settlementLane[settlementId] = msg.sender;
        laneLiability[laneId] += amount;
        totalLiability = requestedTotal;
        emit LiabilityIncreased(
            rosterHash,
            laneId,
            settlementId,
            amount,
            laneLiability[laneId],
            requestedTotal
        );
    }

    function releaseLiability(bytes32 resolutionId, uint256 amount) external {
        if (!authorizedLane[msg.sender]) revert UnauthorizedLane();
        if (resolutionId == bytes32(0)) revert ZeroIdentity();
        if (amount == 0) revert ZeroAmount();
        if (consumedResolution[resolutionId]) revert ResolutionAlreadyConsumed();
        bytes32 laneId = laneIdByAddress[msg.sender];
        uint256 available = laneLiability[laneId];
        if (amount > available) revert ReleaseExceedsLaneLiability(amount, available);

        consumedResolution[resolutionId] = true;
        laneLiability[laneId] = available - amount;
        totalLiability -= amount;
        emit LiabilityReleased(
            rosterHash,
            laneId,
            resolutionId,
            amount,
            laneLiability[laneId],
            totalLiability
        );
    }
}
