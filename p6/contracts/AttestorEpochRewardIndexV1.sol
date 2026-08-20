// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IEpochRewardBondVault {
    function rewardContext(bytes32 rosterHash) external view returns (
        address asset,
        uint256 equalBondAmount,
        bool registered
    );
    function rosterMember(bytes32 rosterHash, uint256 index) external view returns (address);
    function postedBond(bytes32 rosterHash, address member) external view returns (uint256);
    function contributorBond(bytes32 rosterHash, address member, address contributor) external view returns (uint256);
    function allBondsPosted(bytes32 rosterHash) external view returns (bool);
}

/// @notice Research-only reward-per-share index for one roster epoch's objective bond-risk bucket.
/// @dev The index never custodies assets and exposes no claim, transfer, owner or upgrade function.
///      Readiness and participation remain unindexed until objective work records exist.
contract AttestorEpochRewardIndexV1 {
    uint256 public constant MEMBER_COUNT = 7;
    uint256 public constant INDEX_SCALE = 1e27;

    IEpochRewardBondVault public immutable bondVault;
    address public immutable treasury;
    address[2] public rewardAssets;
    mapping(address => bool) public configuredRewardAsset;

    mapping(bytes32 => mapping(address => mapping(address => uint256))) public memberRewardIndex;
    mapping(bytes32 => mapping(address => mapping(address => mapping(address => uint256)))) public contributorRewardDebt;
    mapping(bytes32 => mapping(address => mapping(address => mapping(address => uint256)))) public contributorAccrued;
    mapping(bytes32 => mapping(address => uint256)) public indexedBondRiskRewards;
    mapping(bytes32 => mapping(address => uint256)) public unindexedRemainder;

    error InvalidBondVault();
    error InvalidTreasury();
    error InvalidRewardAsset(uint256 index);
    error DuplicateRewardAsset();
    error UnauthorizedBondVault();
    error UnauthorizedTreasury();
    error RosterNotRegistered();
    error WrongRewardAsset();
    error BondsNotReady();
    error ZeroReward();
    error InvalidMember(uint256 index);
    error PoolNotFullyBonded(address member, uint256 observed, uint256 required);
    error ContributorBalanceMismatch(uint256 supplied, uint256 observed);

    event BondRiskRewardIndexed(
        bytes32 indexed rosterHash,
        address indexed asset,
        uint256 suppliedAmount,
        uint256 indexedAmount,
        uint256 remainder
    );
    event ContributorCheckpointed(
        bytes32 indexed rosterHash,
        address indexed member,
        address indexed contributor,
        address asset,
        uint256 balance,
        uint256 accrued,
        uint256 rewardDebt
    );

    constructor(address bondVaultAddress, address treasuryAddress, address[2] memory rewardAssets_) {
        if (bondVaultAddress == address(0) || bondVaultAddress.code.length == 0) revert InvalidBondVault();
        if (treasuryAddress == address(0)) revert InvalidTreasury();
        for (uint256 i = 0; i < 2; ++i) {
            address asset = rewardAssets_[i];
            if (asset == address(0) || asset.code.length == 0) revert InvalidRewardAsset(i);
            if (i != 0 && rewardAssets_[0] == asset) revert DuplicateRewardAsset();
            rewardAssets[i] = asset;
            configuredRewardAsset[asset] = true;
        }
        bondVault = IEpochRewardBondVault(bondVaultAddress);
        treasury = treasuryAddress;
    }

    function beforeBondChange(
        bytes32 rosterHash,
        address member,
        address contributor,
        uint256 currentBalance
    ) external {
        if (msg.sender != address(bondVault)) revert UnauthorizedBondVault();
        uint256 observed = bondVault.contributorBond(rosterHash, member, contributor);
        if (observed != currentBalance) revert ContributorBalanceMismatch(currentBalance, observed);
        for (uint256 i = 0; i < 2; ++i) {
            checkpoint(rosterHash, rewardAssets[i], member, contributor, currentBalance);
        }
    }

    function creditBondRisk(bytes32 rosterHash, address asset, uint256 amount) external returns (uint256 indexedAmount) {
        if (msg.sender != treasury) revert UnauthorizedTreasury();
        if (amount == 0) revert ZeroReward();
        (, uint256 equalBondAmount, bool registered) = bondVault.rewardContext(rosterHash);
        if (!registered) revert RosterNotRegistered();
        if (!configuredRewardAsset[asset]) revert WrongRewardAsset();
        if (!bondVault.allBondsPosted(rosterHash)) revert BondsNotReady();

        uint256 perMember = amount / MEMBER_COUNT;
        indexedAmount = perMember * MEMBER_COUNT;
        uint256 remainder = amount - indexedAmount;
        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            address member = bondVault.rosterMember(rosterHash, i);
            if (member == address(0)) revert InvalidMember(i);
            uint256 observed = bondVault.postedBond(rosterHash, member);
            if (observed != equalBondAmount) revert PoolNotFullyBonded(member, observed, equalBondAmount);
            memberRewardIndex[rosterHash][asset][member] += perMember * INDEX_SCALE / equalBondAmount;
        }
        indexedBondRiskRewards[rosterHash][asset] += indexedAmount;
        unindexedRemainder[rosterHash][asset] += remainder;
        emit BondRiskRewardIndexed(rosterHash, asset, amount, indexedAmount, remainder);
    }

    function indexedBondRiskOf(
        bytes32 rosterHash,
        address asset,
        address member,
        address contributor
    ) external view returns (uint256) {
        if (!configuredRewardAsset[asset]) revert WrongRewardAsset();
        uint256 balance = bondVault.contributorBond(rosterHash, member, contributor);
        uint256 index = memberRewardIndex[rosterHash][asset][member];
        uint256 debt = contributorRewardDebt[rosterHash][asset][member][contributor];
        return contributorAccrued[rosterHash][asset][member][contributor] + balance * (index - debt) / INDEX_SCALE;
    }

    function checkpoint(bytes32 rosterHash, address asset, address member, address contributor, uint256 balance) private {
        uint256 index = memberRewardIndex[rosterHash][asset][member];
        uint256 debt = contributorRewardDebt[rosterHash][asset][member][contributor];
        uint256 accrued = contributorAccrued[rosterHash][asset][member][contributor];
        if (balance != 0 && index != debt) accrued += balance * (index - debt) / INDEX_SCALE;
        contributorAccrued[rosterHash][asset][member][contributor] = accrued;
        contributorRewardDebt[rosterHash][asset][member][contributor] = index;
        emit ContributorCheckpointed(rosterHash, member, contributor, asset, balance, accrued, index);
    }
}
