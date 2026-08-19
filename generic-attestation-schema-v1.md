# Generic bridge attestation schema v1

Date: 2026-08-19

Status: canonical bytes frozen for the offline P7 transaction benchmark, valueless only

## 1. Authentication form

Seven ordered committee public keys are fixed by the lane configuration. Any five sign the complete
Minima transaction ID using native TreeKey/WOTS signatures. The control covenant uses `MULTISIG(5,
...)`. It does not accept a signature over a detached JSON or text record.

The complete transaction signature binds the consumed control and reserve coins, the 444-byte record
in transaction state, every successor state field and every output. This avoids storing five large
`CHECKSIG` signatures in the successor control coin. Operators still calculate the following record
digest for deterministic comparison, logging, and later slashing evidence:

```text
domainHash = SHA3-256(ASCII("BRIDGE_LANE_ATTESTATION_V1"))
recordDigest = SHA3-256(domainHash || canonicalRecordBytes)
```

The record digest is not a substitute for the transaction signature. A signature collected for one
control coin cannot be replayed after that coin is spent.

## 2. Canonical layout

All integers are unsigned, fixed-width, big-endian. Hex fields are raw bytes, never text. The record
contains exactly 31 fields and exactly 444 bytes.

| Order | Field | Bytes | Rule |
|---:|---|---:|---|
| 1 | `schemaVersion` | 2 | Exactly 1 |
| 2 | `direction` | 1 | Exactly 1 for Ethereum to Minima |
| 3 | `laneVersion` | 2 | Exactly 1 |
| 4 | `sourceAssetKind` | 1 | 0 native, 1 ERC-20 |
| 5 | `sourceDecimals` | 1 | Exact immutable source decimals |
| 6 | `destinationDecimals` | 1 | Exact Minima token decimals |
| 7 | `sourceQuantumAtoms` | 8 | Positive conversion quantum |
| 8 | `destinationQuantumAtoms` | 8 | Positive destination atoms per source quantum |
| 9 | `laneExposureCapDestinationAtoms` | 8 | Lane-local hard cap |
| 10 | `ethereumChainId` | 8 | Exact source chain |
| 11 | `minimaNetwork` | 32 | Exact Minima mainnet domain |
| 12 | `ethereumVault` | 20 | Exact immutable lane vault |
| 13 | `sourceAsset` | 20 | Zero for native ETH, exact token otherwise |
| 14 | `laneId` | 32 | Hash commitment to immutable lane configuration |
| 15 | `destinationTokenId` | 32 | Exact Minima representation token |
| 16 | `reserveCovenant` | 32 | Exact reserve covenant address |
| 17 | `depositId` | 32 | Exact persistent source record ID |
| 18 | `amountSourceAtoms` | 8 | Positive source atomic amount |
| 19 | `amountDestinationAtoms` | 8 | Exact converted destination atomic amount |
| 20 | `minimaRecipient` | 32 | Exact raw Minima destination address |
| 21 | `finalizedBlockNumber` | 8 | Source execution block |
| 22 | `finalizedBlockHash` | 32 | Source execution block hash |
| 23 | `sourceRecordHash` | 32 | Canonical Ethereum vault record hash |
| 24 | `vaultStateVersion` | 8 | Monotonic finalized vault snapshot version |
| 25 | `vaultBalanceSourceAtoms` | 8 | Attributable collateral only |
| 26 | `vaultPayoutCursor` | 8 | Finalized append-only payout cursor |
| 27 | `vaultCumulativePaidSourceAtoms` | 8 | Finalized cumulative paid amount |
| 28 | `committeeEpoch` | 4 | Exact active epoch |
| 29 | `committeeRoot` | 32 | Ordered seven-key commitment |
| 30 | `configurationEpoch` | 8 | Exact lane configuration epoch |
| 31 | `sourceExecutionTimeMilliseconds` | 8 | Attested source execution time used for age and future-skew bounds |

## 3. Lane rules

For native ETH, kind is 0, `sourceAsset` is twenty zero bytes, both decimals are 18 and version 1
uses quantum 1 to preserve exact wei parity. The lane cap must not exceed `2^64 - 1` destination
atoms. For ERC-20, kind is 1 and `sourceAsset` must be nonzero.

Every covenant instance commits one lane ID, token ID, reserve address, asset kind, decimals,
quantums, cap, Ethereum vault, configuration epoch, committee epoch and committee root. A record for
another lane therefore fails before any output is accepted.

## 4. Replay boundary

Native transaction signatures stop byte-for-byte transaction replay because the consumed unique
control coin changes. They do not prove that five colluding signers will refuse to sign a second
transaction for the same Ethereum deposit. Version 1 safety therefore requires every honest operator
to maintain an independently reconstructed deposit-nullifier journal and refuse a previously
released or cancelled `laneId || depositId`.

This is inside the already declared fewer-than-five-collude threshold assumption. It is a narrower
on-chain guarantee than the earlier abstract sparse-nullifier model and must remain visible. A future
stock-KISS accumulator can replace this operational rule only after an exact transaction fits and
mines. No document may claim that the current `MULTISIG` covenant independently proves historical
non-membership.

## 5. Evidence

`validate-generic-attestation-records.mjs` requires independent encoders to produce identical bytes
and digests for one ERC-20 and one native-ETH fixture. It mutates all 31 fields in both records. This
is canonical-byte evidence only. KISS execution, a full signed TxPoW, `txncheck`, token creation and
mainnet mining are separate gates.
