# Generic bridge P8 action records v2

Status: offline candidate for the P8 all-branch covenant gate. These records do not authorize a mainnet ceremony.

## 1. Purpose

The P7 mainnet covenants accepted only RELEASE. P8 therefore uses a fresh lane generation with one exact, action-dispatched covenant and five domain-separated records: CLIENT_UPDATE, RELEASE, RETURN, CANCEL, and PAYOUT_ACK. Each record is fixed width for its action. There is no unchecked padding.

The signed digest is:

`SHA3-256(SHA3-256(ASCII("BRIDGE_P8_RECORD_V1")) || canonical_record_bytes)`

All integers are unsigned, big-endian, and must fit their stated width. Hex fields have exactly the stated byte length. ASCII domain tags are zero padded to 32 bytes.

## 2. Action table

| Action | Code | Domain tag | Bytes | Fields | Authorization |
|---|---:|---|---:|---:|---|
| CLIENT_UPDATE | 1 | `BRIDGE_LANE_CLIENT_V2` | 501 | 32 | 5-of-7 committee |
| RELEASE | 2 | `BRIDGE_LANE_RELEASE_V2` | 581 | 36 | 5-of-7 committee |
| RETURN | 3 | `BRIDGE_LANE_RETURN_V2` | 417 | 26 | owner signature for the returned input coin |
| CANCEL | 5 | `BRIDGE_LANE_CANCEL_V2` | 634 | 39 | 5-of-7 committee plus cancellation authority |
| PAYOUT_ACK | 7 | `BRIDGE_LANE_PAYOUT_V2` | 661 | 40 | 5-of-7 committee |

`schemaVersion` is 1 and `laneVersion` is 2. The action code and domain tag must agree.

## 3. Common prefix

Every action has the same 317-byte prefix.

| Offset | Width | Field |
|---:|---:|---|
| 0 | 32 | domainTag |
| 32 | 2 | schemaVersion |
| 34 | 2 | action |
| 36 | 2 | laneVersion |
| 38 | 1 | sourceAssetKind, 0 native or 1 ERC-20 |
| 39 | 1 | sourceDecimals |
| 40 | 1 | destinationDecimals |
| 41 | 8 | sourceQuantumAtoms |
| 49 | 8 | destinationQuantumAtoms |
| 57 | 8 | laneExposureCapDestinationAtoms |
| 65 | 8 | ethereumChainId |
| 73 | 32 | minimaNetwork |
| 105 | 20 | ethereumVault |
| 125 | 20 | sourceAsset, zero only for native ETH |
| 145 | 32 | laneId |
| 177 | 32 | destinationTokenId |
| 209 | 32 | reserveCovenant |
| 241 | 32 | controlTokenId |
| 273 | 8 | configurationEpoch |
| 281 | 4 | committeeEpoch |
| 285 | 32 | committeeRoot |

These values must equal the predecessor control state. They cannot be changed by an action record.

## 4. Action suffixes

The executable encoder files are the normative byte order. The suffix begins at byte 317.

### CLIENT_UPDATE

`previousVaultStateVersion:u64, vaultStateVersion:u64, finalizedBlockNumber:u64, finalizedBlockHash:bytes32, sourceRecordHash:bytes32, newClientStateHash:bytes32, newBridgeStateHash:bytes32, vaultBalanceSourceAtoms:u64, vaultPayoutCursor:u64, vaultCumulativePaidSourceAtoms:u64, sourceExecutionTimeMilliseconds:u64`

### RELEASE

`depositId:bytes32, amountSourceAtoms:u64, amountDestinationAtoms:u64, minimaRecipient:bytes32, finalizedBlockNumber:u64, finalizedBlockHash:bytes32, sourceRecordHash:bytes32, previousVaultStateVersion:u64, vaultStateVersion:u64, newClientStateHash:bytes32, newBridgeStateHash:bytes32, vaultBalanceSourceAtoms:u64, vaultPayoutCursor:u64, vaultCumulativePaidSourceAtoms:u64, sourceExecutionTimeMilliseconds:u64`

### RETURN

`returnedCoinId:bytes32, amountSourceAtoms:u64, amountDestinationAtoms:u64, ethereumRecipient:bytes20, redemptionId:bytes32`

### CANCEL

`depositId:bytes32, amountSourceAtoms:u64, amountDestinationAtoms:u64, minimaRecipient:bytes32, refundRecipient:bytes20, cancellationAuthorityPublicKey:bytes32, ethereumRecordStatus:u8, finalizedBlockNumber:u64, finalizedBlockHash:bytes32, sourceRecordHash:bytes32, previousVaultStateVersion:u64, vaultStateVersion:u64, newClientStateHash:bytes32, newBridgeStateHash:bytes32, vaultBalanceSourceAtoms:u64, vaultPayoutCursor:u64, vaultCumulativePaidSourceAtoms:u64, sourceExecutionTimeMilliseconds:u64`

### PAYOUT_ACK

`payoutBatchId:bytes32, priorPayoutCursor:u64, newPayoutCursor:u64, priorCumulativePaidSourceAtoms:u64, newCumulativePaidSourceAtoms:u64, batchPaidSourceAtoms:u64, batchPaidDestinationAtoms:u64, firstRedemptionId:bytes32, lastRedemptionId:bytes32, payoutRangeRoot:bytes32, finalizedBlockNumber:u64, finalizedBlockHash:bytes32, sourceRecordHash:bytes32, previousVaultStateVersion:u64, vaultStateVersion:u64, newClientStateHash:bytes32, newBridgeStateHash:bytes32, vaultBalanceSourceAtoms:u64, sourceExecutionTimeMilliseconds:u64`

## 5. Semantic equations

- Amounts are positive and exactly convertible: `sourceAmount * destinationQuantum == destinationAmount * sourceQuantum`.
- CLIENT_UPDATE advances exactly one authenticated vault version and preserves reserve accounting.
- RELEASE consumes an unused deposit, advances or validly reuses an authenticated head, and changes `(R,I,P)` to `(R-A,I+A,P)`.
- RETURN binds the exact input coin ID, amount, Ethereum recipient, and deterministic redemption ID, and changes `(R,I,P)` to `(R+A,I-A,P+A)`.
- CANCEL authenticates PENDING status (`ethereumRecordStatus = 1`), the exact pending record, committee, and cancellation authority. It preserves `(R,I,P)`.
- PAYOUT_ACK advances the cursor exactly one contiguous batch, proves `newPaid-priorPaid=batchPaidSourceAtoms`, converts that batch exactly, and changes `(R,I,P)` to `(R,I,P-batchPaidDestinationAtoms)`.
- Every authenticated-head action binds the prior version. A rejected action must leave the complete transaction state unchanged.
- Post-transition collateral must satisfy `(I+P)*sourceQuantum <= L*destinationQuantum` and `I+P <= laneExposureCapDestinationAtoms`.

## 6. Redemption identifier

`redemptionId = SHA-256(ASCII_PAD32("BRIDGE_LANE_REDEMPTION_V2") || minimaNetwork || laneId || destinationTokenId || reserveCovenant || returnedCoinId || UINT64_BE(amountDestinationAtoms) || ethereumRecipient || UINT64_BE(configurationEpoch))`

This identifier binds the returned Minima coin to the later Ethereum payout acknowledgement.

## 7. Evidence boundary

Encoder parity and field mutation prove canonical offline bytes only. P8 additionally requires the unified KISS branches to execute against exact transaction shapes with fresh signatures and hostile mutations. Node `txncheck`, mining, and a new mainnet lane ceremony remain later, separately authorized evidence.
