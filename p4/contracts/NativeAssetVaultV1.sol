// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IMinimaProofVerifier} from "./USDTmVaultV1.sol";

contract NativeAssetVaultV1 {
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

    uint8 public constant SOURCE_ASSET_KIND = 0;
    address public constant SOURCE_ASSET = address(0);
    uint8 public constant SOURCE_DECIMALS = 18;
    uint128 public constant SINGLE_LIMB_MAX_ATOMS = type(uint64).max;
    bytes32 public constant DEPOSIT_DOMAIN = keccak256("MINIMA_GENERIC_NATIVE_DEPOSIT_V1");

    address public immutable minimaProofVerifier;
    bytes32 public immutable destinationNetworkId;
    bytes32 public immutable destinationBridgeDeploymentId;
    bytes32 public immutable destinationTokenId;
    bytes32 public immutable reserveCovenantCommitment;
    bytes32 public immutable laneId;
    bytes32 public immutable runtimeIdentity;
    uint64 public immutable configurationEpoch;
    uint128 public immutable fixedCapacityAtoms;

    uint128 public cumulativeAcceptedAtoms;
    uint128 public cumulativeRefundedAtoms;
    uint128 public cumulativePaidRedemptionAtoms;
    uint128 public accountedNativeAtoms;
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
    error DirectNativeTransfer();

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address minimaProofVerifier_,
        bytes32 destinationNetworkId_,
        bytes32 destinationBridgeDeploymentId_,
        bytes32 destinationTokenId_,
        bytes32 reserveCovenantCommitment_,
        uint64 configurationEpoch_,
        uint128 fixedSupplyAtoms_
    ) {
        if (
            minimaProofVerifier_ == address(0)
                || destinationTokenId_ == bytes32(0)
                || fixedSupplyAtoms_ <= 1
                || fixedSupplyAtoms_ > SINGLE_LIMB_MAX_ATOMS + 1
        ) revert InvalidRecord();
        minimaProofVerifier = minimaProofVerifier_;
        destinationNetworkId = destinationNetworkId_;
        destinationBridgeDeploymentId = destinationBridgeDeploymentId_;
        destinationTokenId = destinationTokenId_;
        reserveCovenantCommitment = reserveCovenantCommitment_;
        configurationEpoch = configurationEpoch_;
        fixedCapacityAtoms = fixedSupplyAtoms_ - 1;
        laneId = keccak256(abi.encode(
            "GENERIC_BRIDGE_LANE_V1",
            block.chainid,
            address(this),
            SOURCE_ASSET_KIND,
            SOURCE_ASSET,
            SOURCE_DECIMALS,
            destinationNetworkId_,
            destinationBridgeDeploymentId_,
            destinationTokenId_,
            reserveCovenantCommitment_,
            configurationEpoch_
        ));
        runtimeIdentity = keccak256(abi.encode(block.chainid, address(this), laneId, minimaProofVerifier_));
    }

    receive() external payable {
        revert DirectNativeTransfer();
    }

    function usedCapacityAtoms() public view returns (uint128) {
        return cumulativeAcceptedAtoms - cumulativeRefundedAtoms - cumulativePaidRedemptionAtoms;
    }

    function unaccountedNativeWei() external view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > accountedNativeAtoms ? balance - accountedNativeAtoms : 0;
    }

    function recordIdFor(bytes32 messageId) public view returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_DOMAIN, block.chainid, address(this), laneId, runtimeIdentity, messageId));
    }

    function acceptNativeDeposit(
        bytes32 messageId,
        bytes32 minimaRecipient,
        address refundRecipient,
        bytes32 cancellationAuthority
    ) external payable nonReentrant returns (bytes32 recordId, uint128 receivedAmount) {
        if (messageId == bytes32(0) || minimaRecipient == bytes32(0) || refundRecipient == address(0) || cancellationAuthority == bytes32(0) || msg.value == 0 || msg.value > type(uint128).max) revert InvalidRecipient();
        recordId = recordIdFor(messageId);
        if (deposits[recordId].status != DepositStatus.ABSENT) revert InvalidRecord();
        receivedAmount = uint128(msg.value);
        if (uint256(usedCapacityAtoms()) + receivedAmount > fixedCapacityAtoms) revert CapacityExceeded();
        deposits[recordId] = DepositRecord(DepositStatus.PENDING, receivedAmount, messageId, minimaRecipient, refundRecipient, cancellationAuthority, configurationEpoch);
        cumulativeAcceptedAtoms += receivedAmount;
        accountedNativeAtoms += receivedAmount;
        emit DepositAccepted(recordId, messageId, receivedAmount, minimaRecipient, refundRecipient);
    }

    function refund(bytes calldata proof) external nonReentrant {
        (bytes32 recordId, bytes32 messageId, uint128 amount, address refundRecipient, bytes32 proofRuntimeIdentity, bool settled) = IMinimaProofVerifier(minimaProofVerifier).verifyCancellation(proof);
        DepositRecord storage record = deposits[recordId];
        if (!settled || proofRuntimeIdentity != runtimeIdentity || record.status != DepositStatus.PENDING || record.messageId != messageId || record.amount != amount || record.refundRecipient != refundRecipient) revert ProofRejected();
        record.status = DepositStatus.REFUNDED;
        cumulativeRefundedAtoms += amount;
        accountedNativeAtoms -= amount;
        _sendNative(refundRecipient, amount);
        emit DepositRefunded(recordId, amount, refundRecipient);
    }

    function payRedemption(bytes calldata proof) external nonReentrant {
        (bytes32 redemptionId, uint128 amount, address recipient, bytes32 proofRuntimeIdentity, bool settled) = IMinimaProofVerifier(minimaProofVerifier).verifyRedemption(proof);
        if (!settled || proofRuntimeIdentity != runtimeIdentity || redemptionId == bytes32(0) || recipient == address(0) || amount == 0 || consumedRedemptions[redemptionId] || amount > usedCapacityAtoms() || amount > accountedNativeAtoms) revert ProofRejected();
        uint64 payoutRecordId = payoutRecordCount + 1;
        uint128 newCumulativePaidAtoms = cumulativePaidRedemptionAtoms + amount;
        consumedRedemptions[redemptionId] = true;
        cumulativePaidRedemptionAtoms = newCumulativePaidAtoms;
        accountedNativeAtoms -= amount;
        payoutRecordCount = payoutRecordId;
        payoutRecords[payoutRecordId] = PayoutRecord(redemptionId, amount, recipient, newCumulativePaidAtoms);
        _sendNative(recipient, amount);
        emit RedemptionPaid(payoutRecordId, redemptionId, amount, recipient, newCumulativePaidAtoms);
    }

    function _sendNative(address recipient, uint128 amount) private {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
