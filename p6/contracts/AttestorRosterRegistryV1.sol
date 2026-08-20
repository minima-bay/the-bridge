// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAttestorBondReadiness {
    function allBondsPosted(bytes32 rosterHash) external view returns (bool);
}

/// @notice Research-only, moneyless registry for one canonical bridge attestor roster.
/// @dev The seven candidates must unanimously accept the exact roster commitment.
///      Any candidate may withdraw before activation. This contract holds no assets,
///      verifies no bridge messages and has no administrator or upgrade mechanism.
contract AttestorRosterRegistryV1 {
    uint256 public constant MEMBER_COUNT = 7;
    uint256 public constant QUORUM = 5;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    bytes32 public constant ROSTER_DOMAIN = keccak256("CANONICAL_BRIDGE_ATTESTOR_ROSTER_V1");

    struct Proposal {
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

    bytes32 public immutable bridgeId;
    uint256 public immutable epoch;
    uint256 public immutable activationBlock;
    IAttestorBondReadiness public immutable bondReadiness;
    address public immutable rewardIndex;
    address public immutable workRecorder;
    address public immutable bondAsset;
    uint256 public immutable equalBondAmount;
    uint256 public immutable minimumSelfBondBps;
    uint256 public immutable individualSlashBps;
    uint256 public immutable mutualSlashBps;
    uint256 public immutable exposureCapBps;
    bytes32 public immutable policyHash;
    bytes32 public immutable dossierRoot;
    bytes32 public immutable rosterHash;

    address[MEMBER_COUNT] public members;
    mapping(address => bool) public isMember;
    mapping(address => bool) public accepted;
    uint256 public acceptedCount;
    bool public active;

    error ZeroBridgeId();
    error ZeroEpoch();
    error ActivationNotFuture();
    error ZeroBondReadiness();
    error ZeroRewardIndex();
    error ZeroWorkRecorder();
    error ZeroBondAsset();
    error ZeroBondAmount();
    error InvalidMinimumSelfBond();
    error InvalidSlashAllocation();
    error InvalidExposureCap();
    error ZeroPolicyHash();
    error ZeroDossierRoot();
    error ZeroMember(uint256 index);
    error DuplicateMember(address member);
    error NotMember();
    error WrongRosterHash();
    error AlreadyAccepted();
    error NotAccepted();
    error AlreadyActive();
    error AcceptanceIncomplete(uint256 accepted, uint256 required);
    error ActivationTooEarly(uint256 currentBlock, uint256 requiredBlock);
    error BondsNotReady();

    event RosterAccepted(address indexed member, bytes32 indexed rosterHash, uint256 acceptedCount);
    event AcceptanceWithdrawn(address indexed member, bytes32 indexed rosterHash, uint256 acceptedCount);
    event RosterActivated(bytes32 indexed rosterHash, uint256 indexed epoch, uint256 activationBlock);

    constructor(Proposal memory proposal, address[MEMBER_COUNT] memory members_) {
        if (proposal.bridgeId == bytes32(0)) revert ZeroBridgeId();
        if (proposal.epoch == 0) revert ZeroEpoch();
        if (proposal.activationBlock <= block.number) revert ActivationNotFuture();
        if (proposal.bondReadiness == address(0)) revert ZeroBondReadiness();
        if (proposal.rewardIndex == address(0)) revert ZeroRewardIndex();
        if (proposal.workRecorder == address(0)) revert ZeroWorkRecorder();
        if (proposal.bondAsset == address(0)) revert ZeroBondAsset();
        if (proposal.equalBondAmount == 0) revert ZeroBondAmount();
        if (proposal.minimumSelfBondBps == 0 || proposal.minimumSelfBondBps > BPS_DENOMINATOR) {
            revert InvalidMinimumSelfBond();
        }
        if (
            proposal.individualSlashBps == 0 ||
            proposal.mutualSlashBps == 0 ||
            proposal.individualSlashBps + proposal.mutualSlashBps != BPS_DENOMINATOR
        ) revert InvalidSlashAllocation();
        if (proposal.exposureCapBps == 0 || proposal.exposureCapBps > BPS_DENOMINATOR) {
            revert InvalidExposureCap();
        }
        if (proposal.policyHash == bytes32(0)) revert ZeroPolicyHash();
        if (proposal.dossierRoot == bytes32(0)) revert ZeroDossierRoot();

        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            address member = members_[i];
            if (member == address(0)) revert ZeroMember(i);
            for (uint256 j = 0; j < i; ++j) {
                if (members_[j] == member) revert DuplicateMember(member);
            }
            members[i] = member;
            isMember[member] = true;
        }

        bridgeId = proposal.bridgeId;
        epoch = proposal.epoch;
        activationBlock = proposal.activationBlock;
        bondReadiness = IAttestorBondReadiness(proposal.bondReadiness);
        rewardIndex = proposal.rewardIndex;
        workRecorder = proposal.workRecorder;
        bondAsset = proposal.bondAsset;
        equalBondAmount = proposal.equalBondAmount;
        minimumSelfBondBps = proposal.minimumSelfBondBps;
        individualSlashBps = proposal.individualSlashBps;
        mutualSlashBps = proposal.mutualSlashBps;
        exposureCapBps = proposal.exposureCapBps;
        policyHash = proposal.policyHash;
        dossierRoot = proposal.dossierRoot;

        rosterHash = keccak256(
            abi.encode(
                ROSTER_DOMAIN,
                block.chainid,
                address(this),
                proposal,
                members_
            )
        );
    }

    function acceptRoster(bytes32 expectedRosterHash) external {
        if (active) revert AlreadyActive();
        if (!isMember[msg.sender]) revert NotMember();
        if (expectedRosterHash != rosterHash) revert WrongRosterHash();
        if (accepted[msg.sender]) revert AlreadyAccepted();
        accepted[msg.sender] = true;
        ++acceptedCount;
        emit RosterAccepted(msg.sender, rosterHash, acceptedCount);
    }

    function withdrawAcceptance() external {
        if (active) revert AlreadyActive();
        if (!isMember[msg.sender]) revert NotMember();
        if (!accepted[msg.sender]) revert NotAccepted();
        accepted[msg.sender] = false;
        --acceptedCount;
        emit AcceptanceWithdrawn(msg.sender, rosterHash, acceptedCount);
    }

    function activate() external {
        if (active) revert AlreadyActive();
        if (acceptedCount != MEMBER_COUNT) revert AcceptanceIncomplete(acceptedCount, MEMBER_COUNT);
        if (block.number < activationBlock) revert ActivationTooEarly(block.number, activationBlock);
        if (!bondReadiness.allBondsPosted(rosterHash)) revert BondsNotReady();
        active = true;
        emit RosterActivated(rosterHash, epoch, activationBlock);
    }
}
