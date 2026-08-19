# USDTm P7 threshold attestation v1

Date: 2026-08-19

Status: semantic research specification, valueless only

Authority: `USDTM-ZK-PROTOTYPE.md`, especially `D-USDTM-016` and `D-USDTM-017`.

Generic-lane update: `D-USDTM-018`, `bridge-asset-lanes-v1.md` and
`generic-attestation-schema-v1.md` supersede the 335-byte ERC-20-only record below for the exact P7
transaction benchmark. The generic record is 444 bytes, covers both ERC-20 and native ETH lanes and
is checked by two independent encoders. The old record remains historical semantic-model input only.

## 1. Purpose and evidence boundary

This specification defines the first stock-Minima benchmark for Ethereum-to-Minima issuance. Five
unique members of an active seven-member epoch attest one canonical finalized Ethereum deposit
record. A Minima covenant checks those attestations and independently enforces its reserve state,
nullifier, capacity and exact outputs.

This is not an Ethereum consensus proof. A valid quorum can lie. The safety statement is therefore
conditional on fewer than five active operators colluding. Relayer decentralization, exact outputs,
nullifiers, bonds and slashing do not remove that condition.

`validate-usdtm-p7-threshold.mjs` remains the local semantic model and its signatures are mock
signatures. `validate-generic-lane-txpow.mjs` is a separate, stronger offline rung: it executes the
generic KISS branch, real throwaway TreeKey/WOTS signatures and complete serialized TxPoW candidates
against the pinned Core jar. Its coin proofs and tokens are synthetic, so it is not `txncheck`,
mainnet mineability or evidence that seven independently controlled operators exist.

## 2. Directional architecture

| Direction | Authentication target | Trust boundary |
|---|---|---|
| Ethereum to Minima | 5-of-7 attestation over the exact record below | Fewer than five active operators collude |
| Minima to Ethereum | Stateful Minima consensus proof verified by Ethereum | Declared Minima settlement-finality assumption |

The directions are intentionally asymmetric. A future proof verifier that fits stock KISS may
replace inbound attestations only after its own full gate passes.

## 3. Canonical attestation record

Version 1 uses ordered fixed-width fields. No JSON, text address or implicit default is signed.

| Order | Field | Width | Rule |
|---|---|---:|---|
| 1 | `schemaVersion` | 2 | Unsigned big-endian, exactly 1 |
| 2 | `direction` | 1 | Exactly 1 for Ethereum to Minima |
| 3 | `ethereumChainId` | 8 | Unsigned big-endian |
| 4 | `minimaNetwork` | 32 | Domain hash for Minima mainnet |
| 5 | `ethereumVault` | 20 | Exact immutable vault deployment |
| 6 | `ethereumToken` | 20 | Exact accepted six-decimal token runtime |
| 7 | `reserveCovenant` | 32 | Exact Minima reserve covenant identity |
| 8 | `depositId` | 32 | Exact persistent Ethereum deposit ID |
| 9 | `amountAtoms` | 8 | Positive unsigned six-decimal atoms |
| 10 | `minimaRecipient` | 32 | Canonical raw recipient commitment |
| 11 | `finalizedBlockNumber` | 8 | Source finalized execution block number |
| 12 | `finalizedBlockHash` | 32 | Exact source execution block hash |
| 13 | `sourceRecordHash` | 32 | Hash of the canonical P2 Ethereum deposit record |
| 14 | `vaultStateVersion` | 8 | Monotonic authenticated vault snapshot version |
| 15 | `vaultBalanceAtoms` | 8 | Attributable finalized vault balance at that version |
| 16 | `vaultPayoutCursor` | 8 | Finalized sequential payout cursor at that version |
| 17 | `vaultCumulativePaidAtoms` | 8 | Finalized cumulative paid amount at that version |
| 18 | `committeeEpoch` | 4 | Active committee epoch |
| 19 | `committeeRoot` | 32 | Root of ordered signer indexes and public keys |
| 20 | `expiryUnixSeconds` | 8 | Last accepted destination time |

The signature digest is:

```text
SHA3-256("USDTM_ATTESTATION_V1" || canonical_record_bytes)
```

The exact hash function and byte conversion must be reproduced in KISS before the transaction gate.
The local model uses SHA-256 only as a deterministic model primitive and does not claim byte parity.

## 4. Signer and epoch rules

1. The active epoch contains exactly seven ordered signer indexes and committed public keys.
2. A release supplies at least five valid signatures over the same digest.
3. Signer indexes are unique, active and bound to the record's exact committee root and epoch.
4. Extra signatures may not change the result. Duplicates never increase quorum weight.
5. Rotation is a separate delayed state transition. A release cannot rotate its own committee.
6. Exiting operators remain slashable through the longest attestation expiry and challenge period.
7. One organization controlling multiple keys counts as one independent operator for production
   governance, even though the covenant can only count keys.

The executed generic benchmark uses witness `MULTISIG`, not detached-record `CHECKSIG`. Each operator
signs the complete Minima transaction ID, coupling approval to the exact current control coin,
successor state and outputs. This keeps the five 4,125-byte signatures in the witness instead of
persisting them in the successor control coin. Operators compare the canonical record digest before
signing, while the covenant independently parses the record and enforces every lane, conversion,
accounting and output field it consumes.

The cost is operational coordination: signatures collected for one control coin become unusable if
another valid transition spends that coin first. Any coordinator may rebuild and recollect; no
coordinator is authoritative.

## 5. Covenant transition

For amount `A`, reserve `R`, issued liability `I`, pending outbound liability `P`, authenticated
collateral limit `L`, fixed supply `F` and rolling exposure cap `C`, acceptance requires:

```text
0 < A < R
R + I = F
I + A + P <= L
I + A <= C
deposit nullifier is EMPTY
record epoch and root equal the active committee
record domain, vault, token and covenant equal the fixed deployment values
record has not expired
five unique active keys sign the complete transaction containing the exact canonical record
```

Here `L` is `vaultBalanceAtoms` from the signed snapshot. A snapshot version below the accepted
version rejects. An equal version must reproduce the accepted balance, payout cursor, cumulative
paid amount and finalized block exactly. An advancing version must be exactly the next version and
must not decrease block number,
payout cursor or cumulative paid amount, and atomically replaces the stored snapshot. This permits
multiple deposits from one finalized block without allowing a later payout to be hidden behind a
stale larger balance.

The transaction atomically consumes control and reserve coins and creates only:

1. the exact successor control coin with the new nullifier root and `I + A`;
2. fixed sibling output 1 containing reserve amount `R - A`;
3. the exact recipient output containing `A` USDTm atoms.

There is no signer-only output, coordinator fee branch, arbitrary change output or emergency drain.
Every rejected transition must leave the complete state byte-identical.

## 6. Economic boundary

Before production promotion:

- the minimum total slashable bond among any five active operators must be at least the selected
  maximum bridge exposure;
- the exposure cap applies on-chain and cannot be raised by the attestors it constrains;
- activation and cap changes need delayed, narrowly scoped governance;
- false-source attestation and equivocation need objective Ethereum-verifiable evidence;
- slashed value needs a defined recovery recipient and distribution rule;
- exit delay must extend beyond every record expiry and challenge window.

This relation limits recoverable loss. It does not stop five signers from creating an immediately
valid false release. Stable bond value, legal collection, operator independence and usable fraud
evidence are separate assumptions.

An Ethereum adjudicator also needs to verify the exact Minima signature form or a sound proof of it.
That mechanism is not established by this document and belongs to P6.

## 7. Liveness and coordination

No central coordinator is authoritative. Any process may publish the canonical record, collect
signatures and relay the completed transaction. Operators independently derive the record from their
own Ethereum execution and consensus views. They must reject a record when their source views do not
agree on finality, vault identity, token identity, amount, recipient or block reference.

Five online honest operators are necessary for progress. With only four, issuance halts safely.
Threshold availability is therefore a measurable service objective, not a consensus safety proof.

## 8. WOTS and transaction gate

The first source estimate considered detached-record `CHECKSIG`. The executed benchmark instead uses
native witness `MULTISIG`, so its instruction count is measured directly rather than projected.

P7 does not pass until an offline harness and then an authorized valueless mainnet ceremony show:

1. exact TreeKey/WOTS public-key, signature and Merkle-proof sizes for five signatures;
2. exact script proof, coin proofs, state variables and complete signed TxPoW size below 65,536 bytes;
3. exact total KISS instructions below 1,024;
4. successful `txncheck` and mining on an ordinary stock Minima mainnet node;
5. durable pre-sign WOTS leaf reservation, retry safety and restored-node non-reuse;
6. hostile signature, epoch, record, output, replay and capacity cases rejected without spending.

No wallet, seed, token, signature or transaction is created by the semantic model.

### Executed offline transaction rung

`validate-generic-lane-txpow.mjs` compiles a deterministic throwaway Java harness against the
official jar at pinned Core commit `52542f25605a28a776e9b3b43b0808a05dceab01`. Both the six-decimal
ERC-20 and exact-wei native-ETH candidate use five independent default TreeKey signatures, a
444-byte generic record, two inputs, three exact outputs, complete successor state, one script proof
and two deterministic 32-level coin proofs.

The settled pre-mainnet ERC-20 candidate serialized to 31,886 bytes and the native candidate to
32,048 bytes. The advancing-head control branch executed in 539 instructions, the bounded equal-head branch in 553,
and the reserve branch in 148. Both KISS branches, signature verification and Core amount
conservation pass. The release path preserves payout cursor and cumulative paid, while a second
deposit may reuse the exact accepted Ethereum snapshot for at most 100 Minima blocks. Sixty-three
hostile checks per lane cover quorum, every signed record field, stale signatures, exact output
shape, payout-counter drift, equal-head snapshot drift, successor accounting, cross-lane records
and the reserve floor, including freshly signed mutations of each preserved state port 19 through 24.
The signed source execution time is checked in milliseconds against the preserved maximum-head-age
and future-skew values at ports 23 and 24 using guarded addition bounds.

That artifact is a complete offline synthetic TxPoW measurement, not mainnet evidence. The later
mainnet ceremony created both real valueless token lanes and exact genesis coins, then refuted the
advancing-head time rule: transaction
`0xA26C2F308749DBB513ADE421460C042C45B166C0EF845831B94B50E4E313F5BC`
passed `txncheck` with five signatures at height 2269351, but after the height advanced its script
failed and the network dropped it without spending either input. Five WOTS uses were consumed.

Candidate v2 therefore replaces `STATE(17) == @BLOCK` with three explicit bounds:
`STATE(17) >= PREVSTATE(17)`, `STATE(17) <= @BLOCK`, and
`@BLOCK - STATE(17) <= PREVSTATE(18)`. This preserves monotonic accepted-head age while allowing
normal mempool-to-block delay. Future and over-lag freshly signed mutations must reject. The deployed
v1 valueless coins remain evidence of the failure and cannot be silently counted as a passing P7
lane. A replacement ceremony requires a fresh explicit authorization after v2 hostile review.

### Replay limitation discovered by the exact design

Transaction-bound signatures prevent replay of the same signed transaction after its unique control
input is spent. Stock KISS does not, in this candidate, prove historical non-membership of an
arbitrary `laneId || depositId`. Honest operators must independently reconstruct the released and
cancelled deposit journal and never sign a second transaction for the same key. Five colluding keys
can sign a duplicate, just as they can sign a deposit that never existed.

This fits the declared fewer-than-five-collude trust assumption but is weaker than the earlier
abstract claim that the covenant itself owns a sparse nullifier accumulator. Production adoption of
this boundary remains an explicit founder decision. P7 has passed its valueless live mineability
gate, but no document may call historical replay prevention independently covenant-enforced.

## 9. Required hostile cases

The executable model must reject insufficient quorum, duplicate signer, outsider signer, wrong
signature, stale or future epoch, wrong committee root, wrong chain, network, vault, token, covenant,
and every deposit ID, amount, recipient, block, source-record or snapshot mutation under already
collected signatures. It must separately reject signed stale, skipped or internally inconsistent
vault snapshots, expiry, replay, reserve exhaustion, collateral excess, exposure-cap excess and any
output mutation. Each rejection must preserve the complete state.

The model must also preserve one deliberate counterexample: five active colluding signers can sign a
fabricated but well-formed record and make the threshold-only covenant accept it. If that
counterexample stops working because the model silently consults an Ethereum truth table, the model
is falsely claiming proof verification and must fail its own evidence gate.

## 10. Current evidence level

P7 live valueless mainnet gate passed for both the six-decimal USDTm-v2 lane and the eighteen-decimal
ETHm-v2 lane. Each exact five-signature RELEASE passed node `txncheck` and mined with real coin
proofs, exact state, zero burn and bounded size and instruction use. This does not prove independent
operators or authentic Ethereum facts. P8 separately owns the all-action covenant, whose unified
offline candidate now executes CLIENT_UPDATE, RELEASE, RETURN, CANCEL and PAYOUT_ACK for both lanes.
