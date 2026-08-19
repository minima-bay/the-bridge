# Generic Minima bridge prototype control document

Document ID: `USDTM-ZK-PROTOTYPE`

Created: 2026-08-19

Status: active research, valueless only

Authority: founder decisions in this document govern this prototype. Bay laws, Minima consensus,
executed evidence and later founder decisions override older text. Supporting specifications remain
authoritative for their exact encodings only where this document points to them.

## 1. Control panel

This is the one document to read first and update last for the generic Minima bridge prototype. The
legacy filename and document ID remain stable so existing evidence references do not break.

| Control | Current value |
|---|---|
| NOW | `P8` complete a fresh all-branch generic-lane generation; the mined v2 instances are immutable RELEASE-only evidence and cannot be upgraded |
| Latest gate passed | `P7`: one exact five-signature release per fresh token-bound v2 lane passed stock-node `txncheck`, survived posting lag and mined on Minima mainnet within current size and KISS limits |
| Next executable gate | The unified five-action offline candidate has passed. Obtain explicit authorization for a fresh valueless mainnet generation, then run node `txncheck` and mine every exact branch without cross-lane state changes. |
| Production status | Prohibited |
| Funds status | Purpose-created valueless USDTm and ETHm are locked in mainnet test covenants; no real USDT, ETH or production asset is present |
| Minima transaction status | Four fresh v2 valueless tokens, two exact v2 genesis transactions and one exact five-signature release per USDTm-v2 and ETHm-v2 lane are mined. The USDTm retry and ETHm release persist the exact 444-byte records in port 90, preserve exact reserve conservation and burn zero. One earlier signed v2 USDTm intent was rejected before posting and is permanently journaled. |
| Ethereum transaction status | No deployment or transaction authorized |
| External communication status | No Minima Core contact will be pursued; the prepared draft is retained as research history only |
| Primary blocker | The immutable v2 scripts have no action dispatcher, migration path or non-release branch. A fresh P8 generation is authorized by `D-USDTM-023` and has passed its clean no-funds preflight, but it still requires funding, token creation, exact genesis, node `txncheck` and mining of every branch. The seven keys remain one-controller fixtures, Ethereum facts remain synthetic, and rollback-safe WOTS recovery and decentralized committee operation remain later blockers. |
| Pool snapshot isolation | Required: Pool writes remain inside this research directory; the retired issuers are isolated under `Nodes`; `Pool/2_development` remains untouched by this bridge slice |
| Last control-document verification | Run `node validate-usdtm-control.mjs --evidence`; the newest matching evidence file is authoritative |

### Status vocabulary

| Status | Meaning |
|---|---|
| `NOW` | The single active phase. There must be exactly one. |
| `NEXT` | Ready after the NOW gate passes. |
| `LATER` | Ordered work whose dependencies are not yet satisfied. |
| `BLOCKED` | Cannot pass until the named external or technical dependency changes. |
| `GATE PASSED` | Its stated exit evidence exists and has been checked at the stated evidence rung. |
| `REFUTED` | The tested route failed. It is not silently retried. |
| `NOT AUTHORIZED` | Technically possible work outside the founder's current authorization. |

No phase becomes `GATE PASSED` from design text or code inspection alone. Runtime, transaction and
chain claims must state the observed evidence rung.

## 2. Product definition

The bridge is an asset-lane protocol, not a USDT-specific product. Each asset has an isolated
Ethereum custody configuration, Minima token, reserve/control lineage, nullifier namespace,
accounting state and cap. USDTm remains one candidate six-decimal ERC-20 lane with no dependency on
mxUSDT. A native ETH lane with provisional Minima representation name `ETHm` is now the first
generic-lane feasibility target.

No branch may consume or recreate another lane's control coin, reserve token, nullifier or
accounting state. Shared source code does not create shared inventory.

Target value flow under the selected hybrid research architecture:

```text
Ethereum ERC-20 or native ETH deposit in one immutable lane
    -> canonical finalized-deposit record
    -> 5-of-7 threshold attestation checked by a stock-KISS Minima covenant
    -> exact release of that lane's Minima representation from its isolated reserve covenant

Lane-token return
    -> confirmed Minima reserve-return proof
    -> proof verification by the Ethereum vault
    -> exact release of the corresponding Ethereum asset
```

Relayers and provers are permissionless couriers. They hold no bridge custody keys. In the
Ethereum-to-Minima direction, attestors do have a bounded validation vote: five unique members of
the active seven-member epoch can attest one exact canonical record, while the covenant itself
enforces the nullifier, capacity and exact output transition. In the Minima-to-Ethereum direction,
the target remains a stateful Minima consensus proof verified by Ethereum. The two directions must
not be described as having the same trust model.

### Required accounting model

For every isolated asset lane `x`:

```text
F[x] = fixed destination-token supply created once on Minima
R[x] = lane token in that lane's canonical reserve accounting set
I[x] = issued-not-returned lane liability, defined as F[x] - R[x]
P[x] = returned lane atoms accepted on Minima but not yet acknowledged as paid on Ethereum
L[x] = finalized attributable Ethereum source-asset atoms for that lane
S[x] = non-attributable or intentional surplus, never counted as backing

R[x] + I[x] = F[x]
I[x] + P[x] <= L[x]
```

Safe order of operations:

- Ethereum to Minima: authenticate quorum-attested `L` first, then increase `I`.
- Minima to Ethereum: decrease `I` and increase `P` first, then pay on Ethereum and decrease `P`.
- No off-chain monitor may be the validity gate for either inequality.
- Integer atoms are used throughout. The USDTm lane uses six decimals. The proposed ETH lane uses
  exact wei and 18 destination decimals under a single-limb cap below `2^64`; 18-decimal runtime and
  wallet compatibility remain unproved.

### Authoritative state and trust boundary

| State or actor | Authority | Must be trusted for safety? |
|---|---|---|
| Ethereum finalized vault snapshot on Minima | Five unique members of the active seven-member epoch attest an equal or exact-next snapshot | Yes: fewer than five operators collude, plus honest source finality observation, committee governance, caps, bonds and eventual slashing adjudication |
| Minima accepted client state on Ethereum | The Ethereum verifier extends one stored prior state | Yes: Minima honest-work and fork-choice security, authenticated bootstrap, confirmation and late-heavier-fork policy, exposure cap, proof programme and Ethereum verifier |
| Ethereum vault collateral and records | The pinned per-lane vault code and authenticated finalized storage | Yes: vault code and accepted governance, plus token issuer behavior for ERC-20 lanes; native ETH has no issuer but adds forced-balance and external-call risks |
| Minima reserve and liabilities | The unique state-control coin plus the reserve input admitted by its exact transition | Yes: KISS covenant, constructive reserve-lineage rule and exact attestation verification behavior |
| Minima-to-Ethereum proof system and verification key | Activated Ethereum verifier configuration | Yes: soundness, implementation and governance are explicit assumptions |
| Inbound attestors | Independently observe Ethereum and sign one exact canonical record | Yes for source truth: a valid quorum can lie; no attestor has an unrestricted reserve branch |
| Relayer or prover | Supplies public data, witness and proof | No safety trust; availability affects liveness only |
| RPC provider, GraphQL service or explorer | Discovery and convenience | No settlement trust |
| MiniDapp or other UI | Transaction construction and reporting | No settlement trust under D023 |
| Off-chain monitor | Alerts and accounting comparison | No validity power |

### Canonical accounting transitions

Let `A` be the exact atomic amount under the consumed lane configuration.

| Action | Required prior fact | Reserve and liability transition | Required postcondition |
|---|---|---|---|
| Client update only | Five-of-seven record authenticates an exact-next Ethereum vault snapshot | `R`, `I`, `P`, payout cursor and cumulative payout count remain unchanged; `L` becomes the attested attributable balance | `I + P <= newL`; otherwise reject and halt, and do not describe stored prior `L` as current solvency evidence |
| Inbound release | Persistent unconsumed vault deposit record for `A` under the accepted finalized state | `newR = R - A`; `newI = I + A`; `newP = P` | `newR + newI = F` and `newI + newP <= newL` |
| Outbound return | User returns exactly `A` to the canonical reserve transition | `newR = R + A`; `newI = I - A`; `newP = P + A`; `L` unchanged | `newR + newI = F`; exact redemption record published once |
| Payout acknowledgement | Finalized Ethereum state proves the exact contiguous cumulative payout range, cursor advance, atom scale and authenticated balance | `R` and `I` unchanged; require `paidA <= P`; `newP = P - paidA`; `newL` is proof-bound current collateral | `newP >= 0`, exact cumulative delta equals `paidA`, and `I + newP <= newL` |

Additional accounting rules:

- a holder burn outside the covenant does not reduce `I`; it creates excess collateral until an
  independently authenticated burn-credit mechanism is designed;
- a coin donated to the covenant address is not part of `R` unless it enters through the canonical
  reserve transition;
- fees and surplus never relax `I + P <= L`;
- deposits and payouts in one Ethereum block are reconciled through authenticated persistent
  records and cumulative counters, not inferred from the net balance change alone;
- a client update that reveals lower collateral cannot create an insolvent canonical state;
- stopping new issuance may be permitted, but no halt path may redirect reserve or vault funds.
- version 1 retains one positive reserve atom, so Ethereum source capacity is at most `F - 1`
  destination atoms and an inbound release requires `0 < A < R`;
- every Minima control transition co-spends and recreates the positive reserve as fixed sibling
  output 1, including client updates, cancellations and payout acknowledgements.

### Proof-safe deposit cancellation requirement

An accepted Ethereum deposit must not receive a local timeout refund while its Minima release can
still occur. The prototype must implement this cross-chain cancellation state machine:

1. The Ethereum deposit commitment includes a canonical Minima cancellation authority and begins
   in `PENDING` state.
2. Minima consumes the deposit nullifier as either `RELEASED` or `CANCELLED`, never both.
3. A `CANCELLED` transition is independently provable through the Minima light client on Ethereum.
4. Ethereum refunds only after verifying the finalized Minima cancellation proof and atomically
   marks the vault record `REFUNDED`.
5. A later release proof authenticates the current Ethereum record and fails after refund.
6. Release, cancellation and refund races are tested in every ordering.

This does not make permanent Minima failure recoverable. If Minima cannot finalize the cancellation
transition, a trustless Ethereum refund cannot prove that future Minima release is impossible. The
production disclosure and cap must treat that as a residual liveness and fund-trapping risk.

## 3. Binding decision log

Every product or protocol choice is recorded here. A later decision supersedes an earlier one by
identifier and date. An open decision is not guessed.

| ID | Date | Status | Decision | Consequence |
|---|---|---|---|---|
| `D-USDTM-001` | 2026-08-18 | DECIDED | Create a new token named USDTm for Minima. | The prototype does not inherit mxUSDT token state, liabilities, custody or operator history. |
| `D-USDTM-002` | 2026-08-18 | DECIDED | Existing mxUSDT is outside scope. | No migration, recapitalization, holder snapshot or compatibility layer is part of this programme. |
| `D-USDTM-003` | 2026-08-18 | DECIDED | USDTm is independently backed. | It must be described as bridge-issued, not Tether-issued, official USDT0 or Tether-redeemable. |
| `D-USDTM-004` | 2026-08-18 | SUPERSEDED IN PART BY `D-USDTM-017` | Production waits for native proof verification. | The proof-only rule still governs Minima-to-Ethereum. Ethereum-to-Minima now follows the explicitly conditional threshold-attestation decision in `D-USDTM-017`. |
| `D-USDTM-005` | 2026-08-18 | DECIDED | Build a valueless ZK prototype first. | No real USDT, production token, production vault or funds-facing invitation is authorized. |
| `D-USDTM-006` | 2026-08-18 | PROVISIONAL RESEARCH CHOICE | Use six decimals in the valueless schema and fixtures. | One Ethereum USDT atom maps to one test-token atom. Production decimals require `O-USDTM-011`. |
| `D-USDTM-007` | 2026-08-18 | DECIDED | Relayers and provers are permissionless and hold no custody keys. | Delivery may be censored or delayed, but cannot change a valid recipient or amount. |
| `D-USDTM-008` | 2026-08-18 | DECIDED | Classify the work as research infrastructure until both proof directions pass. | A one-way proof or schema-only validator is not a bridge release. |
| `D-USDTM-009` | 2026-08-18 | SUPERSEDED BY `D-USDTM-016` | Prepare the Minima Core native-verifier proposal but do not send it yet. | The draft remains research history and will not be sent under the stock-Core-only decision. |
| `D-USDTM-010` | 2026-08-18 | DECIDED | Benchmark pairing-based and hash-based proof tracks, beginning with Groth16 feasibility. | Groth16-first is a benchmark order, not the final proof-system choice. |
| `D-USDTM-011` | 2026-08-18 | DECIDED | The first consensus engineering slice is an independent Minima verifier fixture package. | RPC fixtures are the first rung and must not be called a consensus implementation. |
| `D-USDTM-012` | 2026-08-18 | DECIDED | Preserve the no-funds boundary and isolate this work from Pool snapshot development. | This directory and the sibling research-plan document are the only current write boundary. |
| `D-USDTM-013` | 2026-08-19 | DECIDED | This document is the living plan, decision log, findings log and status board. | Every executed slice updates this document before handoff. |
| `D-USDTM-014` | 2026-08-19 | DECIDED | Bay mainnet rules apply to any later Minima transaction testing. | Purpose-created valueless assets on Minima mainnet are required; private-network and testnet promotion gates are excluded. |
| `D-USDTM-015` | 2026-08-19 | DECIDED | Use one fresh dedicated Minima node wallet named `USDTmIssuer` for the later valueless token ceremony. | One active seed copy only; fund only for creation and fees, send the full fixed token supply to the genesis reserve, return remaining Minima to the pinned funding address, then mark the empty issuer `NEVER-REUSE`. This decision does not authorize creating the node, token or transaction. |
| `D-USDTM-016` | 2026-08-19 | DECIDED | Build without depending on Minima-team priorities, a Minima Core change or a private Core fork. The public-chain target must run on stock Minima mainnet. | External Core contact is closed. A locally modified Core is not evidence for Minima-mainnet deployability. The proof-only path proceeds only if an exact verifier using already-supported KISS and witness primitives mines within current limits. Otherwise it stops, and any signer-attested alternative requires a new founder trust-model decision that explicitly supersedes `D-USDTM-004`. |
| `D-USDTM-017` | 2026-08-19 | DECIDED | Adopt a hybrid bridge research architecture. Ethereum-to-Minima uses a decentralized bonded threshold-attestation design, benchmarked first as 5-of-7 with valueless assets; Minima-to-Ethereum remains proof-verified by Ethereum. Continue a separate stock-KISS proof-verifier search, but do not make it block the hybrid prototype. | This supersedes `D-USDTM-004` only for Ethereum-to-Minima. A quorum can authorize a false source claim, so safety is conditional on fewer than five colluding operators plus enforceable caps, bonds and slashing. Five-of-seven is a benchmark configuration, not a production-final quorum. Seven keys controlled by one party do not demonstrate decentralization. |
| `D-USDTM-018` | 2026-08-19 | DECIDED | Generalize the bridge into isolated asset lanes and evaluate native ETH as the first non-USDT lane. | USDTm is one ERC-20 lane, not the bridge identity. Every asset has a distinct lane ID, vault configuration, Minima token, control/reserve lineage, nullifier namespace, accounting state and cap. `ETHm` is a provisional research name only. Shared code or attestors never permit cross-lane inventory or replay. |
| `D-USDTM-019` | 2026-08-19 | PROVISIONAL OFFLINE BENCHMARK CHOICE | Use transaction-bound native `MULTISIG` for the first exact stock-Core P7 candidate instead of persisting five detached-record `CHECKSIG` signatures in control state. | Five operators sign the complete transaction ID, including current control input, 444-byte record, successor state and exact outputs. This is measured offline and may not be promoted to the mainnet ceremony until hostile review closes and `O-USDTM-016` is decided. |
| `D-USDTM-020` | 2026-08-19 | DECIDED | Accept historical `laneId || depositId` non-reuse inside the existing fewer-than-five-collude threshold boundary. | Every operator must independently reconstruct and persist the complete lane journal and refuse duplicates. The covenant still prevents replay of the same signed control transition, but five colluding operators can authorize a historical duplicate just as they can authorize a nonexistent deposit. No on-chain non-membership claim is made. This closes `O-USDTM-016` for the prototype. |
| `D-USDTM-021` | 2026-08-19 | AUTHORIZED VALUELESS MAINNET CEREMONY | Use the one fresh `USDTmIssuer` node wallet for both purpose-created valueless `USDTm` and `ETHm` mainnet test tokens. | The command-native ceremony parameters are frozen for this valueless run only: USDTm has 6 decimals, fixed supply 1,000,001 and cap 999,999.999999; ETHm has 18 decimals, fixed supply 11 and cap 10. The one-token margins replace the earlier synthetic one-atom margins because stock Core 1.1.2.6 `tokencreate` floors the requested token count before applying decimals. Both tokens use the default unrestricted `RETURN TRUE` token-level script, while their reserve coins are covenant-controlled. The node, token creation, exact P7/P8 transaction construction, signing, posting and mining are authorized subject to pre-signing checks, mined-output verification, no real collateral, an empty issuer at completion and `NEVER-REUSE`. This is not production authorization. |
| `D-USDTM-022` | 2026-08-19 | AUTHORIZED REPLACEMENT VALUELESS MAINNET CEREMONY | Accept `O-USDTM-017` and execute the corrected v2 live feasibility ceremony with a fresh one-use `USDTmIssuerV2` wallet and fresh `USDTm-v2`, `ETHm-v2` and per-lane control token IDs. | Regenerate every lane ID, script and covenant address from the mined v2 token IDs. Execute exact genesis and one real five-signature release per lane, verify mined outputs, return every residual Minima atom to the exact address of the funding input, empty and retire the issuer, and never reuse `USDTmIssuer`. The authorization is valueless mainnet testing only: no real collateral, production authority or production security claim. |
| `D-USDTM-023` | 2026-08-19 | AUTHORIZED P8 ALL-BRANCH VALUELESS MAINNET CEREMONY | Execute one fresh P8 generation with the dedicated one-use `USDTmIssuerP8` wallet, fresh `USDTm-P8`, `ETHm-P8` and per-lane control token IDs, and the unified five-action covenant. | The authorization covers token and control creation, token-bound lane rendering, exact genesis, CLIENT_UPDATE, RELEASE, CANCEL, RETURN and PAYOUT_ACK on both valueless lanes, stock-node `txncheck`, posting, mining, full residual-Minima return to the exact funding-input address, and issuer retirement as `NEVER-REUSE`. It authorizes no real collateral, production authority or production security claim. Concurrent Pool Test V8 work remains out of scope. |

## 4. Open founder decisions

These choices are deliberately unresolved. Work may gather evidence for them but may not select an
answer silently.

| ID | Decision needed | Options or boundary | Earliest gate affected |
|---|---|---|---|
| `O-USDTM-002` | Select the production proof system | Choose only after executed Core benchmarks. Groth16 is the first benchmark, not a decision. | `P7` |
| `O-USDTM-003` | Select verification-key governance | Immutable activated key, or narrowly versioned and delayed consensus registry. | `P7` |
| `O-USDTM-004` | Select Ethereum weak-subjectivity bootstrap governance | Authority, checkpoint maximum age, fork schedule and offline refresh rules. | `P6` |
| `O-USDTM-005` | Define the production backing statement | Back all fixed supply upfront, or back only covenant-released issued-not-returned liability. | `P13` |
| `O-USDTM-006` | Select Ethereum vault governance | Immutable version 1 is the current research specification. Any upgrade role needs a separate decision. | `P4` |
| `O-USDTM-007` | Define response to USDT freeze, blacklist, deprecation or changed balance semantics | Halt new issuance, redemption handling and disclosure wording must be chosen. | `P4` |
| `O-USDTM-008` | Select Minima confirmation and value-cap policy | Cumulative-work threshold, delay and maximum bridge exposure. | `P5` and `P13` |
| `O-USDTM-009` | Select production fixed supply and initial bridge cap | No production mint may occur before this decision. | `P13` |
| `O-USDTM-010` | Approve production legal disclosure | The name USDTm is decided; the exact wording must state independent backing and no Tether or USDT0 endorsement. | `P13` |
| `O-USDTM-011` | Select production decimals per asset lane | Six decimals are recommended for USDT atom parity. The ETH lane targets 18 for exact wei parity, subject to the explicit compatibility gate. Every other lane requires conversion and dust rules. | Before each `P8` lane token creation |
| `O-USDTM-012` | Select the production committee and quorum | Choose operator admission, independent-control evidence, jurisdiction and infrastructure diversity, epoch length, rotation delay, exit delay and final threshold only after the full signed-transaction and liveness benchmarks. | `P6` and `P13` |
| `O-USDTM-013` | Select attestor economics and adjudication | Choose per-operator bond, bridge exposure cap, slashable faults, fraud-proof mechanism, challenge period and recovery distribution. Slashing is deterrence and recovery, not prevention. | `P6` and `P13` |
| `O-USDTM-015` | Select production multi-asset exposure accounting | A shared committee must cover aggregate exposure across every lane. Choose isolated bond pools or a conservative common valuation and cap policy; per-lane caps may not double-count one bond. | `P6` and `P13` |

## 5. Findings log

Each finding states its evidence level. `Observed` means an executed runtime or preserved artifact;
`source-inspected` is never promoted to runtime evidence; `design` is a requirement or inference.

| ID | Date | Status | Evidence level | Finding | Consequence or way forward |
|---|---|---|---|---|---|
| `F-USDTM-001` | 2026-08-18 | SURVIVES | Node-observed | Minima 1.1.2.6 rejected `BLSVERIFY`, `PAIRING` and `ECRECOVER` at KISS parse time. | Ethereum proof verification needs a native verifier or another consensus change. |
| `F-USDTM-002` | 2026-08-18 | SURVIVES | Node-observed | The same runtime accepted `CHECKSIG` and MMR `PROOF`; neither authenticates Ethereum consensus. | Existing KISS signature and MMR functions cannot substitute for an Ethereum light client. |
| `F-USDTM-003` | 2026-08-18 | SURVIVES | Node-observed | The current node enforced a 1,024-instruction KISS ceiling and 65,536-byte TxPoW ceiling. | Worst-case verifier transactions must be measured and mined, not inferred from parser success. |
| `F-USDTM-004` | 2026-08-18 | REFUTED ROUTE | Executed local proof experiment and node-observed limits | A direct Winterfell SHA3 verifier does not fit ordinary current KISS because of numeric-range and instruction limits. | Do not continue the pure-KISS Winterfell route without a materially different verifier construction and new executed evidence. |
| `F-USDTM-005` | 2026-08-18 | SURVIVES | Executed local proof experiment | The stronger Winterfell proof was 56,934 bytes and used 1,466 observed SHA3 entry calls off-chain; KISS exhausted after 203 favorable chained merges. | Proof size is secondary to the arithmetic and instruction blocker; mineability remains unproved. |
| `F-USDTM-006` | 2026-08-18 | SURVIVES | Node-observed fixture rung | A 32-block mainnet RPC fixture passed stored-hash, height, displayed-target, parent-continuity, unique-ID and anchor checks and rejected seven in-memory corruptions. | This is an RPC-consistency fixture, not an independent Minima consensus verifier. |
| `F-USDTM-007` | 2026-08-18 | SURVIVES | Design plus primary-source review | A Minima proof submitted to Ethereum must prove consensus, cumulative work, fork choice, Cascade behavior, MMR inclusion and the exact reserve return from a persistent prior state. | `P5` must implement a stateful Minima light client, not a proof against a relayer-selected root. |
| `F-USDTM-008` | 2026-08-18 | PROOF-ONLY ROUTE SUPERSEDED BY `D-USDTM-017` | Design plus primary-source review | A native Ethereum proof submitted to Minima would need to authenticate weak-subjectivity bootstrap, sync committees, BLS, fork versions, finality, SSZ execution inclusion and vault state. | The hybrid prototype does not claim this proof. It uses conditional threshold attestations inbound while preserving native-proof research as a non-blocking replacement candidate. |
| `F-USDTM-009` | 2026-08-18 | SURVIVES, ACCEPTED CONDITIONAL TRUST | Design and hostile review | A signature authenticates bytes but does not prove source-chain inclusion, canonicality, solvency or finality. | Under `D-USDTM-017`, Ethereum-to-Minima safety is conditional on fewer than a quorum colluding. The covenant still enforces exact outputs, nullifiers and caps, but cannot distinguish a quorum-signed lie from truth. |
| `F-USDTM-010` | 2026-08-18 | SURVIVES | Design and hostile review | Maxima can transport proofs and acknowledgements but provides no settlement or finality. | Maxima remains an optional transport layer only. |
| `F-USDTM-011` | 2026-08-18 | SURVIVES | Minima protocol and executed Bay evidence | Minima token supply is fixed at creation, and omitted custom-token output can become an irreversible burn while amount checks still pass. | Production uses a pre-minted reserve with exact output conservation on every branch. |
| `F-USDTM-012` | 2026-08-18 | SURVIVES | Design and hostile review | A strict global nonce lane can be permanently blocked by one malformed or unprovable message. | Replay design must permit safe independent consumption, batching or a proved skip mechanism. |
| `F-USDTM-013` | 2026-08-18 | SURVIVES | Design and hostile review | A historical USDT transfer proves a past movement, not current locked collateral or vault solvency. | Proofs must bind current vault record state, code semantics and attributable balance. |
| `F-USDTM-014` | 2026-08-18 | SURVIVES | Design and hostile review | Multiple payouts reflected in one Ethereum balance snapshot can deadlock one-at-a-time acknowledgement. | Payout acknowledgement must use a cumulative cursor, authenticated accumulator or complete batch. |
| `F-USDTM-015` | 2026-08-18 | SURVIVES | Design and hostile review | A latest-state client without authenticated historical records can skip an unconsumed earlier deposit. | Persistent vault records or authenticated historical ancestry are mandatory. |
| `F-USDTM-016` | 2026-08-18 | SURVIVES | Design and hostile review | A monotonic but historically stale Ethereum-head sequence can reset a destination posting-age clock. | Public inputs bind authenticated Ethereum execution time and enforce source-age and future-skew bounds. |
| `F-USDTM-017` | 2026-08-18 | SURVIVES | Executed schema validator | The existing public-input fixture is fixed-width, mutation-tested and schema-only. | It is evidence rung 1 and does not prove a ZK verifier, covenant or mineable transaction. |
| `F-USDTM-018` | 2026-08-19 | DECIDED SCOPE | Founder decision | mxUSDT history, liabilities and reserve attribution are excluded from USDTm. | No further mxUSDT reconciliation is a dependency for this prototype. |
| `F-USDTM-019` | 2026-08-19 | P1 SEMANTIC GATE PASSED | Design plus local two-ledger and UTXO property model | Permanent reserve coin-ID admission is unnecessary if every control transition co-spends an exact-amount reserve and recreates its current sibling at fixed output 1. Equal-amount substitution produces the same next accounting state; the displaced coin is non-accounting surplus and cannot add a same-control transition. | Both hostile reviewers passed the corrected semantic property. P8 remains a blocking KISS and valueless-mainnet gate; P9 and P12 must prove bounded clean reconstruction after proof loss and pollution. |
| `F-USDTM-020` | 2026-08-19 | P1 SEMANTIC GATE PASSED | Design plus local property model | The candidate uses separate state machines: Ethereum `ABSENT -> PENDING -> REFUNDED`, and Minima `EMPTY -> RELEASED` or `EMPTY -> CANCELLED`. Cancellation authenticates the exact current finalized `PENDING` record and a signature over every semantic domain field; refund is proof-gated, atomic and restores capacity once. | Both reviewers passed the corrected property model. P2 now owns canonical bytes; P4 through P9 still own EVM, light-client, signature, KISS and mined-transaction behavior. Permanent Minima failure remains a fund-trapping liveness risk. |
| `F-USDTM-021` | 2026-08-19 | CORRECTED | Hostile process review | P0 was marked passed against stale document evidence and no preserved file-scope check. | P0 was reopened; fresh matching control, scope and manifest evidence are required before it passes. |
| `F-USDTM-022` | 2026-08-19 | CONDITIONAL SAFETY ASSUMPTION, PRODUCTION BLOCKER | First P1 hostile review | A late heavier Minima fork can remove a cancellation after Ethereum refunds and contain a release, so refund plus release can coexist across histories. | P1 states safety only under a Minima settlement-finality assumption. P5 must measure cumulative-work, delay, Cascade and ancestry behavior; `O-USDTM-008` must select the production delay and value cap; production remains blocked on explicit residual-risk acceptance. |
| `F-USDTM-023` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Both P1 hostile reviews | The first reserve rule allowed `A = R`, which required an invalid or unavailable zero-value reserve successor and could strand a full-capacity deposit. | Version 1 now requires `0 < A < R`, retains one reserve atom and caps source commitments at `F - 1` destination atoms. Boundary and mutation tests survived P1 rereview; later mainnet evidence remains required. |
| `F-USDTM-024` | 2026-08-19 | CORRECTED IN DESIGN, P1 REREVIEW PASSED | Second P1 hostile review | Client-only and cancellation transitions advanced the control coin without recreating reserve, so a clean constructor had no constructive current reserve anchor after proof loss and address pollution. | Every control transition now co-spends and recreates reserve at fixed sibling output 1. P9 and P12 remain blocking clean-reconstruction evidence gates. |
| `F-USDTM-025` | 2026-08-19 | REFUTED EVIDENCE CLAIM | Both P1 hostile reviews | The first 48-assertion model used shared in-memory states and scalar cardinality, so its 363 sequences did not evidence two-ledger proof lag, forks, atomic callbacks or constructive UTXO recovery. | Preserve the failed result in the journal, replace it with an independent-ledger and UTXO model, and do not emit current evidence until the stronger source and rereviews stabilize. |
| `F-USDTM-026` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | First P1 hostile rereview | The stronger model initially tested signature fields separately from `cancel()`: stored record message and amount changes were not signed by the transition, and proof fields were not compared exhaustively. | `cancel()` now consumes the actual proof, committed public key and signature, compares every semantic record field, recomputes the digest and rejects every field mutation through the real transition. P2 owns canonical bytes and the Minima-compatible runtime scheme remains later evidence. |
| `F-USDTM-027` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | First P1 hostile rereview | The first redemption helper could free source capacity for an arbitrary fresh ID and could run during a refund callback, allowing pending deposits to exceed releasable reserve. | Capacity restoration now requires a canonical Minima `RETURN` record and settled proof, exact amount and recipient, successful atomic transfer, one-time consumption and the shared refund/redemption lock. Fake proofs, replay and both callback directions reject in the model. |
| `F-USDTM-028` | 2026-08-19 | CONTAINED LATER EVIDENCE | Second P1 hostile rereview | The model's sibling recovery is an in-memory lineage check and transaction cardinality remains abstract rather than exact KISS input/output execution. | Claims are relabelled. P8 must execute both scripts and exact transaction collections; P9/P12 must prove bounded clean-node bundle validation and proof import. These are blocking evidence gates, not P1 runtime claims. |
| `F-USDTM-029` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Final reserve-focused P1 rereview | The abstract `RETURN` counted three inputs but did not consume an exact amount-bearing returned-token UTXO or derive its redemption commitment. | `RETURN` now requires an unspent user coin with exact coin ID, bridge-token ID, amount and covenant ownership, consumes it once, and derives the redemption ID from the publication domain. Missing, wrong-token, wrong-amount, reused, recipient-mutated and ID-mutated inputs reject. |
| `F-USDTM-030` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Final reserve-focused P1 rereview | Rejected `RETURN` and proof-gated actions could mutate reserve accounting or advance the accepted Ethereum version before a later guard failed. | All semantic guards now execute before mutation, the accepted client version commits only after a successful complete transition, and rejected-action tests compare the complete Minima model state digest. P3 now also proves immutable-successor rejection semantics under bounded fuzzing. |
| `F-USDTM-031` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Final reserve-focused P1 rereview | `PAYOUT_ACK` was allowlisted but did not authenticate a payout range or change `P`, `L` and cursors. | The model now consumes an exact finalized contiguous cumulative payout proof, preserves reserve, decreases `P`, binds lower `L`, advances both cursor and total, rejects replay and mutations, and blocks inbound release across an unacknowledged payout. |
| `F-USDTM-032` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Final reserve-focused P1 rereview | The executable model did not demonstrate both release-before-acknowledgement and acknowledgement-before-release orderings with stale-loser behavior. | Both directions now execute, an inbound proof cannot cross an unacknowledged payout, a stale payout proof after an Ethereum head advance rejects without mutation, and rebuilt proofs preserve `I + P <= L`. |
| `F-USDTM-033` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Renewed cross-chain P1 rereview | Release checked collateral against stale stored `L`, then a lower proof-bound `L` could make the post-mutation assertion fail after reserve and nullifier state had changed. | Release now prevalidates `newI + P <= proofL` and regression-tests a lower-`L` rejection against the complete Minima state digest. |
| `F-USDTM-034` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Renewed cross-chain P1 rereview | Cancellation assigned proof-bound `L` while the branch prose required `L` to remain unchanged. | Cancellation is now explicitly a combined client update when its proof advances the authenticated head, prevalidates `I + P <= newL`, and preserves `L` on an equal-head proof. Runtime enforcement remains P6/P8 evidence. |
| `F-USDTM-035` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Renewed reserve P1 rereview | A future or unrelated Ethereum proof version could pass the lower-bound check and poison the accepted client version. | Semantic proofs now bind the exact current authenticated Ethereum version; future and skipped version mutations reject with a complete-state nonmutation check. Actual light-client transition binding remains P6. |
| `F-USDTM-036` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Renewed reserve P1 rereview | The structural co-spend helper exposed raw `RELEASE`, `CANCEL` and `PAYOUT_ACK` labels without their proof guards. | Proof-gated labels now require an internal validated-transition capability supplied only by their guarded dispatcher; every raw path rejects without changing state. |
| `F-USDTM-037` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Renewed reserve P1 rereview | The semantic model's redemption hash did not match the binary commitment specified in the reserve document. | The model now uses the exact zero-padded domain, raw fixed-width identifiers, UINT128 amount, raw 20-byte recipient and UINT64 epoch, with a fixed golden vector. P2 independent encoders and mutations now pass. |
| `F-USDTM-038` | 2026-08-19 | CORRECTED, P1 REREVIEW PASSED | Both renewed P1 rereviews | Raw `CLIENT_UPDATE` remained callable without a proof and accepted a meaningless nonzero amount. | Client update now requires the dispatcher capability and an advancing finalized proof with exact source version, vault balance and payout counters. Raw, missing, nonzero, malformed, equal-head and stale paths reject with full-state nonmutation checks. |
| `F-USDTM-039` | 2026-08-19 | P2 GATE PASSED LOCALLY | Dual independent encoders and mutation validators | Cancellation, deposit, refund, redemption, payout-batch and client-state records now have exact fixed-width encodings, replay domains, golden commitments and semantic negatives. | P2 fixes 163 security-bound fields across six records. Chain inclusion, signature runtime, proof verification, covenant execution and mineability remain later gates. |
| `F-USDTM-040` | 2026-08-19 | P3 GATE PASSED LOCALLY | Immutable reference machine and deterministic fuzz | Pure successor commits preserve capacity, reserve, liability, collateral, payout and tagged-nullifier invariants across focused and fuzzed sequences; rejected actions cannot mutate the predecessor. | This closes the chain-independent reference gate only. P4 through P9 still own runtime semantics and chain evidence. |
| `F-USDTM-041` | 2026-08-19 | P4 PARTIAL, SUPERSEDED BY F-USDTM-042 | Solidity source review plus executable JavaScript semantic model | The valueless vault source implements measured receipt, persistent source records, exact mock-proof refund and redemption paths, shared reentrancy lock and no administrator drain. | The former missing-toolchain statement is superseded. Deployment was and remains unauthorized. |
| `F-USDTM-042` | 2026-08-19 | P4 LOCAL EVM PASS, SUPERSEDED BY F-USDTM-043 | First pinned compiler, bytecode and local Hardhat EVM execution | The initial 11-test suite passed, but rereading the P2 payout-batch requirements exposed a missing persistent payout-record chain and the verifier tuple did not return the exact vault runtime identity. | Corrected by F-USDTM-043 before P4 promotion. |
| `F-USDTM-043` | 2026-08-19 | P4 CORRECTED LOCAL PASS, REVIEW OPEN | Corrected source, semantic model and local Hardhat EVM execution | Every redemption now appends a sequential record with exact ID, amount, recipient and cumulative paid atoms; cancellation and redemption verifier results bind the exact vault runtime identity. Forty semantic checks and 12 EVM tests pass, including rollback, replay, cross-entrypoint callbacks, mixed accounting and local deployed-runtime matching outside compiler-declared immutable ranges. | Bay law 14 independent hostile review remains open. The mock verifier proves no Minima authenticity. No public deployment is authorized or required for this local phase. |
| `F-USDTM-044` | 2026-08-19 | P7 STOCK-CORE BLOCKER CONFIRMED | Official Minima Core source at commit `52542f25605a28a776e9b3b43b0808a05dceab01` | Across 456 Java files, no native general ZK verifier was found. The KISS registry contains SHA2, SHA3, MMR PROOF and signature functions; Witness serializes only signatures, CoinProofs and ScriptProofs; hard limits remain 64 KiB TxPoW and 1,024 KISS operations. | Under `D-USDTM-016`, no Core change or maintainer dependency will be pursued. Proof-only P7 now requires a verifier built entirely from stock primitives. The prepared public issue is retained but must not be posted. |
| `F-USDTM-045` | 2026-08-19 | SOURCE-INSPECTED ESTIMATE, BENCHMARK OPEN | Official `CHECKSIG` implementation at pinned Core commit | Each `CHECKSIG` adds 31 extra KISS instructions in addition to the function instruction, so five checks consume about 160 instructions before covenant logic. Official embedded documentation describes raw WOTS signatures as roughly 400 to 800 bytes, but that is not the complete TreeKey proof or signed TxPoW. | A 5-of-7 exact-record branch is plausible by operation count only. P7 must generate the exact Minima signature form, include every witness and proof byte, run `txncheck`, and mine a worst-case valueless transaction before P8. |
| `F-USDTM-046` | 2026-08-19 | DECLARED CONDITIONAL SAFETY BOUNDARY | Hybrid trust-model analysis | Five active signers can create a valid attestation for a source event that never occurred. No output-shape rule, nullifier or relayer decentralization can detect that lie on Minima. | Production requires independently controlled operators, an exposure cap no larger than recoverable slashable security, delayed rotation and a demonstrated Ethereum-side adjudication path. The bridge must be called threshold-attested or hybrid, never trustless or proof-verified in this direction. |
| `F-USDTM-047` | 2026-08-19 | OFFLINE PARTIAL PASS | Executed deterministic Java harness against the pinned official `minima.jar` | Each default `TreeKey.createDefault(64,3)` signature serialized to 4,125 bytes and verified; five signatures totalled 20,625 bytes, leaving 44,911 bytes below the 65,536-byte TxPoW ceiling before all other content. | Signature bytes alone do not refute 5-of-7 feasibility. P7 still requires the record, state, script proof, coin proofs and complete signed transaction, plus exact KISS execution, `txncheck` and authorized valueless mainnet mining. |
| `F-USDTM-048` | 2026-08-19 | SOURCE-INSPECTED ETH CONSTRAINT | Official Core `tokencreate`, `MiniNumber`, `Token` and KISS amount paths at pinned commit | Minima numeric values support 44 decimal places with magnitude below `2^64`; KISS sees scaled token amounts. The normal token-creation command defaults to at most 16 decimals, but source labels this a non-consensus safety limit and exposes `uselimits:false`. | An 18-decimal ETH representation is source-level plausible but bypasses the normal creation guard. Token creation, wallet display, sends, KISS arithmetic, backup and restore must execute with purpose-created valueless assets before promotion. |
| `F-USDTM-049` | 2026-08-19 | CONDITIONAL ETH FEASIBILITY | Numeric analysis against pinned Core limits | Exact unsigned 64-bit wei accounting reaches at most 18.446744073709551615 ETH. A 10 ETH-equivalent valueless prototype cap fits; larger exact-wei exposure does not fit the simple single-limb model. | Keep the first lane below the bound. Production above it requires a proved multi-limb integer design; silently rounding to gwei is prohibited. |
| `F-USDTM-050` | 2026-08-19 | SEMANTIC PASS, EVM LIMITATION SUPERSEDED BY `F-USDTM-051` | `validate-bridge-asset-lanes.mjs` | A two-lane USDTm/native-ETH model passes 48 assertions and 14 atomic rejection cases, including cross-lane replay and state isolation, forced-ETH exclusion, measured ERC-20 receipts, exact wei, payout failure and native callback reentrancy. | Native ETH bridging is not refuted at the semantic rung. `F-USDTM-051` adds local native vault bytecode; 18-decimal Minima runtime, KISS, complete transactions and chain operations remain unproved. |
| `F-USDTM-051` | 2026-08-19 | P4 GENERIC LOCAL EVM PASS, REVIEW OPEN | Pinned Solidity 0.8.24 and local Hardhat EVM | The immutable native lane accepts only named payable deposits, separates accounted from forced ETH, exact-binds lane/runtime identity, rolls back failed calls, blocks refund/redemption callback reentry and has no withdrawal or surplus sweep. Together the ERC-20 and native lanes pass 22 real-bytecode tests with exact local runtime matching. | Native Ethereum custody is executable locally and no longer only a semantic proposal. P4 remains open for hostile review; the mock verifier, generic record bytes, 18-decimal Minima token and chain transactions remain unproved. |
| `F-USDTM-052` | 2026-08-19 | P7 CANONICAL BYTES PASS | Two independent Node encoders | The generic attestation record is fixed at 444 bytes and 31 fields. ERC-20 and native-ETH fixtures encode identically and all 62 one-field mutations change the digest. | Canonical bytes are established for the offline candidate. This is not KISS, signature, node or chain evidence by itself. |
| `F-USDTM-053` | 2026-08-19 | P7 OFFLINE COMPLETE SYNTHETIC PASS, HOSTILE REVIEW PASS | Pinned official Core jar | Complete two-input, three-output candidates with five real throwaway TreeKey signatures, transaction state, KISS script, script proof and two 32-level coin proofs serialize to 31,886 bytes for ERC-20 and at most 32,054 bytes for ETH. Advancing-head, equal-head and reserve branches use 539, 553 and 148 instructions. All pass, while 63 hostile checks per lane reject. | Size and KISS operation limits are not the current blocker. Coin proofs and token metadata remain synthetic; no node `txncheck`, token creation, post or mining occurred. |
| `F-USDTM-054` | 2026-08-19 | EXPLICIT THRESHOLD LIMITATION, ACCEPTED FOR VALUELESS PROTOTYPE | Exact stock-KISS design plus `D-USDTM-020` | Transaction-bound signatures prevent replay after the unique control coin is spent, but the candidate does not prove historical non-membership for an arbitrary deposit ID. Honest operators must independently reconstruct the lane journal and refuse duplicates. | Five colluders could sign a duplicate just as they could sign a nonexistent deposit. The founder accepted this inside the declared threshold trust boundary for the prototype; it remains an explicit conditional-safety limitation. |
| `F-USDTM-055` | 2026-08-19 | P7 HOSTILE REFUTATION CORRECTED, REREVIEW OPEN | Independent hostile review and pinned Core regression | The first complete candidate advanced Ethereum payout counters while preserving pending liability and required every deposit to advance the Ethereum head. The corrected release preserves payout cursor and cumulative paid, accepts an exact equal-head snapshot only within a 100 Minima-block window, and rejects counter or snapshot drift. | The two HIGH transition defects found by hostile review are locally closed. The corrected revision remains review-open until the independent rereview passes. |
| `F-USDTM-056` | 2026-08-19 | P7 SECOND HOSTILE REFUTATION CORRECTED, REREVIEW OPEN | Independent hostile review and freshly signed KISS regressions | The second review found that release omitted control-state ports 19 through 24 and that structural tests reused old signatures. The predecessor now carries all six nondefault fields, release enforces `SAMESTATE(19 24)`, each port mutation is freshly signed and rejected, and all 14 structural mutations are freshly signed before KISS execution. | Unrelated redemption-publication and freshness configuration can no longer be changed by an otherwise authorized release. Independent rereview remains required. |
| `F-USDTM-057` | 2026-08-19 | P7 TIME BOUNDS CORRECTED, REREVIEW OPEN | Canonical record encoders and pinned Core regressions | The final 8-byte generic field now commits source execution time in milliseconds instead of an expiry in seconds. KISS enforces source time no older than port 23 and no farther in the future than port 24; freshly signed stale and future-skew mutations reject. | The record semantics now match the reserve specification without unit conversion. Independent rereview remains required. |
| `F-USDTM-058` | 2026-08-19 | P7 OFFLINE HOSTILE REREVIEW PASS | Independent read-only hostile review | The settled canonical validator passed 82 assertions and 62 field mutations. The settled P7 harness passed 68 assertions and 63 hostile checks per lane with no unresolved critical or high semantic/property defect. | This closes the offline synthetic review rung only. Synthetic proofs, stock-node `txncheck`, mainnet mining and WOTS durability remain open. The quorum-journal boundary was subsequently accepted in `D-USDTM-020`. |
| `F-USDTM-059` | 2026-08-19 | MAINNET CEREMONY PREFLIGHT PASS, UNFUNDED | Stock Core 1.1.2.6 node execution | A fresh encrypted `USDTmIssuer` node synced to mainnet, pinned one receive address and parsed the exact USDTm and 18-decimal ETHm creation commands. Each stopped at `No Minima Coins available!`; token count and mempool remained unchanged. Actual 1.1.2.6 bytecode also confirms that `tokencreate` floors token count before decimal scaling. | No chain write occurred. The command-native supplies are therefore 1,000,001 USDTm and 11 ETHm, with the earlier caps retained. Funding and a return address are required before minting. |
| `F-USDTM-060` | 2026-08-19 | BLOCKED ON EXTERNAL FUNDING INPUT | Founder-node balance and issuer preflight | The only active founder node reports 0.100321 confirmed Minima but 0 sendable, while `USDTmIssuer` reports zero. | Do not choose another wallet or return address silently. The founder must send a small Minima coin from the intended funding wallet and identify the exact return address. |
| `F-USDTM-061` | 2026-08-19 | MAINNET DUAL-LANE GENESIS PASS | Stock Core 1.1.2.6 issuer and independent signer-fixture nodes | Purpose-created valueless USDTm, ETHm and their one-unit control tokens mined. Exact two-input/two-output genesis transactions then created the USDTm control/reserve coins at block 2269336 and ETHm control/reserve coins at block 2269338. Each control coin carries all 40 committed state ports byte-for-byte; each reserve has no state and the exact full supply. All remaining Minima, `0.09999999999999999999999988999998999998999998`, returned with zero burn to the pinned original funding-input address at block 2269339, leaving the issuer with zero sendable coins. | This proves live token creation and exact covenant genesis on stock mainnet. It does not yet prove a 5-of-7 covenant spend, decentralized control, real Ethereum facts, WOTS crash recovery or production safety. Evidence: `generic-mainnet-genesis-20260819T121551Z.json`. |
| `F-USDTM-062` | 2026-08-19 | P7 LIVE MAINNET REFUTATION | Real v1 USDTm covenant inputs and five fixture TreeKey witnesses | Transaction `0xA26C...F5BC` passed `txncheck` at construction height 2269351 with five valid signatures, real MMR proofs, both scripts, exact conservation and zero burn. After the height advanced, `scripts` became false, the mempool dropped the transaction, both inputs remained unspent and no output existed. The first five TreeKeys each advanced from use 0 to use 1. | `STATE(17) == @BLOCK` is an operational mineability defect: mempool admission and block inclusion do not share a stable height. Deployed v1 cannot change address and is not a passing lane. Evidence: `generic-p7-live-refutation-20260819T122914Z.json`. |
| `F-USDTM-063` | 2026-08-19 | V2 OFFLINE CORRECTION PASS | Pinned Core synthetic harness and stock-node parser | Candidate v2 requires port 17 to be monotonic, no later than `@BLOCK`, and no more than port 18 blocks behind. Both template instances parse; the strengthened rerun passes 70 assertions and 66 hostile checks per lane. Maximum serialized TxPoW is 32,134 bytes and the largest branch is 553 instructions. | This corrects the discovered rule offline only. The displayed v2 addresses bind the trapped v1 token IDs and are provisional template evidence, not deployable replacement addresses. Current evidence: `generic-p7-txpow-validation-20260819T124631Z.json`, SHA-256 `711f9ea8488e04a73a2b132b9576b30b05704178a9f38bdaaee8e763caad6bd4`. |
| `F-USDTM-064` | 2026-08-19 | V2 OFFLINE HOSTILE REREVIEW PASS | Adversarial boundary review, pinned Core harness and normal signer-node restart | The review separated the posting-lag mutation from the monotonic guard. Lag zero, lag one, the monotonic boundary and exact maximum lag accept; future height, rollback and one beyond maximum lag reject independently. All prior record, quorum, output, counter, reserve, state-port and time attacks still reject. The five v1 failed-attempt key uses and signed intent survived a graceful restart exactly. No unresolved critical or high defect remains at this offline correction gate. | P7 is not passed: no token-bound v2 UTXO exists, no v2 node `txncheck` or mining occurred, the seven keys are one controller, and restore/rollback WOTS durability is unproved. Evidence: `generic-p7-v2-hostile-rereview-20260819T124647Z.json`, SHA-256 `591b7748113f411df20df441b50ff8a69e8360231a25dcba2ee0aadfbd3ec75b`. |
| `F-USDTM-065` | 2026-08-19 | V2 MAINNET CEREMONY PREFLIGHT PASS | Fresh encrypted stock Core 1.1.2.6 `USDTmIssuerV2` | A separate one-use wallet synced to mainnet on ports 9801/9805 with one active seed copy. All four exact `USDTm-v2`, `ETHm-v2` and control-token commands reached the expected no-funds gate without changing token count or mempool. | No mint or transaction was posted. The issuer now waits for one small Minima funding input; its actual input address will be pinned as the mandatory residual-return address before minting. Evidence: `generic-mainnet-v2-ceremony-preflight-20260819T131213Z.json`, SHA-256 `145ca6960281100abef555ca276fde1db214256c66854184f3203095ad94c3f9`. |
| `F-USDTM-066` | 2026-08-19 | P7 LIVE V2 MAINNET GATE PASSED | Fresh token-bound v2 covenants, stock Core 1.1.2.6 and five fixture TreeKey witnesses | USDTm-v2 transaction `0xF50B...56C1` mined at block 2269510 and ETHm-v2 transaction `0x679C...97B5` mined at block 2269511. Each passed exact node `txncheck`, used two real inputs and three exact outputs, persisted the 444-byte attestation and exact successor state, burned zero and remained below 64 KiB and 1,024 KISS operations. A prior USDTm-v2 signed intent rejected before posting because its nullifier successor used the wrong fields; all five WOTS uses and the exact intent are preserved and never reused. | This passes P7 mineability for both lane shapes. It does not prove decentralized operators, authentic Ethereum facts, rollback-safe WOTS recovery or the remaining P8 branches. Every residual Minima atom returned to the exact funding-input address at block 2269514; the empty issuer is stopped and `NEVER-REUSE`. Evidence: `generic-mainnet-v2-live-p7-20260819T143029Z.json`, SHA-256 `0f4829b83ffe15827fd60f24f85dae88f25621627349e2db8262c1969bb00675`. |
| `F-USDTM-067` | 2026-08-19 | P8 V2 IMMUTABILITY OBSTRUCTION CONFIRMED | Exact mined v2 KISS scripts and branch-coverage validator | Both mined v2 scripts require exactly two inputs and three outputs, contain only RELEASE, and have no action dispatcher, MAST branch, migration branch or upgrade path. They cannot execute CLIENT_UPDATE, RETURN, CANCEL or PAYOUT_ACK without changing the covenant address. | Preserve v2 as passing P7 evidence. P8 requires a fresh generation and cannot claim that the already mined coins are upgradeable. Evidence: `generic-p8-v2-branch-coverage-20260819T150018Z.json`, SHA-256 `339c360f63f59c53d6ea8be098199c3007ca52f3b6a2d17f6a87d76195d247c7`. |
| `F-USDTM-068` | 2026-08-19 | P8 OFFLINE ALL-BRANCH CANDIDATE PASS | Two independent encoders and pinned Core all-action harness | Ten action/lane executions reproduce canonical records byte-for-byte, execute the exact control, reserve and RETURN-owner scripts, conserve both token IDs, reject eight freshly authorized attacks per execution, including a proof-bound undercollateralized vault mutation, and serialize complete 32-level synthetic TxPoWs below 64 KiB. The largest control branch uses 596 of 1,024 instructions; the largest observed TxPoW is below 43 KiB. | CLIENT_UPDATE and PAYOUT_ACK now enforce post-transition collateral and cap bounds before accepting a lower authenticated vault balance. This closes the offline construction and hostile-test rung only. P8 remains NOW because its binding exit gate requires fresh real mainnet UTXOs, node `txncheck` and mining of all five branches for both lanes. Evidence: `generic-p8-unified-smoke-20260819T160551Z.json`, SHA-256 `7d781f6255c0a4af6d379cf1fad563bb6d69125460c1f46afa1201868f97f803`. |
| `F-USDTM-069` | 2026-08-19 | P8 MAINNET CEREMONY PREFLIGHT PASSED | Fresh stock-Core issuer and four no-funds token-create probes | The dedicated `USDTmIssuerP8` node synchronized on mainnet with zero confirmed, sendable and unconfirmed Minima. All four exact token definitions stopped at the expected no-funds gate, while token count and mempool remained unchanged. | `D-USDTM-023` authorizes the remaining valueless ceremony, but no token, signature or transaction was created by this preflight. Funding-input identification and exact return-address pinning are the next blocking gate. Evidence: `generic-mainnet-p8-ceremony-preflight-20260819T160833Z.json`, SHA-256 `f3376f45e290f1a4ec610bf8a2fbd71f8c8d00e4c03cb9b524fa61269b7ed9f6`. |

## 6. Phase board

The `Current status` column is the authoritative plan state. Only one row may be `NOW`.

| Phase | Current status | Objective | Exit gate |
|---|---|---|---|
| `P0` | GATE PASSED | Freeze scope, trust model, authorization boundary and control-document format. | Decisions `D-USDTM-001` through `D-USDTM-014` are recorded; open choices are explicit; fresh structural, evidence-sidecar, current-delta allowlist and manifest checks pass against the current files. |
| `P1` | GATE PASSED | Consolidate the threat model and accounting invariants against the chosen USDTm scope. | Attack list covers both chains, proof systems, cancellation, reserve transitions, governance and liveness; two hostile reviewers find no unresolved critical or high defect. |
| `P2` | GATE PASSED | Freeze canonical cross-chain bytes, hashes, actions, recipient encoding and replay domains. | Two independent encoders agree on golden fixtures; all security-bound field mutations fail. |
| `P3` | GATE PASSED | Implement the chain-independent reference state machine and property tests. | Invariants hold across fuzzed action sequences; deliberate mutations are detected. |
| `P4` | LOCAL PASS REVIEW OPEN | Generalize the valueless Ethereum vault into immutable per-asset lanes with ERC-20 and native ETH adapters. | Both adapters pass unit, invariant, forced-balance, reentrancy, failed-transfer and cross-lane tests; deployed local bytecode matches reviewed source; no claim of Minima-proof authenticity and no real asset is accepted. |
| `P5` | BLOCKED | Implement generic Minima consensus light-client proofs and the Ethereum verifier for Minima-to-Ethereum settlement. | Stateful prior-to-new updates, fork choice, Cascade and MMR verification pass hostile vectors with measured Ethereum gas; exact reserve-return binding is deferred to the post-P8/P9 re-gate. Begin after P4 review and the short P7 feasibility benchmark, then re-gate against mined P8/P9 shapes. |
| `P6` | BLOCKED | Implement decentralized attestor membership, Ethereum bonds, delayed rotation, slashing adjudication and liveness policy. | Independent-control criteria, quorum economics, exit delay, false-attestation and equivocation evidence, exposure recovery and no-central-coordinator liveness pass hostile tests. Blocked on the P7 exact signature form and on founder decisions `O-USDTM-012` and `O-USDTM-013` for production promotion. |
| `P7` | GATE PASSED | Under `D-USDTM-022`, prove the stock-Core 5-of-7 generic asset-lane branch is operationally mineable with fresh token-bound v2 lanes. | Canonical lane records reject cross-asset replay and hostile mutations; exact KISS branches cover six-decimal ERC-20 and 18-decimal native ETH lanes; a fully signed worst-case valueless transaction passes `txncheck`, survives ordinary posting lag and mines within 64 KiB and 1,024 operations. Failed WOTS uses are journaled and never reused. |
| `P8` | NOW | Implement isolated valueless Minima reserve covenants from one generic five-action lane template. | Every exact branch mines on Minima mainnet with purpose-created valueless assets for both USDTm and ETHm lane instances; 18-decimal compatibility and cross-lane isolation pass. No signer-only unrestricted spend exists. |
| `P9` | BLOCKED | Build exact Minima transaction constructors and recovery behavior. | Exact transactions mine on Minima mainnet, successor coins confirm, typed verdicts are unambiguous, retries cannot duplicate settlement, and durable WOTS leaf reservation survives rollback and restored-node attacks. Blocked on `P8`. |
| `P10` | BLOCKED | Execute complete two-way valueless lifecycles with independent relayers. | One ERC-20 lane and the native ETH lane each complete deposit, attestation, reserve release, return, proof and mock payout twice without privileged relayer keys or cross-lane state changes. Blocked on `P5` through `P9`. |
| `P11` | BLOCKED | Run the full adversarial campaign. | Independent refuters return no unresolved critical or high defect. Blocked on `P10`. |
| `P12` | BLOCKED | Prove operations, observability, recovery and safe halt behavior. | A clean operator reconstructs authoritative state from chains and proofs; monitors are not validity gates. Blocked on `P11`. |
| `P13` | NOT AUTHORIZED | Make the production go or no-go decision. | All prior gates pass, external audits are complete, founder decisions `O-USDTM-002` through `O-USDTM-017` are recorded, real operator independence and aggregate slashable security are evidenced, and a capped per-lane production launch is separately authorized. |

## 7. Detailed execution plan

### P0: Scope and trust model

Tasks:

1. Record the founder's selected token, backing and hybrid directional trust model.
2. Separate USDTm from mxUSDT completely.
3. Define the no-funds and write boundaries.
4. Define evidence vocabulary and status meanings.
5. Add a structural validator that refuses ambiguous phase and log state.
6. Preserve a read-only final-state scope artifact for `2_development`.
7. Regenerate the research manifest only after the control document, validators and evidence settle.

Evidence required:

- this document;
- a passing structural-validator run;
- a scope artifact showing the current uncommitted repository delta is confined to the research
  allowlist and `2_development` is clean relative to the recorded HEAD and tree, without claiming
  attribution or a missing pre-slice baseline;
- a current manifest containing this document, both control validators and their matching evidence.

### P1: Threat model and accounting

Tasks:

1. Define assets, authorities and all canonical state.
2. Prove the accounting transitions preserve `R + I = F` and `I + P <= L`.
3. Model simultaneous inbound release and outbound payout interleavings.
4. Model vault drains, token freezes, client-state stalls and proof withholding.
5. Model deposit states `PENDING`, `RELEASED`, `CANCELLED` and `REFUNDED` and every race between them.
6. Define permitted halt behavior without an emergency drain.
7. Reconcile every attack already listed in `adversarial-verification-plan.md`.
8. Submit the result to two independent reviewers instructed to refute it.

### P2: Canonical protocol schema

Tasks:

1. Freeze fixed-width integer and byte encodings.
2. Bind both chain identities and both bridge deployments.
3. Bind proof programme, verifier version and verification-key hash.
4. Define Minima recipient bytes and domain-separated commitment.
5. Define deposit, redemption and payout-batch records.
6. Define current Ethereum client-state commitment.
7. Define separate Ethereum deposit-record and Minima-nullifier state machines, including a
   cancellation action that proves the exact finalized `PENDING` record and its committed authority.
8. Define source timestamp age and future-skew rules without KISS division.
9. Define exact capacity reservation and one-time restoration on proof-gated refund.
10. Create independent encoder fixtures and mutations for `EMPTY` to `RELEASED`, `EMPTY` to
    `CANCELLED`, `PENDING` to `REFUNDED` and all forbidden transitions.

### P3: Reference state machine

Tasks:

1. Implement pure integer transitions for client updates, releases, cancellations, refunds, returns
   and payout acknowledgements.
2. Implement a canonical tagged nullifier accumulator.
3. Test same-block multiple deposits and multiple payouts.
4. Test out-of-order valid records without a global deadlock.
5. Test crash and retry behavior.
6. Fuzz transition sequences and compare against the declared invariants.
7. Break each guard and confirm a test notices the break.

### P4: Generic valueless Ethereum vault lanes

Tasks:

1. Use one immutable vault deployment per asset lane from common reviewed source; version 1 has no
   mutable asset registry.
2. Retain the six-decimal mock ERC-20 lane and measure actual vault balance increase rather than
   trusting a requested amount.
3. Add a native ETH lane whose named payable deposit records exact `msg.value`, rejects ordinary
   receive/fallback transfers and tracks attributable ETH in an internal ledger rather than raw
   contract balance.
4. Treat forced ETH as non-attributable surplus with no administrator sweep in version 1.
5. Validate the canonical Minima recipient and exact lane ID before accepting a deposit.
6. Write lane-separated persistent Ethereum deposit records with exact `ABSENT` to `PENDING` to `REFUNDED`
   transitions, plus persistent payout records. `RELEASED` and `CANCELLED` are separate terminal
   Minima nullifier states and are never represented as Ethereum record transitions.
7. Unit-test refund through a mock Minima-proof verifier interface only; `P4` does not establish
   proof authenticity and cannot authorize integration.
8. Consume redemption IDs before ERC-20 transfer or native ETH call under one global reentrancy lock;
   receiver failure reverts every state and accounting effect.
9. Exclude arbitrary administrator withdrawal and forced-surplus sweep from version 1.
10. Bind exact lane, source asset kind/address, decimals, quantum, destination token, runtime and
    deployment identity into every authenticated record.
11. Test reentrancy, failed transfers, forced ETH, malformed recipients, duplicate and cross-lane
    records, same-block actions and every release, cancellation and refund race.

### P5: Minima proof on Ethereum

Tasks:

1. Obtain consensus-authoritative binary vectors from Minima Core.
2. Implement exact TxPoW serialization and hashing.
3. Implement work, parent, super-parent and cumulative-work rules.
4. Implement fork choice and Cascade transitions from stored prior state.
5. Verify generic Minima transaction, state-output and MMR inclusion from the stored prior client state.
6. Verify the canonical Minima deposit-cancellation transition required for proof-gated Ethereum refund.
7. Define confirmation, delayed settlement and late-heavier-fork behavior.
8. Generate succinct proofs and verify them in Ethereum.
9. Measure proof generation, proof size, persistent state and gas.
10. After `P8` and `P9` produce canonical mined cancellation and reserve-return fixtures, bind both
    exact transaction shapes and rerun the `P5` gate before `P10`.

### P6: Decentralized attestor security

Tasks:

1. Register one Minima attestation public key and one Ethereum bond identity per operator.
2. Define objective independent-control evidence; seven keys under one controller do not qualify.
3. Activate committee roots by delayed epochs and prohibit retroactive or same-transaction rotation.
4. Require a long exit delay covering attestation expiry, source finality and fraud challenges.
5. Define objective false-attestation and equivocation evidence and an Ethereum-verifiable
   adjudication path for the exact Minima signature form.
6. Require the minimum slashable bond of any valid quorum to cover the selected bridge exposure
   cap, without describing slashing as prevention.
7. Prove that no coordinator key, relayer key or minority signer can redirect outputs, bypass caps,
   alter the committee or halt an already assembled quorum.
8. Test availability under offline signers, geographic and provider failures, rotation, exits,
   censored relayers and conflicting attestations.
9. Keep the Ethereum light-client and vault-state proof programme as a separate research candidate;
   if it later fits stock KISS, it may replace attestations without weakening the reverse direction.

### P7: Stock-Core attestation feasibility and proof research

Tasks:

1. Freeze the canonical Ethereum-deposit attestation record and domain separation in
   `usdtm-p7-threshold-attestation-v1.md`.
2. Extend that record with the immutable fields and nullifier domain in
   `bridge-asset-lanes-v1.md`; the existing 335-byte record is evidence for one ERC-20 lane only,
   not the final generic encoding.
3. Use `CHECKSIG` over that record for the first benchmark, not witness `MULTISIG` over a mutable
   transaction, so independently collected signatures bind the same source claim.
4. Require five unique signer indexes from the active seven-member epoch and reject duplicates,
   outsiders, stale epochs, malformed records, replay and expired attestations.
5. Independently enforce the lane-local nullifier, positive reserve remainder, rolling cap and exact successor
   outputs. No attestor or quorum receives an unrestricted spend branch.
6. Measure the exact KISS operation count and the complete TreeKey/WOTS public key, signature,
   Merkle proof, script proof and signed TxPoW size.
7. Reserve every WOTS leaf in durable write-ahead state outside the rollback domain before signing;
   test crash, retry and restored-node reuse attacks.
8. Run hostile vectors through both six-decimal and exact-wei KISS branches and confirm rejected transactions do not spend
   the reserve.
9. Mine fully signed worst-case purpose-created valueless transactions on ordinary stock Minima
   mainnet nodes after separate authorization for the token and transaction ceremony.
10. In parallel, exclude proof candidates that require unshipped pairing, BLS, ECDSA recovery or new
   witness primitives, and benchmark only proof verifiers expressible under current stock limits.
11. Failure of the proof-verifier lane does not stop the hybrid prototype. Failure of the 5-of-7
    signed transaction, WOTS safety or exact covenant branch stops `P8`.

### P8: Minima reserve covenant

Tasks:

1. Create a unique one-unit control token for canonical lineage in the later authorized valueless run.
2. Implement the decided two-coin topology: every control transition atomically co-spends control
   and reserve and recreates reserve as fixed sibling output 1.
3. Prove a constructive reserve-lineage rule, or prove amount-equivalent substitution safe, including
   the equal-amount lookalike and donation attacks. Design prose is not sufficient.
4. Freeze every state port and token-level script before token creation.
5. Write exact branch tables for client update, inbound release, outbound return, deposit cancellation
   and payout acknowledgement.
6. Pin all fund-moving outputs with `VERIFYOUT` and exact keep-state behavior.
7. Preserve unchanged ports with `SAMESTATE` ranges.
8. Enforce conservation explicitly and refuse implicit burns.
9. Exclude signer-only, upgrade and emergency-drain branches from version 1.

### P9: Minima transaction construction

Required sequence:

1. `txncreate`.
2. Add inputs without `scriptmmr:true`.
3. Add exact outputs and transaction state.
4. `txnsign`.
5. `txnbasics`.
6. `txncheck` and require script, amount and MMR verdicts.
7. `txnpost auto:false`.
8. Confirm the exact mined transaction and successor coins.
9. `txndelete` only after definite pre-broadcast refusal or on-chain reconciliation proves the
   transaction did not settle.

Additional tasks:

- serialize WOTS signing across all clients;
- reserve each WOTS leaf or range in durable write-ahead state outside the rollback domain before
  any signature operation and permanently retire every reserved leaf whether or not a transaction mines;
- after uncertain restore, rotate to a fresh seed and key domain or skip beyond a conservatively
  durable high-water mark before signing;
- keep duplicate restored nodes using the same seed and key-use state disabled, not merely locked;
- persist intent before signing or broadcast;
- treat timeout as unknown, never refusal;
- make retries idempotent;
- normalize typed `txncheck` booleans and reject missing or ambiguous verdict fields;
- prove no signature is produced before reservation durability, and test backup rollback,
  concurrent restore and broadcast-unknown recovery without WOTS reuse;
- exclude covenant and watch-only coins from ordinary funding selection.

### P10: Two-way integration

Tasks:

1. Deposit mock USDT.
2. Wait for authenticated Ethereum finality.
3. Generate and submit the Ethereum proof permissionlessly.
4. Mine the exact TEST-USDTm reserve release.
5. Separately exercise the Minima cancellation transition and proof-gated Ethereum refund.
6. Return TEST-USDTm to the reserve.
7. Wait for the selected Minima confirmation and work policy.
8. Re-gate `P5` against the exact mined `P8` and `P9` reserve-return transaction.
9. Generate and submit the Minima proof permissionlessly.
10. Release mock USDT.
11. Reconcile client state, nullifiers, reserve, issued liability and pending liability.
12. Run release, cancellation and refund in every race ordering.
13. Repeat with a different relayer after interrupting the first.

### P11: Adversarial campaign

Required attack families:

- replay and cross-deployment replay;
- wrong chain, vault, token, direction, amount or recipient;
- wrong proof programme, verification key, epoch or version;
- invalid and stale client updates;
- valid proof for a non-canonical branch;
- Minima late heavier fork;
- Ethereum weak-subjectivity and finality failures;
- malformed SSZ, RLP, MPT and typed receipts;
- same-block deposits and payout batches;
- skipped persistent records;
- reserve exhaustion and donation coins;
- equal-amount reserve lookalike substitution;
- short custom-token output and implicit burn;
- state-coin cloning and concurrent spends;
- proof-size, instruction, memory and CPU denial of service;
- WOTS reuse, rollback and concurrent signing;
- vault reentrancy, token pause, blacklist and changed implementation;
- crash after sign, broadcast or proof acceptance;
- release, cancellation and refund races;
- relayer censorship and fee starvation.

### P12: Operations and recovery

Tasks:

1. Publish proof, message, nullifier and client-state identifiers.
2. Reconcile vault collateral against authoritative liabilities.
3. Monitor proof and client-state lag without granting monitors validity power.
4. Provide deterministic recovery bundles that contain no secret material.
5. Define stale-checkpoint and unknown-fork halt behavior.
6. Prove a clean operator can reconstruct state from public chain evidence.

### P13: Production decision

No production action is implied by completion of research. A separate founder decision must authorize:

- production token creation;
- production vault deployment;
- real USDT acceptance;
- initial exposure cap;
- public wording;
- audit acceptance;
- release and incident procedures.

## 8. Evidence ladder

| Rung | Meaning | Current status |
|---|---|---|
| `E0` | Design text only | Passed for the initial architecture, never sufficient for settlement claims |
| `E1` | Deterministic schema and mutation fixtures | Fresh run passed on 2026-08-19: 1005-byte schema, six accepted vectors and 36 rejected negative vectors |
| `E2` | Independent consensus parsing and state-transition implementation | Not passed |
| `E3` | Real proof generated and verified off-chain | Winterfell experiment passed off-chain only for its example, but the bridge proof programmes have not passed |
| `E4` | Native destination verifier executes the real proof | Not passed |
| `E5` | Exact fully signed valueless destination transaction passes all checks | Not passed |
| `E6` | Transaction mines and exact successor state confirms | Not passed |
| `E7` | Complete two-way valueless lifecycle survives adversarial review | Not passed |
| `E8` | External audit and separately authorized capped production | Not authorized |

## 9. Evidence register

The immutable evidence files remain in `evidence/`. Superseded evidence stays preserved and is not
represented as current.

| ID | Date | Artifact or observation | Evidence rung | Result | Limitation |
|---|---|---|---|---|---|
| `E-USDTM-001` | 2026-08-18 | `evidence/minima-runtime-probe-20260818T165850Z.json` | Runtime capability observation | Current parser lacks named BLS, pairing and ECDSA recovery functions; KISS limit observed | Does not test a future native verifier |
| `E-USDTM-002` | 2026-08-18 | `evidence/minima-kernel-probe-20260818T174231Z.json` | Runtime capability observation | Numeric and SHA3 instruction limits observed | Not a proof-verifier transaction |
| `E-USDTM-003` | 2026-08-18 | Winterfell proof binaries and sidecars | Off-chain proof experiment | Example proofs generated and verified upstream | Not a bridge proof and not verified by Minima |
| `E-USDTM-004` | 2026-08-18 | `fixtures/minima-consensus-mainnet-20260818T203435Z.json` | Mainnet RPC fixture | 32 preserved block responses | RPC response shape is not canonical binary consensus serialization |
| `E-USDTM-005` | 2026-08-18 | `evidence/minima-consensus-fixture-validation-20260818T203519Z.json` | Deterministic fixture validation | Declared checks passed and seven corruptions rejected | No independent consensus implementation |
| `E-USDTM-006` | 2026-08-19 | `evidence/rfc-fixture-validation-20260818T210649Z.json`, SHA-256 `71fb814e27a3a9e5d6951fd822866b7e0a9140997805f9ffafff698285be22ec` | `E1` schema-only validation | Current fixture and validator passed 42 cases: six accepts and 36 intended rejects, encoded length 1005 bytes | No ZK proof, client-state implementation, covenant, Ethereum authentication or Minima transaction was executed |
| `E-USDTM-007` | 2026-08-19 | `evidence/minima-consensus-fixture-validation-20260818T210649Z.json`, SHA-256 `b0b37f222a370ec53bdaa27b4ca42d481d5dabacb1c32b4347ed1eebde215623` | RPC-fixture validation below `E2` | Current validator rechecked 32 stored mainnet RPC blocks and rejected seven deliberate corruptions | Does not recompute consensus serialization, difficulty, cumulative work, fork choice, Cascade transitions or MMR proofs |
| `E-USDTM-008` | 2026-08-19 | Newest matching `evidence/usdtm-control-validation-*.json` and sidecar | Document-structure validation | Enforces 14 phase rows, exactly one NOW, unique decision, finding and evidence IDs, required invariants, no-funds wording and no em dash | Does not validate bridge cryptography or economic correctness |
| `E-USDTM-009` | 2026-08-19 | Newest matching `evidence/usdtm-scope-validation-*.json` and sidecar | Current repository-delta scope check | `validate-usdtm-scope.mjs` records HEAD and the protected tree, requires `2_development` clean, and allows current uncommitted paths only inside the explicit research allowlist | No trusted pre-slice baseline exists; it cannot attribute commits, concurrent work or transient writes |
| `E-USDTM-010` | 2026-08-19 | Newest matching `evidence/usdtm-p1-model-validation-*.json` and sidecar | Local semantic/property model | Corrected model passes 140 assertions, six cancellation race permutations, 22 cancellation-field mutations and 27 deliberate mutations; both hostile reviewers report no unresolved critical or high P1 defect | Local model only; late heavier-fork double settlement is preserved as a production blocker, and no EVM, KISS, proof or chain runtime executed |
| `E-USDTM-011` | 2026-08-19 | Newest matching `evidence/usdtm-p2-cancellation-validation-*.json` and sidecar | P2 schema-only validation | Two independent encoders agree on the exact 512-byte cancellation record and all 27 field mutations change its fixed commitment | Cancellation record only; other P2 records and every runtime claim remain open |
| `E-USDTM-012` | 2026-08-19 | Newest matching `evidence/usdtm-p2-record-validation-*.json` and sidecar | P2 schema-only validation | Independent encoders agree on five further fixed records; all 136 fields mutate the commitment and 19 semantic negatives reject | Bytes and local arithmetic only; no chain or proof runtime |
| `E-USDTM-013` | 2026-08-19 | Newest matching `evidence/usdtm-p3-reference-validation-*.json` and sidecar | Chain-independent reference validation | 64 by 128 deterministic fuzz steps, focused same-block/out-of-order/crash-retry tests, rejected-state digest checks and 10 of 10 deliberate mutations pass | Bounded local model, not EVM, KISS, proof or consensus execution |
| `E-USDTM-014` | 2026-08-19 | Newest matching `evidence/usdtm-p4-vault-model-validation-*.json` and sidecar | Partial source plus semantic-model validation | Reviewed-source assertions and 35 semantic checks pass with `phaseGatePassed:false` | This artifact itself is not compiler, EVM or deployment evidence; E-USDTM-015 separately owns local compiler and EVM execution |
| `E-USDTM-015` | 2026-08-19 | Newest matching `evidence/usdtm-p4-evm-validation-*.json` and sidecar | Pinned local Solidity and EVM validation | Clean Solidity 0.8.24 compilation and 22 real-bytecode ERC-20/native-ETH tests pass; compiler, Hardhat, lockfile, both vaults, tests, bytecode hashes and local deployed-runtime matches are recorded | Ephemeral local mock execution only; independent hostile review, generic record bytes, Minima runtime and proof authenticity remain open |
| `E-USDTM-016` | 2026-08-19 | Newest matching `evidence/minima-core-zk-surface-*.json` and sidecar | Pinned official Core source inspection | At exact official commit `52542f...ab01`, 456 Java files and six hashed extension-point files confirm no native ZK verifier or generic proof witness, plus the 64 KiB and 1,024-operation hard limits | Source inspection only; no exact stock-primitives verifier benchmark, signed transaction or mined proof verification |
| `E-USDTM-017` | 2026-08-19 | Newest matching `evidence/usdtm-p7-threshold-validation-*.json` and sidecar | Local threshold semantic validation | The 5-of-7 model checks exact record binding, 20 field mutations, eight output mutations, 51 rejected-state atomicity cases, replay, source-snapshot monotonicity, caps and exact reserve transitions | Semantic mock signatures only. The deliberately accepted colluding-quorum false claim proves the trust boundary; no KISS, TreeKey/WOTS, signed TxPoW, independent operator or slashing runtime was demonstrated |
| `E-USDTM-018` | 2026-08-19 | Newest matching `evidence/minima-treekey-signature-validation-*.json` and sidecar | Offline official-Core signature serialization | Five deterministic throwaway default TreeKey signatures verify against the pinned official jar and serialize to 20,625 bytes total | Not a wallet, witness, script proof or complete TxPoW; no KISS execution, `txncheck`, node command, transaction or mining occurred |
| `E-USDTM-019` | 2026-08-19 | Newest matching `evidence/generic-bridge-asset-lane-validation-*.json` and sidecar | Generic-lane semantic model plus pinned Core source assertions | Two isolated USDTm and native-ETH lanes pass 48 assertions and 14 atomic rejection cases, including exact wei, forced-balance exclusion, cross-lane isolation, measured ERC-20 deposits and native payout callbacks | No Solidity native vault, 18-decimal token runtime, KISS execution, complete signed transaction, wallet, node or chain action; `ETHm` and the cap are provisional fixtures |
| `E-USDTM-020` | 2026-08-19 | Newest matching `evidence/generic-attestation-validation-*.json` and sidecar | Generic canonical-byte validation | Two independent encoders agree on both 444-byte records and all 62 one-field mutations change the digest | Local bytes and SHA3 only; transaction signatures, KISS and chain behavior are separate evidence |
| `E-USDTM-021` | 2026-08-19 | Newest matching `evidence/generic-p7-txpow-validation-*.json` and sidecar | Offline complete synthetic TxPoW execution | Pinned Core serializes and executes both fully signed candidate transactions below 64 KiB and 1,024 instructions, with exact 18-decimal wei arithmetic, bounded equal-head reuse, source-time guards and 63 hostile checks rejected per lane | Coin proofs and token metadata are synthetic; no node `txncheck`, 18-decimal token creation, posting or mainnet mining occurred; historical deposit non-reuse remains the explicitly accepted quorum-journal assumption |
| `E-USDTM-022` | 2026-08-19 | `evidence/generic-mainnet-ceremony-preflight-20260819T111939Z.json`, SHA-256 `d503e62a4fcf9ed9ca17cc966fddbb86ba45ea5249197b5d19b92e14f5f06c89` | Live stock-mainnet preflight below `E5` | Fresh Core 1.1.2.6 issuer synced, address pinned, exact six- and eighteen-decimal commands parsed, and no-funds rejection left token count and mempool unchanged | No token, signature, `txncheck`, post or mined transaction; issuer funding and return address are still missing |
| `E-USDTM-023` | 2026-08-19 | `evidence/generic-mainnet-genesis-20260819T121551Z.json`, SHA-256 `1b7a2e22831d515ea3cbe7131c65c270306e55f1f8c3922b7558a355010af956` | Live stock-mainnet dual-lane genesis | Both purpose-created valueless lane genesis transactions mined with exact 40-port control state and stateless full-supply reserves; the issuer returned every remaining Minima atom and is retired | Genesis only; no successful covenant transition or decentralization evidence |
| `E-USDTM-024` | 2026-08-19 | `evidence/generic-p7-live-refutation-20260819T122914Z.json`, SHA-256 `955c29c05ca64f85917c81246413bda219c885d7313ac526d934b1711df1d125` | Live stock-mainnet refutation | The exact v1 five-signature release passed initial `txncheck`, then failed scripts and was dropped after height advanced; inputs remained unspent and five WOTS uses were consumed | Refutes P7 v1 mineability; the corrected v2 replacement is separately authorized by `D-USDTM-022` |
| `E-USDTM-025` | 2026-08-19 | `evidence/generic-p7-v2-hostile-rereview-20260819T124647Z.json`, SHA-256 `591b7748113f411df20df441b50ff8a69e8360231a25dcba2ee0aadfbd3ec75b` | V2 offline hostile rereview | No unresolved critical/high defect at the correction gate; all three posting-height guards are independently exercised, all prior attacks still reject, and failed WOTS uses persist across one normal restart | `phaseGatePassed:false`: no final fresh token IDs, v2 real UTXOs, node `txncheck`, mining, operator independence or rollback/restore WOTS proof |
| `E-USDTM-026` | 2026-08-19 | `evidence/generic-mainnet-v2-ceremony-preflight-20260819T131213Z.json`, SHA-256 `145ca6960281100abef555ca276fde1db214256c66854184f3203095ad94c3f9` | Live v2 issuer preflight below `E5` | Fresh encrypted issuer, pinned Core hash, synchronized mainnet state and all four exact token commands verified at the no-funds parser boundary with zero local mutation | No token, signature, transaction or chain write; funding and exact funding-input return-address pinning remain next |
| `E-USDTM-027` | 2026-08-19 | `evidence/generic-mainnet-v2-live-p7-20260819T143029Z.json`, SHA-256 `0f4829b83ffe15827fd60f24f85dae88f25621627349e2db8262c1969bb00675` | Live stock-mainnet dual-lane P7 gate | Fresh USDTm-v2 and ETHm-v2 releases each passed stock-node `txncheck` with five signatures and real MMR proofs, then mined with exact 41-port successor control, stateless reserve and payout, zero burn and exact six- and eighteen-decimal arithmetic | One-controller signer fixture and synthetic Ethereum facts do not prove decentralization or source authenticity. P8 owns the remaining branch set; WOTS backup rollback remains unproved |
| `E-USDTM-028` | 2026-08-19 | `evidence/generic-p8-v2-branch-coverage-20260819T150018Z.json`, SHA-256 `339c360f63f59c53d6ea8be098199c3007ca52f3b6a2d17f6a87d76195d247c7` | Exact immutable-v2 branch coverage | Confirms that both deployed scripts implement RELEASE only and cannot satisfy the P8 branch set | Read-only script evidence; it proves obstruction, not a replacement covenant |
| `E-USDTM-029` | 2026-08-19 | `evidence/generic-p8-record-validation-20260819T151018Z.json`, SHA-256 `ef7dee5c531a0f8ac37478ee87c8bd1dfd7702b6fd4cea9f19337d9ed64b5277`; `evidence/generic-p8-unified-smoke-20260819T160551Z.json`, SHA-256 `7d781f6255c0a4af6d379cf1fad563bb6d69125460c1f46afa1201868f97f803` | P8 canonical records and unified KISS execution | Two encoders agree across ten records and 346 field mutations. All five exact branches execute for both lanes with full synthetic TxPoW sizing and 80 freshly authorized hostile rejections, including undercollateralized authenticated-head attempts on every action. | Synthetic 32-level proofs and deterministic offline keys only; no current mainnet UTXO, node `txncheck`, mining or independent operator evidence |
| `E-USDTM-030` | 2026-08-19 | `evidence/generic-mainnet-p8-ceremony-preflight-20260819T160833Z.json`, SHA-256 `f3376f45e290f1a4ec610bf8a2fbd71f8c8d00e4c03cb9b524fa61269b7ed9f6` | Fresh P8 issuer preflight | Stock Core 1.1.2.6 was connected on mainnet with a clean zero balance; four exact no-funds token-create probes failed safely with unchanged token count and mempool. | No chain write succeeded; exact funding input and residual-return address are not yet present |

## 10. Execution journal

Append one entry for every work slice. Do not rewrite history. Corrections append a new entry that
names the superseded statement.

### 2026-08-19, slice 1: living control document

Scope:

- consolidate the founder's USDTm decisions;
- preserve existing research artifacts;
- create the phase board, findings log and evidence register;
- add a structural validator;
- re-run existing valueless validation rungs;
- request two hostile reviews.

Safety boundary:

- no Pool application or snapshot file;
- no version bump;
- no wallet or transaction command;
- no token or vault creation;
- no external message.

Observed result:

- the first structural run passed with 14 phases, one NOW phase, 14 binding decisions, 10 open
  founder decisions, 18 findings and six evidence records;
- the current RFC fixture encoded to 1005 bytes and passed 42 declared cases, including six valid
  accepts and 36 intended rejects;
- the current Minima RPC fixture validator rechecked 32 stored mainnet block responses and rejected
  seven deliberate corruptions;
- fresh evidence JSON files and SHA-256 sidecars were created inside `evidence/`;
- these results advance only the document, schema and RPC-fixture rungs;
- no proof, covenant, transaction, token, vault or funds action occurred.

Next action: hostile review of `P1`, this control document and the evidence claims. The default
verdict is refuted until both reviewers return no unresolved critical or high defect.

### 2026-08-19, slice 2: hostile-plan correction

Scope:

- reopen P0 because its earlier control evidence was stale and no scope artifact existed;
- add proof-safe deposit cancellation and refund requirements;
- replace the unsupported reserve coin-ID assertion with an explicit amount-equivalent admission
  rule and a blocking hostile test;
- separate native-verifier `NV` gates from the bridge phase board and remove private-network
  promotion;
- strengthen WOTS recovery, manifest provenance and mainnet-only evidence requirements.

Observed result at document-freeze time:

- no prior evidence was deleted or represented as current;
- the schema and stored RPC fixture evidence remain at their stated low rungs;
- no bridge proof, covenant, transaction, token, vault or funds action occurred;
- fresh matching control and scope evidence plus a manifest bound to the current document, validators,
  repository HEAD and protected tree close P0;
- P1 remains open because `F-USDTM-019` and `F-USDTM-020` are unresolved high findings.

### 2026-08-19, slice 3: P1 cancellation and reserve candidate

Scope:

- define separate Ethereum record and Minima nullifier state machines;
- bind cancellation authority to the complete semantic deposit and deployment domain;
- define atomic one-time capacity restoration on proof-gated refund;
- define exact reserve input admission, amount-equivalent substitution and stranded surplus;
- implement a chain-independent property and mutation model.

Observed result before hostile review:

- `validate-usdtm-p1-model.mjs` passed 48 assertions across 363 release, cancellation and refund
  action sequences;
- all 22 semantic cancellation fields were changed one at a time and the model signature rejected
  every change;
- 27 deliberate lifecycle, domain and reserve mutations were detected;
- canonical and equal-amount lookalike reserve inputs produced identical abstract `R`, `I`, `P` and
  control-version successors under the exact admission tuple;
- wrong-amount, extra-input, extra-output, short-successor, changed-payout, stale-control and
  undercollateralized shapes rejected in the abstract model;
- no evidence JSON was emitted yet because the source and hostile review have not stabilized;
- no EVM, KISS, light client, ZK proof, transaction, token, vault or mainnet runtime executed.

Current result: P1 remains `NOW`. Both original HIGH findings have candidate containment, not a
passed gate. Two independent reviewers are next and are instructed to refute the package.

### 2026-08-19, slice 4: first P1 hostile review round refuted

Two independent reviewers were instructed to refute and default to refuted. Both returned unresolved
HIGH findings, and one also returned a CRITICAL cross-chain counterexample.

Findings recorded without promotion:

- a late heavier Minima fork can replace a refunded `CANCELLED` branch with `RELEASED`; the state
  machine is conditionally safe under settlement finality, not absolutely safe across histories;
- `A = R` required a zero reserve successor and contradicted the reserve-exhaustion rejection;
- advancing control without reserve made clean reserve recovery non-constructive after cancellation;
- the first local model overclaimed because it shared chain state and did not model proof lag,
  multi-record capacity, callbacks, real UTXO collections or recovery;
- P4 still described all four statuses as Ethereum record states and contradicted the split design;
- reentrancy needs at-most-once cross-entrypoint effects, not a claim that every callback reverts the
  outer transaction.

Result: P1 stayed `NOW`; no evidence JSON was emitted, no phase advanced and no funds-facing action
occurred. Corrections require a fresh hostile rereview.

### 2026-08-19, slice 5: P1 refutation corrections

Corrections applied:

- version 1 now keeps one positive reserve atom, requires `0 < A < R` and caps source capacity at
  `F - 1` destination atoms;
- every control transition now co-spends and recreates reserve at fixed sibling output 1, making the
  current control coin's creating transaction the constructive reserve anchor;
- P4 now gives Ethereum only `ABSENT -> PENDING -> REFUNDED`; `RELEASED` and `CANCELLED` remain
  separate terminal Minima nullifier states;
- refund and payout entrypoints require one shared reentrancy guard and at-most-once effects; a
  rejected nested callback need not revert a successful outer transfer;
- late heavier-fork double settlement is preserved as an explicit counterexample and conditional
  Minima settlement-finality assumption, with P5 measurement and `O-USDTM-008` production gates;
- the first shared-state model was replaced by a two-ledger abstract model with finalized proof
  snapshots, multi-record capacity, UTXO identities, fixed sibling lineage, donation pollution,
  return and redemption accounting, transfer rollback, nested callbacks, stale control and forks.

Observed local result before rereview:

- the stronger model passed 55 assertions across all six release, cancellation and refund
  permutations and 21 accepted deposits across its independent scenarios;
- it changed all 22 semantic cancellation fields and rejected every changed signature domain;
- all 27 deliberate field and state mutations were detected;
- it rejected source capacity above `F - 1`, `A = R`, wrong reserve amount, extra inputs or outputs,
  a short successor, stale control, refund replay, redemption replay and an unsettled noncanonical
  cancellation proof;
- its in-memory lineage selected the current reserve sibling after cancellation, two client updates
  and 50 pollution coins; clean-node bundle and proof import remain P9/P12 evidence, and it preserved
  the late-fork refund-plus-release counterexample rather than calling it safe;
- no evidence JSON was emitted because hostile rereview is still required;
- no EVM, KISS, proof, transaction, token, vault, funds or mainnet runtime executed.

Current result: P1 remains `NOW`, with both original reviewers asked to refute the corrected package.

### 2026-08-19, slice 6: P1 rereview corrections

The first rereview found two remaining HIGH defects in the model. The second found no CRITICAL or
HIGH, plus four MEDIUM and one LOW containment or precision issue.

Corrections applied:

- the actual `cancel()` transition now compares every proof-bound record field, checks the committed
  authority key, recomputes the semantic digest and verifies the actual signature;
- all 22 field mutations now pass through `cancel()` itself, and a different authority key rejects;
- source capacity restoration for redemption now requires a Minima `RETURN` record, settled
  canonical proof, exact amount and recipient, atomic successful transfer and one-time consumption;
- refund and redemption payout now share one lock, with both cross-entrypoint callback directions
  exercised;
- the amount-equivalent substitution test now completes the full cycle: donation substituted,
  `R` falls, a return restores the displaced amount, the displaced coin substitutes under the new
  control state, a stale sibling loses and the newest output-1 sibling remains the lineage anchor;
- unknown actions reject, outbound return has one exact three-input/two-output shape, and recovery is
  labelled in-memory lineage rather than clean-node evidence.

Observed local result before final rereview:

- model v2 passed 86 assertions, all six action permutations and 47 accepted deposits across
  independent scenarios;
- all 27 recorded field and state mutations were detected, including all 22 cancellation fields;
- fake redemption proof, redemption replay, refund replay, different authority, cross-entrypoint
  callbacks, unknown action and stale substitution competitor rejected;
- no evidence JSON was emitted; no EVM, KISS, ZK proof, transaction, token, vault, funds or mainnet
  runtime executed.

Current result: P1 remains `NOW` pending the final clean verdict from both independent reviewers.

### 2026-08-19, slice 7: returned-input, atomicity and payout-acknowledgement corrections

The reserve-focused final rereview still refuted P1 with four HIGH executable-property gaps. The
cross-chain reviewer passed the semantic package but independently noted rejected-call mutation as a
non-blocking model limitation. P1 did not advance.

Corrections applied:

- outbound `RETURN` now consumes a concrete unspent returned-token input with exact coin ID, token
  ID, amount, user ownership and covenant requirement, and derives the redemption ID from that
  input plus destination, deployment, recipient and epoch;
- every `RETURN` guard is checked before control, reserve, returned coin or accounting state mutates;
- pending-proof validation is pure, and the accepted Ethereum version and `L` commit only after the
  complete release or cancellation transition succeeds;
- `PAYOUT_ACK` now authenticates a finalized contiguous Ethereum payout range, exact cumulative
  cursor and amount, current head, lower vault balance and full record list, then decreases `P` and
  advances the payout cursor atomically while preserving the reserve sibling;
- release cannot cross an unacknowledged payout. Both release-before-acknowledgement and
  acknowledgement-before-release paths execute, and stale losers rebuild;
- release and cancellation prevalidate every proof-bound collateral postcondition before mutation;
  cancellation explicitly combines a client update when its proof advances the authenticated head;
- pending proofs require the exact authenticated Ethereum version, and proof-gated structural labels
  require a dispatcher-only capability rather than being independently callable;
- the redemption commitment now matches the specified fixed-width binary formula and a fixed golden
  vector;
- client update now has a proof-validating dispatcher; raw, nonzero, malformed, equal-head and stale
  update attempts reject without changing Minima state;
- rejected missing-input, wrong-token, wrong-amount, reused-input, recipient, redemption-ID, reserve
  and stale-payout cases compare the full Minima model state digest before and after rejection.

Observed local result before renewed hostile rereview:

- model v2 passed 140 assertions, all six cancellation race permutations and 63 accepted deposits;
- all 27 recorded mutations and all 22 cancellation-field changes were detected;
- the late-heavier-fork double-settlement counterexample remains preserved as a production blocker;
- no evidence JSON was emitted; no EVM, KISS, ZK proof, transaction, token, vault, funds or mainnet
  runtime executed.

Current result: P1 remains `NOW` until both independent reviewers return a clean verdict on the
corrected source.

### 2026-08-19, slice 8: P1 passed and P2 cancellation bytes started

Both independent hostile reviewers passed model SHA-256
`c9a43db992a8884d73f91795531659cf1c17a40f7e365dea4cdeb06847cdce9c` with no unresolved CRITICAL
or HIGH semantic/property defect. The final local run passed 140 assertions, six cancellation race
permutations, 63 accepted deposits, all 22 cancellation-field mutations and 27 of 27 deliberate
mutations. P1 is `GATE PASSED` at the explicitly local semantic evidence rung.

P2 is now `NOW`. Its first bounded slice freezes a 512-byte cancellation authorization record with
exact action and state enums, both chain and deployment domains, amounts, recipients, authority,
epoch and proof-verifier domain. A layout-driven encoder and a separately written concatenation
encoder agree on the fixed commitment
`b52171ece1092767811a99d301785f9097967b2327bf91ac4c663507d2650736`; all 27 field mutations change
that commitment and four wrong action/state variants fail the golden domain.

P2 remains open. Deposit, redemption, cumulative payout-batch and Ethereum client-state records do
not yet have two-encoder golden fixtures or exhaustive mutations. Authority scheme 1 is a schema
value only; no Minima signature runtime, ZK proof, KISS covenant, transaction, token, vault, funds or
mainnet action executed.

### 2026-08-19, slice 9: P2 and P3 closed locally, P4 started

P2 completed the five record families left open by slice 8. Two independently written encoders agree
on deposit, refund, redemption, cumulative payout-batch and Ethereum client-state bytes. The local
validator passed 191 assertions, all 136 one-field mutations and 19 semantic negatives. Combined
with the 27-field cancellation record, P2 freezes 163 security-bound fields across six records.

P3 implements immutable successor commits, exact capacity and collateral accounting, out-of-order
tagged nullifiers, same-block deposit and payout batches, crash/retry behavior and a depth-256 tagged
sparse SHA2-256 nullifier root. The local run passed 1,177 assertions across 8,192 deterministic fuzz
attempts, committed 6,144 transitions, checked 1,878 rejected actions and caught 10 of 10 deliberate
invariant mutations.

P4 is now `NOW`. Solidity source exists for a six-decimal valueless mock token, mock proof interface
and vault. A separate semantic model passed 35 source and behavior assertions, including measured
fee-on-transfer receipt, capacity floor, failed-transfer rollback, replay and shared-lock callbacks.
This is a partial result with `phaseGatePassed:false`: the machine has no installed Solidity compiler
or Foundry toolchain, and deployment is not authorized. No bytecode or EVM behavior executed.

### 2026-08-19, slice 10: pinned Solidity toolchain and local P4 EVM execution

The former missing-toolchain statement above is superseded. A project-local, lockfile-pinned
Hardhat 3.13.0 toolchain now compiles the three contracts with exact Solidity
`0.8.24+commit.e11b9ed9`, Shanghai EVM target and optimizer runs 200. Eleven Mocha tests execute the
compiled bytecode locally and pass measured fee receipt, ERC-20 false, revert and no-return cases,
capacity rollback, exact cancellation and redemption proof rejection, replay, failed-transfer
rollback and both refund-to-redemption and redemption-to-refund callback attempts. The dependency
audit has zero critical, high or moderate findings and 11 recorded low transitive findings.

P4 remains `NOW` with `phaseGatePassed:false`. The tests use ephemeral local EVM deployments, but no
persistent public-network Ethereum deployment is authorized. The mock verifier remains an interface
fixture only. No public network, wallet, signature, transaction post, token creation, persistent
vault deployment, funds or mainnet action occurred.

### 2026-08-19, slice 11: issuer decision, P4 payout correction and pinned Core inspection

The founder selected a fresh one-use `USDTmIssuer` node wallet for the later valueless token
ceremony. This records the wallet topology only and authorizes no node creation, seed, address,
token, signature or transaction.

A P4 reread against the P2 payout-batch schema found that the first vault stored a cumulative paid
amount but no persistent sequential payout records. It also trusted the verifier tuple without an
explicit returned runtime identity. The corrected vault appends every payout record before external
transfer, with EVM rollback on failure, and rejects cancellation or redemption results for another
runtime. The source model now passes 40 checks. The pinned local suite passes 12 tests and compares
the ephemeral deployed runtime byte-for-byte with the compiler artifact after masking only declared
immutable ranges. P4 remains `NOW` solely for the independent hostile review required by Bay law 14.

For the time-saving P7 branch, the current official Minima Core repository was shallow-cloned at
commit `52542f25605a28a776e9b3b43b0808a05dceab01` and inspected read-only. No native ZK verifier or
generic proof witness exists in the inspected source. The current extension points and hard limits
confirm that the previously proposed native-verifier path requires a consensus Core change. The
founder then selected a stock-Core-only path with no Minima-team dependency. The concise GitHub issue
in `minima-core-contact-draft-2026-08-19.md` is therefore retained as research history and must not
be posted. P7 now admits only a verifier that runs with already-shipped mainnet primitives and
limits. A locally modified Core would be a different network and cannot pass this gate.

This decision deliberately does not relabel CHECKSIG attestations as proofs. A threshold signer set
could produce an autonomously operated bridge on stock Minima, but it could also authorize an event
that Ethereum consensus never finalized. Adoption therefore required a separate founder decision.

### 2026-08-19, slice 12: hybrid trust decision and threshold semantic gate

The founder selected the recommended hybrid research architecture in `D-USDTM-017`. The inbound
Ethereum-to-Minima direction now benchmarks a 5-of-7 exact-record threshold attestation using stock
KISS, while the outbound Minima-to-Ethereum direction retains the stateful proof-verification target.
The narrow stock-KISS proof-verifier search continues as a non-blocking research lane.

The first semantic package is `usdtm-p7-threshold-attestation-v1.md` and
`validate-usdtm-p7-threshold.mjs`. It distinguishes covenant-enforced safety from attestor honesty,
preserves a deliberate colluding-quorum counterexample and does not claim that locally generated
logical keys are independent operators. P7 remains open until the actual TreeKey/WOTS signatures,
script proof and complete signed transaction are measured and mined with valueless assets under a
separately authorized ceremony.

The next offline rung compiled `p7/TreeKeySignatureBenchmark.java` against the official pinned jar.
Five default TreeKey signatures verified and serialized to 20,625 bytes total. This removes an early
size refutation but leaves 44,911 bytes for every other TxPoW field, so it does not close P7.

### 2026-08-19, slice 13: generic asset lanes and native ETH feasibility

The founder directed that the bridge become asset-generic and prioritized checking native ETH.
Decision `D-USDTM-018` makes each asset an isolated lane and keeps USDTm only as one ERC-20 instance.
The first native fixture uses provisional name `ETHm`, exact 18-decimal wei parity and a valueless
10 ETH-equivalent cap below the single-limb `2^64` bound.

`bridge-asset-lanes-v1.md` specifies per-lane identity, vault, reserve lineage, nullifier and cap.
`validate-bridge-asset-lanes.mjs` passes the first semantic and pinned-source gate. It also records
the two open runtime blockers: standard token creation normally caps decimals at 16 unless
`uselimits:false`, and no native ETH Solidity lane or exact-wei KISS transaction has executed.

The native Ethereum vault lane was then implemented locally. The combined pinned suite now passes
22 real-bytecode tests across ERC-20 and native ETH, including forced-balance exclusion, exact
`msg.value`, failed-call rollback and both native callback directions. The remaining ETH runtime
blocker is now the 18-decimal Minima and KISS side, not basic Ethereum custody bytecode.

### 2026-08-19, slice 14: generic record and complete offline P7 transaction

The 31-field generic attestation record is frozen at 444 bytes in
`generic-attestation-schema-v1.md`. Independent encoders agree for the six-decimal ERC-20 and
18-decimal native-ETH fixtures, and all 62 one-field mutations change the SHA3 digest.

The exact stock-Core benchmark selected transaction-bound `MULTISIG` for this rung. Five throwaway
TreeKey/WOTS signatures cover the complete transaction ID, keeping the 20,625 signature bytes in the
witness instead of successor coin state. Against the pinned official jar, both complete synthetic
TxPoWs execute. ERC-20 uses 31,886 bytes and ETH uses at most 32,054 bytes; advancing-head, equal-head and
reserve branches use 539, 553 and 148 instructions. The transactions include state, outputs, script
proof and two 32-level coin proofs. Release cannot move payout acknowledgement counters. A second
deposit may reuse an exact accepted Ethereum snapshot only within 100 Minima blocks. Sixty-three
hostile checks per lane cover all signed record fields, stale signatures, exact output shape,
snapshot drift, quorum, state, cross-lane and reserve-floor mutations. All 14 structural mutations
and all six state-port 19 through 24 mutations carry five fresh valid signatures.

The exact design also corrected an earlier overclaim. It does not prove arbitrary historical deposit
non-membership in stock KISS. The spent control coin prevents replay of one signed transaction, while
honest operators maintain the historical lane journal. The founder accepted that inside the
conditional threshold assumption in `D-USDTM-020`. The later live ceremony result is recorded in
slice 16 and `F-USDTM-061`.

### 2026-08-19, slice 15: replay acceptance and dual-lane mainnet preflight

The founder accepted `O-USDTM-016` in `D-USDTM-020` and authorized one fresh `USDTmIssuer` for both
valueless USDTm and ETHm mainnet tests in `D-USDTM-021`. A first attempted launch was immediately
discarded before address generation after its copied jar reported the wrong Core version. The node
was recreated from the previously proven 1.1.2.6 ceremony jar, with a new encrypted wallet database,
and connected to the local mainnet node. No copy of its password or seed was written to evidence.

The live 1.1.2.6 bytecode confirmed a constraint hidden by the earlier synthetic fixture:
`tokencreate` floors the token count before applying decimals. The one-atom supply margins were
therefore not command-native. The corrected ceremony and rerun offline model use 1,000,001 USDTm at
six decimals with cap 999,999.999999, and 11 ETHm at eighteen decimals with cap 10. Both offline
validators passed again; the worst native candidate is 32,054 bytes and remains below the hard limit.

The exact token commands were then executed against the synced but unfunded issuer as parsing
preflights. Both stopped at `No Minima Coins available!`; known token count stayed three and mempool
stayed zero. `generic-mainnet-ceremony.mjs` now preserves the pinned public facts and refuses any mint
without explicit `--post`, a synced 1.1.2.6 node, sendable Minima and a pinned funding return address.
At this slice boundary the only active founder node had zero sendable Minima, so no mint, signature,
`txncheck`, post or mined transaction had occurred. Slice 16 records the later authorized execution.

### 2026-08-19, slice 16: dual-lane mainnet genesis and issuer retirement

The issuer received one identified 0.1 Minima input, and the founder pinned that exact input address
as the sole return destination. Stock Core 1.1.2.6 mined purpose-created valueless USDTm, ETHm and
one-unit lane-control tokens. No real collateral was accepted. The USDTm lane genesis transaction
`0x932C3BF9C64DA28CDA1AEFE7FD46B53341C0A6821A26D46FF312353394374A10`
mined at block 2269336; the ETHm lane genesis transaction
`0xBA9526432A4D89D533EB08B21E368C8A11AF290773A5C1FC91043F229758D7EE`
mined at block 2269338.

Each exact transaction co-spent its unique control token and full bridge-token supply, created one
stateful control coin and one stateless reserve coin at the lane covenant, burned nothing, and passed
node amount, signature, MMR and script checks before posting. The mined control coins reproduce all
40 values in `mainnet-lanes.json`; the reserve coins retain exactly 1,000,001 USDTm and 11 ETHm.
The independent signer-fixture node sees all four covenant coins.

The issuer then returned its entire remaining Minima balance,
`0.09999999999999999999999988999998999998999998`, to the pinned original funding-input address in
transaction `0x3F72F5F4AD56A02B70F23FA1A61CF732F7825E892005ED08216886637E2D60C5`,
mined at block 2269339 with zero burn. It now has no nonzero balance entry and no sendable coin and is
retired `NEVER-REUSE`. The next P7 gate is a real five-signature covenant spend; because all seven
test keys share one fixture controller, success will prove stock-mainnet mechanics but not operator
independence or P6 decentralization.

### 2026-08-19, slice 17: live P7 refutation and bounded-height v2

The first real USDTm release co-spent the mined v1 control and reserve candidates, paid one
destination atom to a fresh test recipient and carried five current TreeKey witnesses. At mainnet
height 2269351, `txncheck` reported valid amounts, all five signatures, MMR proofs and both scripts.
The exact transaction was posted without automatic mutation. When the chain advanced before
inclusion, a repeat check reported only `scripts:false`; the transaction disappeared from the
mempool, both inputs remained unspent, and none of its three predicted outputs existed. The first
five fixture keys each report one consumed WOTS use. The signed attempt remains loaded and journaled;
it must never be rebuilt with the old signatures.

The root cause is the deployed advancing-head assertion `STATE(17) == @BLOCK`. A transaction can
satisfy it at local admission yet cannot rely on the same height at block inclusion. Candidate v2
replaces equality with monotonic bounded construction height: port 17 must not decrease, must not be
in the future, and may trail `@BLOCK` by no more than port 18. Template USDTm and ETHm v2 scripts
parse on stock Core to provisional addresses `0xCD1F...2E8E` and `0x5BE4...A8AF`. Those previews
still bind the trapped v1 token IDs. A replacement ceremony will create fresh token and control IDs,
so it must regenerate the lane IDs, scripts and addresses; these preview addresses must not be funded.

The corrected offline harness passes 68 assertions and 65 hostile checks per lane. Freshly signed
future-height and over-lag mutations reject; maximum size is 32,134 bytes and maximum execution is
553 instructions. This is not a phase pass. The immutable v1 coins cannot move to v2 without
satisfying v1, and the v2 addresses have no coins. Independent hostile rereview and a new explicit
founder authorization are required before any replacement token or genesis transaction.

### 2026-08-19, slice 18: v2 hostile rereview pass

The rereview found that the first over-lag mutation was not independent: it also moved port 17 below
the prior accepted height, so monotonic rejection could hide a broken posting-lag check. The harness
now varies prior and successor state separately. It accepts lag zero, lag one, the exact monotonic
boundary and the exact 100-block posting-lag boundary. It rejects future height, rollback and
101-block lag independently with fresh transaction signatures.

The complete two-lane rerun now passes 70 assertions and 66 hostile checks per lane. All earlier
record-field, stale-signature, quorum, output-shape, preserved-state, counter, reserve-floor,
equal-head and source-time attacks still reject. A graceful restart of `BridgeTestSigners` preserved
key uses `[1,1,1,1,1,0,0]` and the failed signed transaction intent exactly; the node was stopped
again without signing or posting.

No unresolved critical or high defect remains at the offline v2 correction gate. The pass does not
promote P7: the preview scripts still bind trapped v1 token IDs, no v2 UTXO exists, seven keys remain
one controller, and backup-restore/database-rollback WOTS safety is unproved.

### 2026-08-19, slice 19: replacement v2 ceremony authorized

The founder accepted `O-USDTM-017` in `D-USDTM-022`. The authorization creates a fresh encrypted,
one-use `USDTmIssuerV2` wallet for fresh valueless `USDTm-v2`, `ETHm-v2` and control token IDs. The
first issuer remains retired and must never be reused. Final v2 lane IDs, scripts and addresses must
be regenerated from the actually mined token IDs. Every residual Minima atom must return to the
exact funding-input address before the new issuer is emptied and permanently retired. This does not
authorize real collateral or production.

### 2026-08-19, slice 20: dual-lane live v2 P7 pass and issuer retirement

The founder sent one 0.1 Minima funding coin to the fresh `USDTmIssuerV2`. Its sole input address was
pinned as the only residual-return destination. Stock Core 1.1.2.6 mined fresh valueless USDTm-v2,
ETHm-v2 and one-unit control tokens, after which the final lane IDs, scripts and covenant addresses
were regenerated from those actual token IDs. Exact USDTm-v2 and ETHm-v2 genesis transactions mined
at blocks 2269492 and 2269496 with 40-port control coins, stateless full-supply reserves and zero
burn.

The first signed USDTm-v2 release intent passed signatures, MMR proofs, amounts and exact outputs but
failed the KISS rolling-nullifier assertion before posting. The builder had hashed the prior root,
deposit ID and source-record hash, while the deployed covenant hashes the prior root, lane ID and
deposit ID. The exact failed transaction and five consumed TreeKey uses were preserved. A live KISS
golden vector now guards the correct fields, and retries use new transaction IDs and fresh WOTS
leaves.

USDTm-v2 retry transaction `0xF50BD0998288AFC9B29693C3FD20E87BA1CD23071F021B430589EFEF544056C1`
passed complete `txncheck` and mined at block 2269510. ETHm-v2 transaction
`0x679CF5E1B0617C751C0807CF41C95AAB0FC3726A47530D76BF050C033CFC97B5`
passed the same gate and mined at block 2269511. Each persisted the exact 40 successor control fields
plus the exact 444-byte attestation in port 90, recreated the stateless reserve, paid exactly 1.25
valueless lane tokens, conserved both token IDs and burned zero. Serialized sizes were 31,201 and
31,224 bytes. The first five TreeKeys now report uses `[4,4,4,4,4]`; the remaining two remain
`[0,0]`.

The issuer returned its complete residual Minima balance,
`0.09999999999999999999999988999998999998999998`, to the exact pinned funding-input address in
transaction `0x7D9D9B1CD3A683D91BB68263FD4E92A3CDE887118CEECA3EEFA8A1356EF24CF8`,
mined at block 2269514 with zero burn. The issuer then reported zero confirmed, unconfirmed and
sendable Minima, shut down cleanly and was marked `NEVER-REUSE`.

P7 is gate-passed at the live stock-mainnet mineability rung. P8 is now active. This result does not
prove operator decentralization, Ethereum-source authenticity, rollback-safe WOTS recovery or any
non-release covenant branch, and it authorizes no real collateral or production deployment.

### Slice 22: immutable-v2 obstruction and P8 unified offline candidate

Read-only coverage of the mined v2 scripts confirmed that both addresses are RELEASE-only. Their
exact two-input, three-output rule and lack of an action, MAST, migration or upgrade dispatcher make
the remaining P8 actions impossible on those immutable coins. This is a fresh-generation requirement,
not a failure of the passing P7 release evidence.

P8 now has action-specific canonical records for CLIENT_UPDATE, RELEASE, RETURN, CANCEL and
PAYOUT_ACK. Two independent encoders agree across both lanes. The pinned Core harness executes all
ten action/lane combinations through one covenant address per lane, including the third input owner
signature for RETURN and the additional cancellation-authority signature for CANCEL. Each execution
rejects eight hostile cases with fresh valid transaction signatures, including a proof-bound zero
vault balance that would violate outstanding liability. Full synthetic TxPoWs use 32-level coin
proofs, remain below 43 KiB, and the largest control path uses 596 instructions.

This passes the P8 offline construction rung but not the binding P8 phase gate. No node wallet or
mainnet command ran in this slice. A fresh purpose-created valueless generation, real coin proofs,
node `txncheck` and all-branch mining require a new explicit authorization because the prior v2
issuer is empty, stopped and `NEVER-REUSE`.

### Slice 23: P8 authorization, collateral hardening and clean issuer preflight

The founder authorized the fresh all-branch valueless ceremony in `D-USDTM-023`. Before any mainnet
write, the unified KISS template was strengthened so CLIENT_UPDATE and PAYOUT_ACK cannot authenticate
a vault balance below `I + P`; all accounting branches now retain the lane cap. A freshly signed
zero-vault mutation rejects on all ten lane/action executions. The repeated offline suite passes
164 assertions and 80 hostile cases, with full synthetic TxPoWs still below the protocol size and
instruction ceilings.

A new encrypted one-use node named `USDTmIssuerP8` was created on stock Core 1.1.2.6 at ports 9901
and 9905. It synchronized on mainnet with zero confirmed, sendable and unconfirmed Minima. Each of
the four frozen P8 token commands then stopped at the expected no-funds gate; token count and
mempool were unchanged. No token, signature or transaction was created. The exact issuer funding
address is now published for the small ceremony funding transfer, after which the mined funding
input address must be pinned as the only residual-return destination.

## 11. Supporting specifications

This control document does not duplicate every byte table or covenant port. The following files are
the detailed supporting artifacts, with their evidence level kept explicit:

- `bridge-public-inputs-v1.md`: canonical research schema, no deployed verifier;
- `reserve-covenant-transition-spec-v1.md`: design only, with inbound release revised for threshold
  authentication and remaining inbound branches still to harmonize;
- `adversarial-verification-plan.md`: required attack plan;
- `usdtm-p1-threat-model.md`: P1 assets, state machines, reserve admission and race analysis;
- `validate-usdtm-p1-model.mjs`: local abstract property and mutation model, below runtime evidence;
- `usdtm-p7-threshold-attestation-v1.md`: exact-record 5-of-7 semantic protocol and conditional
  trust boundary;
- `validate-usdtm-p7-threshold.mjs`: local threshold transition, mutation and collusion model;
- `bridge-asset-lanes-v1.md` and `validate-bridge-asset-lanes.mjs`: generic lane isolation, native
  ETH custody semantics, exact-wei bounds and pinned Core decimal assertions;
- `generic-attestation-schema-v1.md`, its two encoders and validator: exact 444-byte generic lane
  record and every-field mutation gate;
- `generic-p8-record-schema-v2.md`, its two encoders and validator: five exact action records with
  no unchecked padding;
- `p8/GenericP8UnifiedSmoke.java` and `validate-generic-p8-unified-smoke.mjs`: unified five-action
  KISS execution, hostile mutations and complete synthetic TxPoW sizing against pinned Core;
- `p7/GenericLaneTxPowBenchmark.java` and `validate-generic-lane-txpow.mjs`: complete offline
  synthetic TxPoW serialization and KISS execution against pinned Core;
- `p7/TreeKeySignatureBenchmark.java` and `validate-minima-treekey-signatures.mjs`: offline pinned
  official-Core signature verification and serialization-size rung;
- `minima-core-zk-verifier-rfc-2026-08-18.md`: Core-facing native-verifier RFC draft;
- `minima-core-native-verifier-proposal-2026-08-18.md`: concise unsent proposal;
- `proof-system-selection-matrix.md`: candidates and benchmark gates;
- `minima-consensus-fixture-spec-v1.md`: first fixture rung;
- `feasibility-findings-2026-08-18.md`: executed first-candidate findings;
- `validate-usdtm-control.mjs`: structural and evidence-reference validator for this document;
- `validate-usdtm-scope.mjs`: read-only final-state check for protected Pool application files;
- `research-manifest.json`: artifact hashes;
- sibling `zk-light-client-bridge-research-plan-2026-08-18.md`: broader research rationale.

If a supporting file conflicts with a founder decision here, stop and update the conflict openly.
If an exact encoding conflicts with this summary, inspect both and resolve the discrepancy before
executing either.

## 12. Stop conditions

Stop promotion immediately if any of the following remains true:

- Minima consensus cannot execute the selected inbound attestation or any promoted proof verifier
  deterministically within bounded resources;
- the Minima side requires a Core fork, new opcode, changed consensus limit or Minima-team commitment;
- a relayer, validator, administrator or signer can redirect reserve funds;
- a proof can be replayed across messages, chains, deployments, directions, versions or epochs;
- an authenticated source record can be skipped and stranded permanently;
- an accepted Ethereum deposit lacks a proof-safe cancellation and refund route, subject to the
  explicitly disclosed permanent-source-failure limitation;
- reserve conservation or `I + P <= L` can be bypassed;
- a source record, nullifier, reserve coin or accounting update can cross asset lanes;
- forced ETH or unsolicited ERC-20 balance can be counted as attributable backing;
- an 18-decimal ETH lane is created before exact token, wallet, KISS and transaction compatibility
  is demonstrated with purpose-created valueless assets;
- one committee's slashable bond is counted separately against multiple lane caps instead of
  aggregate exposure;
- a stale Ethereum head can authorize issuance indefinitely;
- a valid Minima branch can be presented without the required canonicality and work policy;
- one malformed message can halt every later message without a proof-safe resolution;
- token or vault code changes can invalidate proved balance semantics without halting issuance;
- worst-case proof and fully signed transaction mineability is not demonstrated;
- any production description implies Tether or USDT0 endorsement that does not exist;
- an attestation federation is described as a native-proof or trustless bridge;
- any real value is requested before the law-10 and law-14 attack gates pass.

The way forward from a stopped gate is always the named missing proof, protocol capability, founder
decision or design correction. A stop never authorizes a weaker trust model silently.
