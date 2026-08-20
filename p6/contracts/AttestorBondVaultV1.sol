// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAttestorRosterRegistryView {
    function MEMBER_COUNT() external view returns (uint256);
    function QUORUM() external view returns (uint256);
    function bridgeId() external view returns (bytes32);
    function epoch() external view returns (uint256);
    function activationBlock() external view returns (uint256);
    function bondReadiness() external view returns (address);
    function rewardIndex() external view returns (address);
    function workRecorder() external view returns (address);
    function bondAsset() external view returns (address);
    function equalBondAmount() external view returns (uint256);
    function minimumSelfBondBps() external view returns (uint256);
    function individualSlashBps() external view returns (uint256);
    function mutualSlashBps() external view returns (uint256);
    function exposureCapBps() external view returns (uint256);
    function policyHash() external view returns (bytes32);
    function dossierRoot() external view returns (bytes32);
    function rosterHash() external view returns (bytes32);
    function members(uint256 index) external view returns (address);
}

interface IAttestorRewardCheckpoint {
    function beforeBondChange(
        bytes32 rosterHash,
        address member,
        address contributor,
        uint256 currentBalance
    ) external;
}

/// @notice Research-only custody for equal attestor bonds.
/// @dev This version can only register a self-consistent roster and receive its exact bonds.
///      It deliberately has no withdrawal, slashing, rescue, sweep, owner or upgrade function.
contract AttestorBondVaultV1 {
    uint256 public constant MEMBER_COUNT = 7;
    uint256 public constant QUORUM = 5;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    bytes32 public constant ROSTER_DOMAIN = keccak256("CANONICAL_BRIDGE_ATTESTOR_ROSTER_V1");

    struct RosterProposal {
        bytes32 bridgeId;
        uint256 epoch;
        uint256 activationBlock;
        address bondReadiness;
        address rewardIndex;
        address workRecorder;
        address bondAsset;
        uint256 equalBondAmount;
        uint256 minimumSelfBondBps;
        uint256 individualSlashBps;
        uint256 mutualSlashBps;
        uint256 exposureCapBps;
        bytes32 policyHash;
        bytes32 dossierRoot;
    }

    struct EpochBondConfig {
        address registry;
        address rewardIndex;
        address workRecorder;
        address asset;
        uint256 equalBondAmount;
        uint256 minimumSelfBondAmount;
        uint256 individualTrancheAmount;
        uint256 mutualTrancheAmount;
        uint256 postedCount;
        uint256 totalBonded;
        bool registered;
    }

    mapping(bytes32 => EpochBondConfig) public epochBonds;
    mapping(bytes32 => mapping(address => bool)) public authorizedMember;
    mapping(bytes32 => mapping(uint256 => address)) public rosterMember;
    mapping(bytes32 => mapping(address => uint256)) public postedBond;
    mapping(bytes32 => mapping(address => uint256)) public selfBond;
    mapping(bytes32 => mapping(address => uint256)) public delegatedBond;
    mapping(bytes32 => mapping(address => mapping(address => uint256))) public contributorBond;
    mapping(bytes32 => mapping(address => bool)) public memberReady;
    mapping(address => uint256) public requiredCustodyByAsset;

    uint256 private entered;

    error InvalidRegistry();
    error WrongRosterShape();
    error WrongReadinessContract();
    error InvalidRewardIndex();
    error InvalidBondTerms();
    error InvalidMember(uint256 index);
    error DuplicateMember(address member);
    error RosterHashMismatch();
    error RosterAlreadyRegistered();
    error RosterNotRegistered();
    error NotRosterMember();
    error BondAlreadyPosted();
    error ZeroContribution();
    error MemberBondCapacityExceeded(uint256 requested, uint256 maximum);
    error DelegatedCapacityExceeded(uint256 requested, uint256 maximum);
    error TokenBalanceQueryFailed();
    error TransferFailed();
    error IncorrectReceivedAmount(uint256 expected, uint256 received);
    error ReentrantCall();

    event RosterRegistered(
        bytes32 indexed rosterHash,
        address indexed registry,
        address indexed asset,
        uint256 equalBondAmount,
        uint256 minimumSelfBondAmount,
        uint256 individualTrancheAmount,
        uint256 mutualTrancheAmount
    );
    event BondPosted(
        bytes32 indexed rosterHash,
        address indexed member,
        uint256 amount,
        uint256 postedCount,
        uint256 totalBonded
    );
    event BondContributed(
        bytes32 indexed rosterHash,
        address indexed member,
        address indexed contributor,
        uint256 amount,
        uint256 memberTotal
    );

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    function registerRoster(address registryAddress) external returns (bytes32 rosterHash) {
        if (registryAddress == address(0) || registryAddress.code.length == 0) revert InvalidRegistry();
        IAttestorRosterRegistryView registry = IAttestorRosterRegistryView(registryAddress);
        if (registry.MEMBER_COUNT() != MEMBER_COUNT || registry.QUORUM() != QUORUM) {
            revert WrongRosterShape();
        }
        if (registry.bondReadiness() != address(this)) revert WrongReadinessContract();
        if (registry.rewardIndex() == address(0) || registry.rewardIndex().code.length == 0) {
            revert InvalidRewardIndex();
        }

        RosterProposal memory proposal = RosterProposal({
            bridgeId: registry.bridgeId(),
            epoch: registry.epoch(),
            activationBlock: registry.activationBlock(),
            bondReadiness: registry.bondReadiness(),
            rewardIndex: registry.rewardIndex(),
            workRecorder: registry.workRecorder(),
            bondAsset: registry.bondAsset(),
            equalBondAmount: registry.equalBondAmount(),
            minimumSelfBondBps: registry.minimumSelfBondBps(),
            individualSlashBps: registry.individualSlashBps(),
            mutualSlashBps: registry.mutualSlashBps(),
            exposureCapBps: registry.exposureCapBps(),
            policyHash: registry.policyHash(),
            dossierRoot: registry.dossierRoot()
        });
        if (
            proposal.bondAsset == address(0) ||
            proposal.equalBondAmount == 0 ||
            proposal.minimumSelfBondBps == 0 ||
            proposal.minimumSelfBondBps > BPS_DENOMINATOR ||
            proposal.individualSlashBps == 0 ||
            proposal.mutualSlashBps == 0 ||
            proposal.individualSlashBps + proposal.mutualSlashBps != BPS_DENOMINATOR
        ) revert InvalidBondTerms();

        address[MEMBER_COUNT] memory members_;
        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            address member = registry.members(i);
            if (member == address(0)) revert InvalidMember(i);
            for (uint256 j = 0; j < i; ++j) {
                if (members_[j] == member) revert DuplicateMember(member);
            }
            members_[i] = member;
        }

        rosterHash = registry.rosterHash();
        bytes32 expectedHash = keccak256(
            abi.encode(ROSTER_DOMAIN, block.chainid, registryAddress, proposal, members_)
        );
        if (rosterHash != expectedHash) revert RosterHashMismatch();
        if (epochBonds[rosterHash].registered) revert RosterAlreadyRegistered();

        uint256 minimumSelfAmount = proposal.equalBondAmount * proposal.minimumSelfBondBps / BPS_DENOMINATOR;
        if (minimumSelfAmount == 0) revert InvalidBondTerms();
        uint256 individualAmount = proposal.equalBondAmount * proposal.individualSlashBps / BPS_DENOMINATOR;
        uint256 mutualAmount = proposal.equalBondAmount - individualAmount;
        epochBonds[rosterHash] = EpochBondConfig({
            registry: registryAddress,
            rewardIndex: proposal.rewardIndex,
            workRecorder: proposal.workRecorder,
            asset: proposal.bondAsset,
            equalBondAmount: proposal.equalBondAmount,
            minimumSelfBondAmount: minimumSelfAmount,
            individualTrancheAmount: individualAmount,
            mutualTrancheAmount: mutualAmount,
            postedCount: 0,
            totalBonded: 0,
            registered: true
        });
        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            authorizedMember[rosterHash][members_[i]] = true;
            rosterMember[rosterHash][i] = members_[i];
        }
        emit RosterRegistered(
            rosterHash,
            registryAddress,
            proposal.bondAsset,
            proposal.equalBondAmount,
            minimumSelfAmount,
            individualAmount,
            mutualAmount
        );
    }

    function postBond(bytes32 rosterHash) external nonReentrant {
        EpochBondConfig storage config = epochBonds[rosterHash];
        if (!config.registered) revert RosterNotRegistered();
        if (!authorizedMember[rosterHash][msg.sender]) revert NotRosterMember();
        if (postedBond[rosterHash][msg.sender] != 0) revert BondAlreadyPosted();
        contribute(rosterHash, msg.sender, msg.sender, config.equalBondAmount);
    }

    function contributeBond(bytes32 rosterHash, address member, uint256 amount) external nonReentrant {
        contribute(rosterHash, member, msg.sender, amount);
    }

    function contribute(bytes32 rosterHash, address member, address contributor, uint256 amount) private {
        EpochBondConfig storage config = epochBonds[rosterHash];
        if (!config.registered) revert RosterNotRegistered();
        if (!authorizedMember[rosterHash][member]) revert NotRosterMember();
        if (amount == 0) revert ZeroContribution();
        uint256 requestedMemberTotal = postedBond[rosterHash][member] + amount;
        if (requestedMemberTotal > config.equalBondAmount) {
            revert MemberBondCapacityExceeded(requestedMemberTotal, config.equalBondAmount);
        }
        if (contributor != member) {
            uint256 maximumDelegated = config.equalBondAmount - config.minimumSelfBondAmount;
            uint256 requestedDelegated = delegatedBond[rosterHash][member] + amount;
            if (requestedDelegated > maximumDelegated) {
                revert DelegatedCapacityExceeded(requestedDelegated, maximumDelegated);
            }
        }

        IAttestorRewardCheckpoint(config.rewardIndex).beforeBondChange(
            rosterHash,
            member,
            contributor,
            contributorBond[rosterHash][member][contributor]
        );

        uint256 beforeBalance = tokenBalance(config.asset);
        safeTransferFrom(config.asset, contributor, address(this), amount);
        uint256 afterBalance = tokenBalance(config.asset);
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) {
            revert IncorrectReceivedAmount(amount, received);
        }

        postedBond[rosterHash][member] = requestedMemberTotal;
        contributorBond[rosterHash][member][contributor] += amount;
        if (contributor == member) selfBond[rosterHash][member] += amount;
        else delegatedBond[rosterHash][member] += amount;
        config.totalBonded += amount;
        requiredCustodyByAsset[config.asset] += amount;
        emit BondContributed(
            rosterHash,
            member,
            contributor,
            amount,
            requestedMemberTotal
        );
        if (
            !memberReady[rosterHash][member] &&
            requestedMemberTotal == config.equalBondAmount &&
            selfBond[rosterHash][member] >= config.minimumSelfBondAmount
        ) {
            memberReady[rosterHash][member] = true;
            ++config.postedCount;
            emit BondPosted(rosterHash, member, config.equalBondAmount, config.postedCount, config.totalBonded);
        }
    }

    function allBondsPosted(bytes32 rosterHash) external view returns (bool) {
        EpochBondConfig storage config = epochBonds[rosterHash];
        return
            config.registered &&
            config.postedCount == MEMBER_COUNT &&
            tokenBalance(config.asset) >= requiredCustodyByAsset[config.asset];
    }

    function rewardContext(bytes32 rosterHash) external view returns (
        address asset,
        uint256 equalBondAmount,
        bool registered
    ) {
        EpochBondConfig storage config = epochBonds[rosterHash];
        return (config.asset, config.equalBondAmount, config.registered);
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
