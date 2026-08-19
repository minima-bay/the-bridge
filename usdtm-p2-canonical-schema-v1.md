# USDTm P2 canonical schema v1

Status: P2 canonical schema gate passed locally. Six record families are frozen and independently
encoded. This file is not evidence of a verifier, signature opcode, covenant or chain runtime.

## 1. Canonical enums

All integers are unsigned big-endian. All fixed byte fields are raw bytes, never hexadecimal or
address text inside the encoded record.

Actions use UINT16: `CLIENT_UPDATE=1`, `RELEASE=2`, `RETURN=3`, `PAYOUT_ACK=4`,
`CANCEL_DEPOSIT=5`, `REFUND=6`, `REDEMPTION_PAYOUT=7`.

Ethereum deposit status uses UINT8: `ABSENT=0`, `PENDING=1`, `REFUNDED=2`. Minima nullifier status
uses UINT8: `EMPTY=0`, `RELEASED=1`, `CANCELLED=2`. The two state spaces are never merged.

Authority scheme uses UINT16. Value 1 means a 32-byte Ed25519 public key for this valueless research
fixture. Runtime availability and production suitability are not established and remain blocking
P6/P8 evidence.

## 2. Encoding rules

- Domain tags are ASCII copied at offset zero into a 32-byte zero-filled field.
- Hashes, IDs, addresses, token IDs, recipients and public keys have their listed exact raw width.
- Amounts are UINT128. Chain ID, configuration epoch and client counters use their listed width.
- No length prefix, field name, separator, JSON text, hexadecimal text or variable-width integer is
  included.
- The record commitment and cancellation signing digest are SHA2-256 of the complete 512-byte
  record.
- A decoder must reject missing, extra, reordered, noncanonical or out-of-range fields before any
  signature or state transition is considered.

## 3. Cancellation authorization record

The domain is `MINIMA_USDTM_CANCEL_V1`. The action is 5, the authenticated Ethereum record status is
1 (`PENDING`), and the expected Minima nullifier status is 0 (`EMPTY`).

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 32 | zero-padded domain tag |
| 32 | 2 | schema version |
| 34 | 2 | action |
| 36 | 8 | source chain ID |
| 44 | 32 | source genesis commitment |
| 76 | 32 | destination network ID |
| 108 | 32 | source bridge deployment ID |
| 140 | 20 | source vault address |
| 160 | 32 | destination bridge deployment ID |
| 192 | 32 | reserve covenant commitment |
| 224 | 20 | source token address |
| 244 | 32 | destination token ID |
| 276 | 32 | source record ID |
| 308 | 32 | message ID |
| 340 | 16 | source amount atoms |
| 356 | 16 | destination amount atoms |
| 372 | 4 | decimal scale |
| 376 | 32 | raw Minima recipient bytes |
| 408 | 20 | raw Ethereum refund recipient |
| 428 | 2 | authority scheme |
| 430 | 32 | authority public key |
| 462 | 8 | configuration epoch |
| 470 | 1 | authenticated Ethereum record status |
| 471 | 1 | expected Minima nullifier status |
| 472 | 4 | proof-program version |
| 476 | 4 | verifier version |
| 480 | 32 | verification-key hash |

Total: exactly 512 bytes. The fixed fixture commitment is
`b52171ece1092767811a99d301785f9097967b2327bf91ac4c663507d2650736`.

The source-chain proof must authenticate every record field against current finalized storage. The
cancellation authority signs the 32-byte record commitment. The Minima transition additionally
requires the live nullifier leaf to be `EMPTY`; `RELEASED` and `CANCELLED` both reject.

## 4. Independent encoder gate

`usdtm-p2-primary-encoder.mjs` is layout-driven. `usdtm-p2-independent-encoder.mjs` is a separately
written explicit concatenation. `validate-usdtm-p2-cancellation.mjs` requires byte-for-byte equality,
the fixed fixture hash, a changed commitment for every field mutation, and rejection-domain changes
for wrong action or state.

## 5. Remaining canonical records

The notation `name:width` means raw bytes of that exact width. `uN` means an unsigned N-bit
big-endian integer. Field order below is encoding order. The exact executable layout is
`recordLayouts` in `usdtm-p2-records-primary.mjs`; the separately written encoder does not import it.

### 5.1 Deposit and release record, 624 bytes

`domainTag:32, schemaVersion:u16, action:u16, sourceChainId:u64,
sourceGenesisCommitment:32, sourceBridgeDeploymentId:32, vaultAddress:20,
sourceTokenAddress:20, destinationNetworkId:32, destinationBridgeDeploymentId:32,
destinationTokenId:32, reserveCovenantCommitment:32, sourceRecordId:32, messageId:32,
sourceAmountAtoms:u128, destinationAmountAtoms:u128, decimalScale:u32, minimaRecipient:32,
refundRecipient:20, authorityScheme:u16, authorityPublicKey:32, configurationEpoch:u64,
ethereumRecordStatus:u8, expectedMinimaNullifierStatus:u8, sourceBlockNumber:u64,
sourceTimestampMs:u64, sourceStorageRoot:32, vaultBalanceAtoms:u128, fixedCapacityAtoms:u128,
usedCapacityBeforeAtoms:u128, usedCapacityAfterAtoms:u128, proofProgramVersion:u32,
verifierVersion:u32, verificationKeyHash:32`.

Domain is `MINIMA_USDTM_DEPOSIT_V1`, action is `RELEASE=2`, Ethereum status is `PENDING=1`, and
expected Minima status is `EMPTY=0`. Require positive amounts,
`sourceAmountAtoms * decimalScale = destinationAmountAtoms`,
`usedAfter = usedBefore + destinationAmountAtoms`, and `usedAfter <= fixedCapacityAtoms`.

### 5.2 Refund record, 502 bytes

`domainTag:32, schemaVersion:u16, action:u16, sourceChainId:u64,
sourceGenesisCommitment:32, sourceBridgeDeploymentId:32, vaultAddress:20,
sourceTokenAddress:20, destinationNetworkId:32, destinationBridgeDeploymentId:32,
sourceRecordId:32, messageId:32, amountAtoms:u128, refundRecipient:20,
recordStatusBefore:u8, recordStatusAfter:u8, cancellationTxpowId:32,
cancellationOutputIndex:u32, cancellationStateCommitment:32, minimaHeight:u64,
minimaBranchCommitment:32, capacityBeforeAtoms:u128, capacityAfterAtoms:u128,
configurationEpoch:u64, proofProgramVersion:u32, verifierVersion:u32,
verificationKeyHash:32`.

Domain is `MINIMA_USDTM_REFUND_V1`, action is `REFUND=6`, and the only accepted record transition
is `PENDING=1` to `REFUNDED=2`. Require `capacityAfter = capacityBefore - amount` without underflow.

### 5.3 Redemption publication, 460 bytes

`domainTag:32, schemaVersion:u16, action:u16, destinationNetworkId:32,
destinationBridgeDeploymentId:32, destinationTokenId:32, reserveCovenantCommitment:32,
sourceChainId:u64, sourceBridgeDeploymentId:32, redemptionId:32, returnedCoinId:32,
returnedAmountAtoms:u128, ethereumRecipient:20, txpowId:32, stateOutputIndex:u32,
stateCommitment:32, minimaHeight:u64, minimaBranchCommitment:32, configurationEpoch:u64,
proofProgramVersion:u32, verifierVersion:u32, verificationKeyHash:32`.

Domain is `MINIMA_USDTM_REDEEM_V1`, action is `RETURN=3`, and `redemptionId` must equal the exact
binary formula already fixed in `reserve-covenant-transition-spec-v1.md`.

### 5.4 Cumulative payout batch, 484 bytes

`domainTag:32, schemaVersion:u16, action:u16, sourceChainId:u64,
sourceGenesisCommitment:32, sourceBridgeDeploymentId:32, vaultAddress:20,
sourceTokenAddress:20, destinationNetworkId:32, destinationBridgeDeploymentId:32,
priorCursor:u64, newCursor:u64, priorCumulativePaidAtoms:u128,
newCumulativePaidAtoms:u128, batchPaidAtoms:u128, firstRedemptionId:32,
lastRedemptionId:32, payoutRangeRoot:32, vaultBalanceAtoms:u128, sourceBlockNumber:u64,
sourceTimestampMs:u64, sourceStateRoot:32, configurationEpoch:u64,
proofProgramVersion:u32, verifierVersion:u32, verificationKeyHash:32`.

Domain is `MINIMA_USDTM_PAYOUT_V1`, action is `REDEMPTION_PAYOUT=7`. Require `newCursor >
priorCursor`, a non-empty committed contiguous range, and
`newCumulative - priorCumulative = batchPaidAtoms > 0`.

### 5.5 Ethereum client state, 452 bytes

`domainTag:32, schemaVersion:u16, action:u16, sourceChainId:u64,
sourceGenesisCommitment:32, sourceBridgeDeploymentId:32, vaultAddress:20,
sourceTokenAddress:20, destinationNetworkId:32, destinationBridgeDeploymentId:32,
previousClientCommitment:32, newClientCommitment:32, finalizedSlot:u64,
executionBlockNumber:u64, sourceTimestampMs:u64, executionStateRoot:32,
vaultBalanceAtoms:u128, payoutCursor:u64, cumulativePaidAtoms:u128,
destinationAcceptanceBlock:u64, destinationAcceptanceTimestampMs:u64,
maximumSourceAgeMs:u64, maximumFutureSkewMs:u64, configurationEpoch:u64,
proofProgramVersion:u32, verifierVersion:u32, verificationKeyHash:32`.

Domain is `MINIMA_USDTM_CLIENT_V1`, action is `CLIENT_UPDATE=1`, and prior and new commitments must
differ. KISS needs only guarded subtraction comparisons, never division:

```text
sourceTimestampMs <= destinationAcceptanceTimestampMs + maximumFutureSkewMs
destinationAcceptanceTimestampMs <= sourceTimestampMs + maximumSourceAgeMs
```

## 6. P2 evidence and limits

The cancellation fixture plus the five-record fixture cover 163 security-bound fields. Both pairs
of independent encoders agree byte for byte. Every one-field mutation changes the relevant fixed
commitment, and semantic negatives cover all allowed status transitions, capacity arithmetic,
cumulative payout arithmetic, the redemption ID and both timestamp bounds.

The existing `bridge-public-inputs-v1` fixture remains an older limited schema and is not evidence
for these records. P2 fixes bytes only. P5 through P9 must still prove chain inclusion, consensus,
proof verification, signature runtime, KISS execution and mineability.
