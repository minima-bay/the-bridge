// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
}

interface IMinimaProofVerifier {
    function verifyCancellation(bytes calldata proof)
        external view returns (bytes32 recordId, bytes32 messageId, uint128 amount, address refundRecipient, bytes32 bridgeRuntimeIdentity, bool settled);
    function verifyRedemption(bytes calldata proof)
        external view returns (bytes32 redemptionId, uint128 amount, address recipient, bytes32 bridgeRuntimeIdentity, bool settled);
}

contract USDTmVaultV1 {
    enum DepositStatus { ABSENT, PENDING, REFUNDED }

    struct DepositRecord {
        DepositStatus status;
        uint128 amount;
        bytes32 messageId;
        bytes32 minimaRecipient;
        address refundRecipient;
        bytes32 cancellationAuthority;
        uint64 configurationEpoch;
    }

    struct PayoutRecord {
        bytes32 redemptionId;
        uint128 amount;
        address recipient;
        uint128 cumulativePaidAtoms;
    }

    bytes32 public constant DEPOSIT_DOMAIN = keccak256("MINIMA_USDTM_DEPOSIT_V1");
    address public immutable token;
    address public immutable minimaProofVerifier;
    bytes32 public immutable destinationNetworkId;
    bytes32 public immutable destinationBridgeDeploymentId;
    bytes32 public immutable destinationTokenId;
    bytes32 public immutable reserveCovenantCommitment;
    bytes32 public immutable runtimeIdentity;
    uint64 public immutable configurationEpoch;
    uint128 public immutable fixedCapacityAtoms;

    uint128 public cumulativeAcceptedAtoms;
    uint128 public cumulativeRefundedAtoms;
    uint128 public cumulativePaidRedemptionAtoms;
    uint64 public payoutRecordCount;
    bool private locked;

    mapping(bytes32 => DepositRecord) public deposits;
    mapping(bytes32 => bool) public consumedRedemptions;
    mapping(uint64 => PayoutRecord) public payoutRecords;

    event DepositAccepted(bytes32 indexed recordId, bytes32 indexed messageId, uint128 amount, bytes32 minimaRecipient, address refundRecipient);
    event DepositRefunded(bytes32 indexed recordId, uint128 amount, address refundRecipient);
    event RedemptionPaid(uint64 indexed payoutRecordId, bytes32 indexed redemptionId, uint128 amount, address recipient, uint128 cumulativePaidAtoms);

    error InvalidRecord();
    error InvalidRecipient();
    error CapacityExceeded();
    error ProofRejected();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address token_,
        address minimaProofVerifier_,
        bytes32 destinationNetworkId_,
        bytes32 destinationBridgeDeploymentId_,
        bytes32 destinationTokenId_,
        bytes32 reserveCovenantCommitment_,
        uint64 configurationEpoch_,
        uint128 fixedSupplyAtoms_
    ) {
        if (token_ == address(0) || minimaProofVerifier_ == address(0) || fixedSupplyAtoms_ <= 1) revert InvalidRecord();
        token = token_;
        minimaProofVerifier = minimaProofVerifier_;
        destinationNetworkId = destinationNetworkId_;
        destinationBridgeDeploymentId = destinationBridgeDeploymentId_;
        destinationTokenId = destinationTokenId_;
        reserveCovenantCommitment = reserveCovenantCommitment_;
        configurationEpoch = configurationEpoch_;
        fixedCapacityAtoms = fixedSupplyAtoms_ - 1;
        runtimeIdentity = keccak256(abi.encode(block.chainid, address(this), token_, minimaProofVerifier_, destinationNetworkId_, destinationBridgeDeploymentId_, destinationTokenId_, reserveCovenantCommitment_, configurationEpoch_));
    }

    function usedCapacityAtoms() public view returns (uint128) {
        return cumulativeAcceptedAtoms - cumulativeRefundedAtoms - cumulativePaidRedemptionAtoms;
    }

    function recordIdFor(bytes32 messageId) public view returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_DOMAIN, block.chainid, address(this), token, runtimeIdentity, messageId));
    }

    function acceptDeposit(
        bytes32 messageId,
        uint128 requestedAmount,
        bytes32 minimaRecipient,
        address refundRecipient,
        bytes32 cancellationAuthority
    ) external nonReentrant returns (bytes32 recordId, uint128 receivedAmount) {
        if (messageId == bytes32(0) || minimaRecipient == bytes32(0) || refundRecipient == address(0) || cancellationAuthority == bytes32(0) || requestedAmount == 0) revert InvalidRecipient();
        recordId = recordIdFor(messageId);
        if (deposits[recordId].status != DepositStatus.ABSENT) revert InvalidRecord();
        uint256 beforeBalance = _balance();
        _safeCall(token, abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), msg.sender, address(this), uint256(requestedAmount)));
        uint256 afterBalance = _balance();
        if (afterBalance <= beforeBalance || afterBalance - beforeBalance > type(uint128).max) revert TransferFailed();
        receivedAmount = uint128(afterBalance - beforeBalance);
        if (uint256(usedCapacityAtoms()) + receivedAmount > fixedCapacityAtoms) revert CapacityExceeded();
        deposits[recordId] = DepositRecord(DepositStatus.PENDING, receivedAmount, messageId, minimaRecipient, refundRecipient, cancellationAuthority, configurationEpoch);
        cumulativeAcceptedAtoms += receivedAmount;
        emit DepositAccepted(recordId, messageId, receivedAmount, minimaRecipient, refundRecipient);
    }

    function refund(bytes calldata proof) external nonReentrant {
        (bytes32 recordId, bytes32 messageId, uint128 amount, address refundRecipient, bytes32 proofRuntimeIdentity, bool settled) = IMinimaProofVerifier(minimaProofVerifier).verifyCancellation(proof);
        DepositRecord storage record = deposits[recordId];
        if (!settled || proofRuntimeIdentity != runtimeIdentity || record.status != DepositStatus.PENDING || record.messageId != messageId || record.amount != amount || record.refundRecipient != refundRecipient) revert ProofRejected();
        record.status = DepositStatus.REFUNDED;
        cumulativeRefundedAtoms += amount;
        _safeCall(token, abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), refundRecipient, uint256(amount)));
        emit DepositRefunded(recordId, amount, refundRecipient);
    }

    function payRedemption(bytes calldata proof) external nonReentrant {
        (bytes32 redemptionId, uint128 amount, address recipient, bytes32 proofRuntimeIdentity, bool settled) = IMinimaProofVerifier(minimaProofVerifier).verifyRedemption(proof);
        if (!settled || proofRuntimeIdentity != runtimeIdentity || redemptionId == bytes32(0) || recipient == address(0) || amount == 0 || consumedRedemptions[redemptionId] || amount > usedCapacityAtoms()) revert ProofRejected();
        uint64 payoutRecordId = payoutRecordCount + 1;
        uint128 newCumulativePaidAtoms = cumulativePaidRedemptionAtoms + amount;
        consumedRedemptions[redemptionId] = true;
        cumulativePaidRedemptionAtoms = newCumulativePaidAtoms;
        payoutRecordCount = payoutRecordId;
        payoutRecords[payoutRecordId] = PayoutRecord(redemptionId, amount, recipient, newCumulativePaidAtoms);
        _safeCall(token, abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), recipient, uint256(amount)));
        emit RedemptionPaid(payoutRecordId, redemptionId, amount, recipient, newCumulativePaidAtoms);
    }

    function _balance() private view returns (uint256 value) {
        (bool success, bytes memory result) = token.staticcall(abi.encodeWithSelector(IERC20Like.balanceOf.selector, address(this)));
        if (!success || result.length != 32) revert TransferFailed();
        value = abi.decode(result, (uint256));
    }

    function _safeCall(address target, bytes memory data) private {
        (bool success, bytes memory result) = target.call(data);
        if (!success || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) revert TransferFailed();
    }
}
