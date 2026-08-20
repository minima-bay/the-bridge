// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IWorkRewardRecorderView {
    function workRewardIndex() external view returns (address);
    function rosterHash() external view returns (bytes32);
    function finalized() external view returns (bool);
    function members(uint256 index) external view returns (address);
    function readinessWeight(address member) external view returns (uint256);
    function participationWeight(address member) external view returns (uint256);
    function totalReadinessWeight() external view returns (uint256);
    function totalParticipationWeight() external view returns (uint256);
    function finalizationDigest() external view returns (bytes32);
}

interface IWorkRewardTreasuryView {
    function rosterHash() external view returns (bytes32);
    function assets(uint256 index) external view returns (address);
    function registerWorkRewardIndex() external;
    function consumeFinalizedWorkRewards(
        address asset
    ) external returns (uint256 readinessAmount, uint256 participationAmount);
}

/// @notice Non-custodial index for one challenge-finalized work epoch's readiness and participation fees.
/// @dev This contract never holds or transfers assets and exposes no payout, claim, owner or upgrade function.
contract AttestorWorkRewardIndexV1 {
    uint256 public constant MEMBER_COUNT = 7;
    uint256 public constant ASSET_COUNT = 2;

    IWorkRewardRecorderView public immutable workRecorder;
    IWorkRewardTreasuryView public immutable treasury;
    bytes32 public immutable rosterHash;
    address[ASSET_COUNT] public rewardAssets;
    mapping(address => bool) public configuredRewardAsset;
    mapping(address => bool) public workRewardsIndexed;
    mapping(address => mapping(address => uint256)) public indexedReadinessReward;
    mapping(address => mapping(address => uint256)) public indexedParticipationReward;
    mapping(address => uint256) public totalIndexedReadiness;
    mapping(address => uint256) public totalIndexedParticipation;
    mapping(address => uint256) public readinessRemainder;
    mapping(address => uint256) public participationRemainder;
    mapping(address => bytes32) public indexedFinalizationDigest;
    bool public treasuryRegistered;

    error InvalidWorkRecorder();
    error InvalidTreasury();
    error InvalidRewardAsset(uint256 index);
    error DuplicateRewardAsset();
    error WrongRewardAsset();
    error TreasuryAlreadyRegistered();
    error TreasuryNotRegistered();
    error WorkEpochNotFinalized();
    error WorkRewardsAlreadyIndexed();
    error InvalidMember(uint256 index);

    event TreasuryRegistrationCompleted(address indexed treasury, address indexed workRecorder);
    event FinalizedWorkRewardsIndexed(
        bytes32 indexed rosterHash,
        address indexed asset,
        bytes32 indexed finalizationDigest,
        uint256 suppliedReadiness,
        uint256 indexedReadiness,
        uint256 readinessRemainder,
        uint256 suppliedParticipation,
        uint256 indexedParticipation,
        uint256 participationRemainder
    );

    constructor(
        address workRecorderAddress,
        address treasuryAddress,
        address[ASSET_COUNT] memory rewardAssets_
    ) {
        if (workRecorderAddress == address(0) || workRecorderAddress.code.length == 0) {
            revert InvalidWorkRecorder();
        }
        if (treasuryAddress == address(0) || treasuryAddress.code.length == 0) revert InvalidTreasury();
        IWorkRewardRecorderView recorder = IWorkRewardRecorderView(workRecorderAddress);
        IWorkRewardTreasuryView treasury_ = IWorkRewardTreasuryView(treasuryAddress);
        if (
            recorder.workRewardIndex() != address(this) ||
            recorder.rosterHash() != treasury_.rosterHash()
        ) revert InvalidWorkRecorder();
        for (uint256 i = 0; i < ASSET_COUNT; ++i) {
            address asset = rewardAssets_[i];
            if (asset == address(0) || asset.code.length == 0 || treasury_.assets(i) != asset) {
                revert InvalidRewardAsset(i);
            }
            if (i != 0 && rewardAssets_[0] == asset) revert DuplicateRewardAsset();
            rewardAssets[i] = asset;
            configuredRewardAsset[asset] = true;
        }
        workRecorder = recorder;
        treasury = treasury_;
        rosterHash = recorder.rosterHash();
    }

    function registerTreasury() external {
        if (treasuryRegistered) revert TreasuryAlreadyRegistered();
        treasury.registerWorkRewardIndex();
        treasuryRegistered = true;
        emit TreasuryRegistrationCompleted(address(treasury), address(workRecorder));
    }

    function indexFinalizedWork(address asset) external {
        if (!treasuryRegistered) revert TreasuryNotRegistered();
        if (!configuredRewardAsset[asset]) revert WrongRewardAsset();
        if (!workRecorder.finalized()) revert WorkEpochNotFinalized();
        if (workRewardsIndexed[asset]) revert WorkRewardsAlreadyIndexed();

        (uint256 suppliedReadiness, uint256 suppliedParticipation) =
            treasury.consumeFinalizedWorkRewards(asset);
        uint256 totalReadiness = workRecorder.totalReadinessWeight();
        uint256 totalParticipation = workRecorder.totalParticipationWeight();
        uint256 indexedReadiness;
        uint256 indexedParticipation;
        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            address member = workRecorder.members(i);
            if (member == address(0)) revert InvalidMember(i);
            uint256 readinessAmount = totalReadiness == 0
                ? 0
                : suppliedReadiness * workRecorder.readinessWeight(member) / totalReadiness;
            uint256 participationAmount = totalParticipation == 0
                ? 0
                : suppliedParticipation * workRecorder.participationWeight(member) / totalParticipation;
            indexedReadinessReward[asset][member] = readinessAmount;
            indexedParticipationReward[asset][member] = participationAmount;
            indexedReadiness += readinessAmount;
            indexedParticipation += participationAmount;
        }
        workRewardsIndexed[asset] = true;
        totalIndexedReadiness[asset] = indexedReadiness;
        totalIndexedParticipation[asset] = indexedParticipation;
        readinessRemainder[asset] = suppliedReadiness - indexedReadiness;
        participationRemainder[asset] = suppliedParticipation - indexedParticipation;
        bytes32 digest = workRecorder.finalizationDigest();
        indexedFinalizationDigest[asset] = digest;
        emit FinalizedWorkRewardsIndexed(
            rosterHash,
            asset,
            digest,
            suppliedReadiness,
            indexedReadiness,
            suppliedReadiness - indexedReadiness,
            suppliedParticipation,
            indexedParticipation,
            suppliedParticipation - indexedParticipation
        );
    }

    function indexedWorkRewardOf(address asset, address member) external view returns (uint256) {
        if (!configuredRewardAsset[asset]) revert WrongRewardAsset();
        return indexedReadinessReward[asset][member] + indexedParticipationReward[asset][member];
    }
}
