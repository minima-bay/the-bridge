// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IWorkRosterView {
    function MEMBER_COUNT() external view returns (uint256);
    function rosterHash() external view returns (bytes32);
    function activationBlock() external view returns (uint256);
    function workRecorder() external view returns (address);
    function members(uint256 index) external view returns (address);
    function isMember(address member) external view returns (bool);
    function active() external view returns (bool);
}

interface IWorkBondReadiness {
    function allBondsPosted(bytes32 rosterHash) external view returns (bool);
}

interface IWorkExposureController {
    function LANE_COUNT() external view returns (uint256);
    function registry() external view returns (address);
    function bondVault() external view returns (address);
    function rosterHash() external view returns (bytes32);
    function lanes(uint256 index) external view returns (address);
    function laneIds(uint256 index) external view returns (bytes32);
}

interface IObjectiveDecisionVerifier {
    function verifiesDecisionAccountability(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        address member,
        uint8 decision,
        bytes calldata signature
    ) external view returns (bool);

    function provesInvalidDecision(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        address member,
        uint8 decision,
        bytes32 evidenceDigest,
        bytes calldata evidence
    ) external view returns (bool);
}

/// @notice Research-only objective heartbeat and approve-or-reject record for one roster epoch.
/// @dev A direct member transaction proves key activity and the submitted decision, not the truth of
///      an external fact. Invalid-decision challenges depend entirely on the immutable verifier.
///      This contract holds no assets and exposes no payout, owner or upgrade function.
contract AttestorWorkEpochV1 {
    uint256 public constant MEMBER_COUNT = 7;
    uint256 public constant LANE_COUNT = 2;
    bytes32 public constant FINALIZATION_DOMAIN = keccak256("CANONICAL_BRIDGE_WORK_EPOCH_FINALIZATION_V1");
    bytes32 public constant WORK_ACCUMULATOR_DOMAIN = keccak256("CANONICAL_BRIDGE_WORK_ACCUMULATOR_V1");

    enum Decision {
        NONE,
        APPROVE,
        REJECT
    }

    struct RequestRecord {
        address lane;
        bytes32 laneId;
        bytes32 requestDigest;
        uint256 decisionDeadline;
        bool registered;
    }

    struct DecisionRecord {
        address member;
        Decision decision;
        bytes32 evidenceDigest;
        bytes32 accountabilityDigest;
        uint256 submittedBlock;
        bool challenged;
    }

    IWorkRosterView public immutable registry;
    IWorkBondReadiness public immutable bondVault;
    IWorkExposureController public immutable exposureController;
    IObjectiveDecisionVerifier public immutable decisionVerifier;
    address public immutable workRewardIndex;
    bytes32 public immutable rosterHash;
    uint256 public immutable epochStartBlock;
    uint256 public immutable epochEndBlock;
    uint256 public immutable readinessWindowBlocks;
    uint256 public immutable readinessWindowCount;
    uint256 public immutable challengeEndBlock;

    address[LANE_COUNT] public lanes;
    bytes32[LANE_COUNT] public laneIds;
    address[MEMBER_COUNT] public members;
    mapping(address => bool) public authorizedLane;
    mapping(address => uint256) public readinessWeight;
    mapping(address => uint256) public participationWeight;
    mapping(address => mapping(uint256 => bool)) public readinessRecorded;
    mapping(bytes32 => RequestRecord) public requests;
    mapping(bytes32 => mapping(address => DecisionRecord)) public decisions;
    mapping(bytes32 => bool) public successfulChallenge;
    uint256 public totalReadinessWeight;
    uint256 public totalParticipationWeight;
    uint256 public requestCount;
    uint256 public decisionCount;
    uint256 public successfulChallengeCount;
    bool public finalized;
    bytes32 public finalizationDigest;
    bytes32 public workAccumulator;

    error InvalidRegistry();
    error InvalidBondVault();
    error InvalidExposureController();
    error InvalidDecisionVerifier();
    error InvalidWorkRewardIndex();
    error WrongWorkRecorder();
    error WrongControllerBinding();
    error InvalidEpochWindow();
    error InvalidLane(uint256 index);
    error InvalidLaneId(uint256 index);
    error InvalidMember(uint256 index);
    error UnauthorizedLane();
    error NotMember();
    error RosterInactive();
    error BondsNotReady();
    error EpochNotOpen();
    error EpochClosed();
    error ReadinessAlreadyRecorded();
    error ZeroIdentity();
    error ZeroDigest();
    error InvalidDecisionDeadline();
    error RequestAlreadyRegistered();
    error RequestNotRegistered();
    error InvalidDecision();
    error InvalidAccountabilitySignature();
    error DecisionDeadlinePassed();
    error DecisionAlreadyRecorded();
    error DecisionNotRecorded();
    error ChallengeWindowClosed();
    error ChallengeAlreadySucceeded();
    error ChallengeNotProved();
    error FinalizationTooEarly();
    error AlreadyFinalized();

    event ReadinessHeartbeat(
        bytes32 indexed rosterHash,
        address indexed member,
        uint256 indexed window,
        uint256 blockNumber
    );
    event RequestRegistered(
        bytes32 indexed requestId,
        bytes32 indexed laneId,
        address indexed lane,
        bytes32 requestDigest,
        uint256 decisionDeadline
    );
    event DecisionRecorded(
        bytes32 indexed requestId,
        address indexed member,
        Decision decision,
        bytes32 evidenceDigest,
        bytes32 accountabilityDigest,
        uint256 submittedBlock
    );
    event DecisionChallenged(
        bytes32 indexed requestId,
        address indexed member,
        bytes32 indexed challengeId,
        bytes32 challengeEvidenceDigest
    );
    event EpochFinalized(
        bytes32 indexed rosterHash,
        bytes32 indexed finalizationDigest,
        uint256 totalReadinessWeight,
        uint256 totalParticipationWeight,
        uint256 successfulChallengeCount
    );

    constructor(
        address registryAddress,
        address bondVaultAddress,
        address exposureControllerAddress,
        address decisionVerifierAddress,
        address workRewardIndexAddress,
        uint256 epochStartBlock_,
        uint256 epochEndBlock_,
        uint256 readinessWindowBlocks_,
        uint256 challengePeriodBlocks
    ) {
        if (registryAddress == address(0) || registryAddress.code.length == 0) revert InvalidRegistry();
        if (bondVaultAddress == address(0) || bondVaultAddress.code.length == 0) revert InvalidBondVault();
        if (exposureControllerAddress == address(0) || exposureControllerAddress.code.length == 0) {
            revert InvalidExposureController();
        }
        if (decisionVerifierAddress == address(0) || decisionVerifierAddress.code.length == 0) {
            revert InvalidDecisionVerifier();
        }
        if (workRewardIndexAddress == address(0)) revert InvalidWorkRewardIndex();
        IWorkRosterView registry_ = IWorkRosterView(registryAddress);
        IWorkExposureController controller_ = IWorkExposureController(exposureControllerAddress);
        if (registry_.MEMBER_COUNT() != MEMBER_COUNT) revert InvalidRegistry();
        if (registry_.workRecorder() != address(this)) revert WrongWorkRecorder();
        if (
            controller_.LANE_COUNT() != LANE_COUNT ||
            controller_.registry() != registryAddress ||
            controller_.bondVault() != bondVaultAddress ||
            controller_.rosterHash() != registry_.rosterHash()
        ) revert WrongControllerBinding();
        if (
            epochStartBlock_ < registry_.activationBlock() ||
            epochEndBlock_ <= epochStartBlock_ ||
            readinessWindowBlocks_ == 0 ||
            challengePeriodBlocks == 0
        ) revert InvalidEpochWindow();

        registry = registry_;
        bondVault = IWorkBondReadiness(bondVaultAddress);
        exposureController = controller_;
        decisionVerifier = IObjectiveDecisionVerifier(decisionVerifierAddress);
        workRewardIndex = workRewardIndexAddress;
        rosterHash = registry_.rosterHash();
        epochStartBlock = epochStartBlock_;
        epochEndBlock = epochEndBlock_;
        readinessWindowBlocks = readinessWindowBlocks_;
        readinessWindowCount = (epochEndBlock_ - epochStartBlock_ + readinessWindowBlocks_) /
            readinessWindowBlocks_;
        challengeEndBlock = epochEndBlock_ + challengePeriodBlocks;

        for (uint256 i = 0; i < LANE_COUNT; ++i) {
            address lane = controller_.lanes(i);
            bytes32 laneId = controller_.laneIds(i);
            if (lane == address(0) || lane.code.length == 0) revert InvalidLane(i);
            if (laneId == bytes32(0)) revert InvalidLaneId(i);
            lanes[i] = lane;
            laneIds[i] = laneId;
            authorizedLane[lane] = true;
        }
        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            address member = registry_.members(i);
            if (member == address(0)) revert InvalidMember(i);
            members[i] = member;
        }
    }

    function recordReadiness() external {
        requireOperationalMember();
        uint256 window = currentReadinessWindow();
        if (readinessRecorded[msg.sender][window]) revert ReadinessAlreadyRecorded();
        readinessRecorded[msg.sender][window] = true;
        ++readinessWeight[msg.sender];
        ++totalReadinessWeight;
        workAccumulator = keccak256(
            abi.encode(
                WORK_ACCUMULATOR_DOMAIN,
                workAccumulator,
                uint8(1),
                rosterHash,
                msg.sender,
                window,
                block.number
            )
        );
        emit ReadinessHeartbeat(rosterHash, msg.sender, window, block.number);
    }

    function registerRequest(
        bytes32 requestId,
        bytes32 requestDigest,
        uint256 decisionDeadline
    ) external {
        if (!authorizedLane[msg.sender]) revert UnauthorizedLane();
        requireEpochOpen();
        requireActiveBondedRoster();
        if (requestId == bytes32(0)) revert ZeroIdentity();
        if (requestDigest == bytes32(0)) revert ZeroDigest();
        if (decisionDeadline <= block.number || decisionDeadline > epochEndBlock) {
            revert InvalidDecisionDeadline();
        }
        if (requests[requestId].registered) revert RequestAlreadyRegistered();
        bytes32 laneId = lanes[0] == msg.sender ? laneIds[0] : laneIds[1];
        requests[requestId] = RequestRecord({
            lane: msg.sender,
            laneId: laneId,
            requestDigest: requestDigest,
            decisionDeadline: decisionDeadline,
            registered: true
        });
        ++requestCount;
        workAccumulator = keccak256(
            abi.encode(
                WORK_ACCUMULATOR_DOMAIN,
                workAccumulator,
                uint8(2),
                requestId,
                laneId,
                msg.sender,
                requestDigest,
                decisionDeadline,
                block.number
            )
        );
        emit RequestRegistered(requestId, laneId, msg.sender, requestDigest, decisionDeadline);
    }

    function recordDecision(
        bytes32 requestId,
        Decision decision,
        bytes32 evidenceDigest,
        bytes calldata accountabilitySignature
    ) external {
        requireOperationalMember();
        RequestRecord storage request = requests[requestId];
        if (!request.registered) revert RequestNotRegistered();
        if (block.number > request.decisionDeadline) revert DecisionDeadlinePassed();
        if (decision != Decision.APPROVE && decision != Decision.REJECT) revert InvalidDecision();
        if (evidenceDigest == bytes32(0)) revert ZeroDigest();
        if (decisions[requestId][msg.sender].member != address(0)) revert DecisionAlreadyRecorded();
        if (
            !decisionVerifier.verifiesDecisionAccountability(
                rosterHash,
                requestId,
                request.requestDigest,
                msg.sender,
                uint8(decision),
                accountabilitySignature
            )
        ) revert InvalidAccountabilitySignature();
        bytes32 accountabilityDigest = keccak256(accountabilitySignature);
        decisions[requestId][msg.sender] = DecisionRecord({
            member: msg.sender,
            decision: decision,
            evidenceDigest: evidenceDigest,
            accountabilityDigest: accountabilityDigest,
            submittedBlock: block.number,
            challenged: false
        });
        ++participationWeight[msg.sender];
        ++totalParticipationWeight;
        ++decisionCount;
        workAccumulator = keccak256(
            abi.encode(
                WORK_ACCUMULATOR_DOMAIN,
                workAccumulator,
                uint8(3),
                requestId,
                msg.sender,
                decision,
                evidenceDigest,
                accountabilityDigest,
                block.number
            )
        );
        emit DecisionRecorded(
            requestId,
            msg.sender,
            decision,
            evidenceDigest,
            accountabilityDigest,
            block.number
        );
    }

    function challengeDecision(bytes32 requestId, address member, bytes calldata evidence) external {
        if (finalized || block.number > challengeEndBlock) revert ChallengeWindowClosed();
        DecisionRecord storage record = decisions[requestId][member];
        if (record.member == address(0)) revert DecisionNotRecorded();
        bytes32 challengeId = keccak256(abi.encode(address(this), requestId, member));
        if (successfulChallenge[challengeId]) revert ChallengeAlreadySucceeded();
        if (
            !decisionVerifier.provesInvalidDecision(
                rosterHash,
                requestId,
                requests[requestId].requestDigest,
                member,
                uint8(record.decision),
                record.evidenceDigest,
                evidence
            )
        ) revert ChallengeNotProved();
        successfulChallenge[challengeId] = true;
        record.challenged = true;
        --participationWeight[member];
        --totalParticipationWeight;
        ++successfulChallengeCount;
        bytes32 challengeEvidenceDigest = keccak256(evidence);
        workAccumulator = keccak256(
            abi.encode(
                WORK_ACCUMULATOR_DOMAIN,
                workAccumulator,
                uint8(4),
                requestId,
                member,
                challengeId,
                challengeEvidenceDigest,
                block.number
            )
        );
        emit DecisionChallenged(requestId, member, challengeId, challengeEvidenceDigest);
    }

    function finalizeEpoch() external returns (bytes32 digest) {
        if (finalized) revert AlreadyFinalized();
        if (block.number <= challengeEndBlock) revert FinalizationTooEarly();
        uint256[MEMBER_COUNT] memory readiness;
        uint256[MEMBER_COUNT] memory participation;
        for (uint256 i = 0; i < MEMBER_COUNT; ++i) {
            readiness[i] = readinessWeight[members[i]];
            participation[i] = participationWeight[members[i]];
        }
        bytes32 workSummaryDigest = keccak256(
            abi.encode(
                workAccumulator,
                requestCount,
                decisionCount,
                readiness,
                participation,
                totalReadinessWeight,
                totalParticipationWeight,
                successfulChallengeCount
            )
        );
        digest = keccak256(
            abi.encode(
                FINALIZATION_DOMAIN,
                block.chainid,
                address(this),
                rosterHash,
                epochStartBlock,
                epochEndBlock,
                challengeEndBlock,
                workSummaryDigest
            )
        );
        finalized = true;
        finalizationDigest = digest;
        emit EpochFinalized(
            rosterHash,
            digest,
            totalReadinessWeight,
            totalParticipationWeight,
            successfulChallengeCount
        );
    }

    function currentReadinessWindow() public view returns (uint256) {
        requireEpochOpen();
        return (block.number - epochStartBlock) / readinessWindowBlocks;
    }

    function requireOperationalMember() private view {
        if (!registry.isMember(msg.sender)) revert NotMember();
        requireEpochOpen();
        requireActiveBondedRoster();
    }

    function requireActiveBondedRoster() private view {
        if (!registry.active()) revert RosterInactive();
        if (!bondVault.allBondsPosted(rosterHash)) revert BondsNotReady();
    }

    function requireEpochOpen() private view {
        if (block.number < epochStartBlock) revert EpochNotOpen();
        if (block.number > epochEndBlock) revert EpochClosed();
    }
}
