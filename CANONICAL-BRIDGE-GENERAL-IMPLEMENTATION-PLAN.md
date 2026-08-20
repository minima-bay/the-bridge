# Canonical bridge general implementation plan

Document purpose: one readable map from the original problem through research, decisions,
implementation, evidence, remaining work and a possible production decision.

Status date: 2026-08-20

Current programme status: active research, valueless only

Canonical project: The Bridge, a standalone Bay-level project at `minima-bay/the-bridge`

Current gate: `P9`, recovery-safe Minima transaction construction and WOTS signing authority

Production status: prohibited

## 1. Authority and how to use this plan

This document is the general navigation and implementation plan. It does not replace the project's
authoritative logs or exact technical specifications.

When two documents appear to disagree, use this order:

1. Minima consensus and executed chain evidence.
2. Founder decisions in [USDTM-ZK-PROTOTYPE.md](USDTM-ZK-PROTOTYPE.md).
3. The phase board, findings and evidence register in that control document.
4. Exact component specifications and canonical byte schemas.
5. This general plan and other explanatory material.

Read the documents in this order:

1. This plan for the full map.
2. [USDTM-ZK-PROTOTYPE.md](USDTM-ZK-PROTOTYPE.md) for authoritative status, decisions, findings,
   phases, evidence and the chronological journal.
3. [canonical-bridge-attestor-framework-discussion-v1.md](canonical-bridge-attestor-framework-discussion-v1.md)
   for the product, trust, attestor, economic and public-disclosure explanation.
4. [P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md](P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md)
   for the detailed Ethereum attestor contract design.
5. [P9-COMPLETION-SPEC.md](P9-COMPLETION-SPEC.md) and [P9-WOTS-GUARD.md](P9-WOTS-GUARD.md)
   for the current signer-safety blocker.
6. [evidence/README.md](evidence/README.md) before treating any JSON artifact as current evidence.

The raw evidence files are audit records. They are not the recommended introduction to the project.

## 2. Preamble: problem, goal and boundaries

### 2.1 The problem

The goal is to move value between Ethereum and Minima while preserving a canonical 1:1
representation for each supported asset. The two chains cannot natively inspect each other's
consensus. A safe bridge therefore needs explicit answers to five questions:

1. Where is the backing principal held?
2. What proves that an event happened on the source chain?
3. What prevents replay, over-issuance, cross-asset mixing and unauthorized outputs?
4. Who can act, what can they change, and how are dishonest or unavailable actors handled?
5. How can users recover when messages, relayers, nodes or operators fail?

### 2.2 Selected research architecture

The selected design is a hybrid canonical bridge with isolated asset lanes:

```text
Ethereum deposit
  -> immutable per-asset vault record
  -> independently checked 5-of-7 benchmark attestation
  -> exact Minima covenant transition
  -> release from that lane's fixed Minima reserve

Minima return
  -> exact reserve-return transition
  -> stateful Minima consensus proof
  -> Ethereum verifier
  -> payout from that lane's Ethereum vault
```

Ethereum-to-Minima is threshold-attested because a complete Ethereum verifier has not been proved
mineable under stock Minima KISS limits. Minima-to-Ethereum remains proof-verified by Ethereum. The
two directions have different trust assumptions and must never be presented as equivalent.

The design rationale and rejected alternatives are explained in
[the attestor framework, sections 1, 16 and 17](canonical-bridge-attestor-framework-discussion-v1.md).

### 2.3 What canonical 1:1 means

For each isolated lane `x`:

```text
F[x] = fixed Minima token supply
R[x] = tokens in the canonical Minima reserve
I[x] = issued-not-returned liability = F[x] - R[x]
P[x] = returned tokens awaiting Ethereum payout acknowledgement
L[x] = finalized attributable Ethereum backing

R[x] + I[x] = F[x]
I[x] + P[x] <= L[x]
```

User principal is never fee revenue, attestor stake, insurance capital or an operating budget.
Each lane has separate vault custody, token identity, control and reserve lineage, nullifier domain,
accounting, cap and evidence.

Authoritative accounting transitions are in
[USDTM-ZK-PROTOTYPE.md, section 2](USDTM-ZK-PROTOTYPE.md) and the exact Minima transition rules are
in [reserve-covenant-transition-spec-v1.md](reserve-covenant-transition-spec-v1.md).

### 2.4 Current authorization boundary

Authorized now:

- offline source code, specifications, local tests, hostile models and evidence;
- continued P9, Ethereum contract, accountability, proof, integration and interface research under
  `D-USDTM-025`.

Not authorized now:

- a node startup or restored-node clone run;
- a fresh Minima key domain or signature;
- a Minima or Ethereum transaction;
- a new token or public deployment;
- a real bond, real collateral, real bridge fee or production operator appointment;
- any production launch.

The P8 fixture TreeKey domain is permanently retired under `D-USDTM-024`.

## 3. System map

### 3.1 Ethereum onchain components

| Component | Responsibility | Current implementation | Remaining production work |
|---|---|---|---|
| Per-asset vault | Hold principal, record deposits, refunds and payouts | `p4/contracts/USDTmVaultV1.sol`, `p4/contracts/NativeAssetVaultV1.sol` | Independent hostile review, real Minima proof adapter, P6 integration, governance decisions |
| Committee registry | Commit ordered roster, quorum, policy and component addresses | `p6/contracts/AttestorRosterRegistryV1.sol` | Real candidates, rotation, retirement and independent-control evidence |
| Bond vault | Hold equal self-bonds and voluntary delegated security | `p6/contracts/AttestorBondVaultV1.sol` | Slashing, asynchronous exit, post-slash accounting and real asset policy |
| Exposure controller | Share one liability cap across lanes | `p6/contracts/AttestorExposureControllerV1.sol` | P4 adapter integration, runway enforcement and production valuation |
| Fee treasury | Keep fees separate from principal and split accounting buckets | `p6/contracts/AttestorFeeRewardTreasuryV1.sol` | P4 routing, claims, forfeiture and production parameters |
| Bond-risk index | Allocate capital-at-risk reward to self-bond and selected depositors | `p6/contracts/AttestorEpochRewardIndexV1.sol` | Post-slash balances, claims and withdrawals |
| Work recorder | Record readiness and neutral approve-or-reject participation | `p6/contracts/AttestorWorkEpochV1.sol` | Canonical request adapter and production fact source |
| Objective verifier | Prove exact-domain equivocation or contradiction with finalized fact | `p6/contracts/ObjectiveDecisionVerifierV1.sol` | Production source-chain verifier and Minima signer attribution |
| Work-reward index | Consume finalized readiness and participation weights | `p6/contracts/AttestorWorkRewardIndexV1.sol` | Forfeiture and safe claims |
| Fault adjudicator | Decide exact slash programmes | Specification only | Implement after objective cross-chain attribution is solved |
| Claim distributor | Release matured rewards and valid loss claims | Specification only | Implement only after challenges, forfeiture and slash ordering are complete |
| Minima light client | Verify Minima consensus for reverse payouts and cancellation refunds | Research fixtures only | Complete P5 stateful verifier and Ethereum gas evidence |

### 3.2 Minima onchain components

| Component | Responsibility | Current implementation | Remaining production work |
|---|---|---|---|
| Lane control coin | Unique state lineage and action dispatcher | P8 unified covenant, mined with valueless assets | Fresh production generation only after all gates and authorization |
| Lane reserve coin | Hold the pre-created representation inventory | Fixed sibling output 1 in P8 | Production token parameters and recovery bundle |
| Five-action covenant | Enforce `CLIENT_UPDATE`, `RELEASE`, `CANCEL`, `RETURN`, `PAYOUT_ACK` | All ten lane/action cases mined on stock mainnet | Production facts, independent signers and P9-safe constructor |
| Threshold witness | Authorize inbound source facts | Five fixture TreeKey signatures | Independent operators, signer identity binding and safe WOTS authority |
| Exact records and state | Bind lane, action, amounts, recipients, epochs and accounting | `generic-p8-record-schema-v2.md` and independent encoders | Freeze production versions and connect real chain facts |

Technical P7/P8 sources include `p7/GenericLaneTxPowBenchmark.java`,
`p8/GenericP8UnifiedSmoke.java`, `generic-p8-records-primary.mjs`,
`generic-p8-records-independent.mjs`, `render-mainnet-p8-lanes.mjs` and their validators.

### 3.3 Offchain components

| Component | Responsibility | Safety role |
|---|---|---|
| Attestor installation | Independently reconstruct and verify source facts, then sign or refuse | Trusted within the stated threshold boundary |
| Signing authority | Fence a seed domain, reserve WOTS leaves and conditionally sign an exact body | Critical P9 safety component, not yet real |
| Relayer/coordinator | Assemble requests, signatures, transactions and proofs | Permissionless courier, no validity authority |
| Prover | Produce Minima consensus proof for Ethereum | Permissionless, proof checked onchain |
| Watcher/challenger | Detect objective contradictions, equivocation and accounting faults | Liveness and enforcement, not a primary validity oracle |
| Evidence store | Publish policies, decisions, audits and incidents | Transparency; chain state and verified signatures remain authoritative |
| Diligence store | Protect confidential identity and infrastructure material | Admission support, never settlement authority |
| Monitoring and incident response | Observe lag, solvency, cap use and signer health | May pause new exposure under policy, cannot move principal |
| User interface/About page | Quote transfers and explain risks, status and recovery | Must derive displayed facts and never become a validity gate |

Detailed responsibilities, candidate checks, mutual selection and decentralization limits are in
[canonical-bridge-attestor-framework-discussion-v1.md](canonical-bridge-attestor-framework-discussion-v1.md).

## 4. Binding decisions

The complete wording and consequences remain authoritative in
[USDTM-ZK-PROTOTYPE.md, section 3](USDTM-ZK-PROTOTYPE.md). This table is a navigation summary.

| Decision | Summary |
|---|---|
| `D-USDTM-001` | Create a new Minima representation named USDTm |
| `D-USDTM-002` | Exclude mxUSDT history, state and liabilities |
| `D-USDTM-003` | Use independent backing and prohibit Tether or USDT0 affiliation claims |
| `D-USDTM-004` | Preserve proof verification for the reverse direction; partly superseded inbound by `D017` |
| `D-USDTM-005` | Build a valueless prototype before any production activity |
| `D-USDTM-006` | Six decimals are a provisional USDTm research choice |
| `D-USDTM-007` | Relayers and provers are permissionless and non-custodial |
| `D-USDTM-008` | Keep the work classified as research until both directions pass |
| `D-USDTM-009` | Preserve the unsent Core proposal as history; superseded by `D016` |
| `D-USDTM-010` | Benchmark pairing and hash proof tracks without prematurely selecting one |
| `D-USDTM-011` | Begin consensus engineering with independent verifier fixtures |
| `D-USDTM-012` | Preserve the no-funds and isolated write boundary |
| `D-USDTM-013` | The control document is the living authoritative plan and log |
| `D-USDTM-014` | Any authorized Minima chain test uses purpose-created valueless mainnet assets |
| `D-USDTM-015` | Use a fresh, one-use, then retired issuer for an authorized ceremony |
| `D-USDTM-016` | Depend only on stock Minima mainnet, not a Core change, private fork or external contact |
| `D-USDTM-017` | Use threshold-attested inbound and proof-verified outbound hybrid architecture |
| `D-USDTM-018` | Isolated generic asset lanes; native ETH is the first additional feasibility lane |
| `D-USDTM-019` | Transaction-bound native multisig was the provisional benchmark signature form |
| `D-USDTM-020` | Historical deposit non-reuse is inside the quorum-honesty assumption and operator journals |
| `D-USDTM-021` | Authorize the consumed first valueless dual-lane mainnet ceremony |
| `D-USDTM-022` | Authorize the consumed corrected v2 ceremony |
| `D-USDTM-023` | Authorize the consumed P8 all-branch ceremony |
| `D-USDTM-024` | Retire all P8 fixture signing keys after the network-isolation refutation |
| `D-USDTM-025` | Authorize offline development only under the no-funds boundary |
| `D-USDTM-026` | Permit opt-in delegated security behind one attestor, separate from principal, with self-bond and asynchronous exit |
| `D-USDTM-027` | Rehome The Bridge as a standalone Bay-level peer project, preserve history, and leave only a pointer under The Pool |
| `D-USDTM-028` | Select a disabled two-provider P9 deployment candidate: Cloudflare Durable Object fence plus independent AWS DynamoDB/S3 Object Lock checkpoint |

No summary in this plan can silently supersede a numbered decision.

## 5. Open founder decisions

These are blocking choices, not implementation defaults. Full wording is in
[USDTM-ZK-PROTOTYPE.md, section 4](USDTM-ZK-PROTOTYPE.md) and [open-decisions.md](open-decisions.md).

| ID | Decision still required | Affected gates |
|---|---|---|
| `O-USDTM-002` | Production proof system | P7/P13 |
| `O-USDTM-003` | Verification-key governance | P7/P13 |
| `O-USDTM-004` | Ethereum weak-subjectivity bootstrap governance | P5/P6 |
| `O-USDTM-005` | Exact production backing statement | P13 |
| `O-USDTM-006` | Ethereum vault governance and any upgrade model | P4/P13 |
| `O-USDTM-007` | USDT freeze, blacklist, deprecation and changed-semantics response | P4/P13 |
| `O-USDTM-008` | Minima confirmation, late-fork policy and value cap | P5/P13 |
| `O-USDTM-009` | Production fixed supply and initial cap | P13 |
| `O-USDTM-010` | Production legal disclosure | P13 |
| `O-USDTM-011` | Production decimals and dust rules per lane | Before production lane creation |
| `O-USDTM-012` | Production committee, quorum, independence and epoch/exit policy | P6/P13 |
| `O-USDTM-013` | Exact economics, slashing, claims, withdrawals and legal treatment | P6/P13 |
| `O-USDTM-015` | Isolated bond pools or conservative shared multi-asset valuation | P6/P13 |

## 6. Findings: what the analysis established

The complete append-only technical finding set of `F-USDTM-001` through `F-USDTM-085` is in
[USDTM-ZK-PROTOTYPE.md, section 5](USDTM-ZK-PROTOTYPE.md). The groups below cover the full register
without replacing its exact wording or evidence level.

The repository rehome is an organizational decision under `D-USDTM-027`, not a protocol gate or
security finding. Its exact boundary and history-preservation record is in [MIGRATION.md](MIGRATION.md).

| Finding group | What was learned | Consequence |
|---|---|---|
| `F001-F008` proof feasibility | Stock KISS lacks the initially targeted pairing/recovery primitives and has strict instruction/TxPoW limits; the first Winterfell route failed | Do not call fixtures consensus proofs; P5 needs a real stateful verifier and P7/P8 needed measured mineability |
| `F009-F017` trust and schema | Signatures do not prove chain truth; Maxima is transport; token burns, stale state, global nonce and payout batching create hazards | Use explicit trust wording, fixed supply reserve, persistent records, domain separation and cumulative payouts |
| `F018` scope | mxUSDT is not part of USDTm | No inherited liabilities or migration dependency |
| `F019-F038` P1 hostile corrections | Corrected reserve lineage, one-atom floor, separate cancellation/refund states, proof-bound returns, atomicity, payout acknowledgement and exact field binding | These invariants became mandatory inputs to schemas, models, contracts and covenants |
| `F039-F040` P2/P3 | Independent encoders and immutable successor models passed local mutation and fuzz gates | Canonical bytes and chain-independent state semantics are locally frozen |
| `F041-F043` P4 | Ethereum vaults passed local EVM tests after payout-record and runtime-binding corrections | P4 is local-pass with independent review and real proof integration still open |
| `F044-F066` P7 | Stock-Core limitations were confirmed; exact TreeKey signatures and complete transactions were measured; v1 failed on block-height liveness; corrected v2 mined for both valueless lanes | P7 passed mineability, not decentralization, source truth or WOTS rollback safety |
| `F067-F070` P8 | Immutable v2 could not add branches; unified P8 executed and mined all five actions for USDTm and ETHm | Minima covenant mechanics passed with valueless fixtures and one controller |
| `F071-F074` P9 | Recovery baseline and offline guard models exist, but clone isolation failed and the signing domain was retired; global authority, independent anchor and chain adapter remain fake | P9 stays `NOW`; no fresh signature or live retry is allowed |
| `F075-F084` P6 | Economics, roster, equal/delegated bonds, shared cap, fee treasury, bond-risk index, signed work, challenges and work-reward indexing pass locally | 64 P6 tests pass, but production facts, signer attribution, slashing, claims, exits and parameters remain open |
| `F085` P9 deployment admission | A concrete two-provider profile and strict admission contract pass 44 assertions and 36 hostile cases | The profile is unassigned and disabled; no provider capability or live control is measured |

Cross-cutting findings that must remain visible:

- a valid attestor quorum can lie about Ethereum;
- a monitor or relayer must never become a validity authority;
- slashing deters or compensates fraud but does not prevent a signed lie;
- bridge principal cannot finance fees, rewards, claims or losses;
- five-of-seven is a benchmark, not the selected production quorum;
- seven keys controlled by one party are one operator, not decentralization;
- indexed rewards are not claimable rewards;
- mined valueless covenant mechanics are not production bridge evidence;
- a response timeout is an unknown outcome, not proof that a transaction was refused;
- WOTS reuse after restore is an irreversible signing-safety failure.

## 7. Phase dependency map and status

```text
P0 scope
 -> P1 threats
 -> P2 canonical bytes
 -> P3 reference state
 -> P4 Ethereum lanes ------------------------+
 -> P7 stock attestation -> P8 covenant -> P9 constructor
                                                 |
P5 Minima proof on Ethereum ---------------------+-> P10 two-way integration
P6 decentralized attestor security --------------+
                                                    -> P11 hostile campaign
                                                    -> P12 operations/recovery
                                                    -> P13 production decision
```

| Phase | Current status | Short result or blocker |
|---|---|---|
| P0 | GATE PASSED | Scope, trust, authorization and evidence rules frozen |
| P1 | GATE PASSED | Threat and accounting model passed hostile review |
| P2 | GATE PASSED | Canonical records and mutation gates passed |
| P3 | GATE PASSED | Immutable state machine and fuzz invariants passed |
| P4 | LOCAL PASS REVIEW OPEN | ERC-20/native vaults pass locally; review and real adapters remain |
| P5 | BLOCKED | Stateful Minima light client on Ethereum not implemented |
| P6 | BLOCKED | Strong local progress, but production committee/economics and signature attribution remain open |
| P7 | GATE PASSED | Exact dual-lane threshold transaction mined on stock Minima |
| P8 | GATE PASSED | All five covenant branches mined for both valueless lanes |
| P9 | NOW | Global WOTS authority, independent checkpoint, gateway, chain source and network isolation are missing |
| P10 | BLOCKED | Needs P4 review plus P5, P6 and P9 |
| P11 | BLOCKED | Needs complete P10 lifecycle |
| P12 | BLOCKED | Needs adversarial P11 result |
| P13 | NOT AUTHORIZED | Requires all gates, decisions, audits and separate founder authorization |

## 8. Complete implementation plan

Each phase below states its implementation outcome, remaining work, acceptance gate and references.
No phase changes status in this document alone. Status changes occur only in the control document
after matching evidence exists.

### P0. Scope, trust and evidence governance

Outcome: preserve one explicit product definition, no-funds boundary, status vocabulary, write scope
and evidence discipline.

Completed: control, scope and manifest validators exist and P0 is passed.

Acceptance: unique decisions/findings/evidence IDs, exactly one `NOW`, valid sidecars, current hashes,
no writes outside the allowed research boundary.

References: `README.md`, `USDTM-ZK-PROTOTYPE.md`, `open-decisions.md`, `evidence/README.md`,
`validate-usdtm-control.mjs`, `validate-usdtm-scope.mjs`, `build-research-manifest.mjs`,
`research-manifest.json`.

### P1. Threat model and accounting invariants

Outcome: model all assets, authorities, deposit/cancellation/refund races, reserve lineage, payout
ordering, proof lag, forks, halts and accounting conservation.

Completed: hostile corrections through `F019-F038` and the stronger local property model passed.

Acceptance: every rejected action leaves complete state unchanged and all successful sequences
preserve `R + I = F` and `I + P <= L`.

References: `usdtm-p1-threat-model.md`, `adversarial-verification-plan.md`,
`validate-usdtm-p1-model.mjs`, `reserve-covenant-transition-spec-v1.md`.

### P2. Canonical cross-chain records

Outcome: exact fixed-width bytes, chain/deployment domains, action IDs, recipients, amounts, epochs,
proof versions and replay identities.

Completed: two independent encoders agree and all security-bound field mutations reject.

Acceptance: golden fixtures match byte-for-byte and no semantic field can change without changing
the commitment.

References: `usdtm-p2-canonical-schema-v1.md`, `usdtm-p2-primary-encoder.mjs`,
`usdtm-p2-independent-encoder.mjs`, `usdtm-p2-records-primary.mjs`,
`usdtm-p2-records-independent.mjs`, `validate-usdtm-p2-records.mjs`,
`validate-usdtm-p2-cancellation.mjs`, `bridge-public-inputs-v1.md`.

### P3. Chain-independent reference state machine

Outcome: pure successor rules for client updates, release, cancellation, refund, return and payout
acknowledgement with property tests and mutation detection.

Completed: local deterministic and fuzzed successor tests pass.

Acceptance: same-block, out-of-order, crash/retry and deliberately broken guard tests detect every
invariant violation.

References: `usdtm-p3-reference-state-machine.md`, `usdtm-p3-reference.mjs`,
`validate-usdtm-p1-model.mjs`.

### P4. Immutable Ethereum asset lanes

Outcome: one immutable vault per ERC-20 or native asset, persistent records, measured balance
changes, exact lane binding, proof-gated refund and reentrancy-safe payout.

Completed: 22 local EVM tests currently cover the ERC-20 and native-ETH fixtures.

Remaining:

1. complete independent hostile review;
2. connect exact P6 controller/treasury adapters without weakening atomicity;
3. connect the real P5 Minima verifier;
4. resolve `O006` and `O007` before production.

Acceptance: source-bound bytecode, unit/invariant/failure tests, no administrator principal drain,
and exact proof adapter behavior.

References: `usdtm-p4-vault-status.md`, `p4/contracts/USDTmVaultV1.sol`,
`p4/contracts/NativeAssetVaultV1.sol`, `p4/contracts/MockMinimaProofVerifier.sol`,
`p4/test/USDTmVaultV1.js`, `p4/test/NativeAssetVaultV1.js`,
`validate-usdtm-p4-vault-model.mjs`, `validate-usdtm-p4-evm.mjs`.

### P5. Stateful Minima light client on Ethereum

Outcome: Ethereum verifies an exact Minima consensus transition and inclusion proof from one stored
prior client state, rather than trusting a relayer-selected root.

Remaining:

1. freeze authoritative binary vectors from pinned Core;
2. implement TxPoW hashing, work, parents, super-parents, cumulative work, fork choice and Cascade;
3. verify transaction, state output and MMR inclusion;
4. define confirmation and late-heavier-fork policy under `O008`;
5. bind exact P8 cancellation and return shapes;
6. select and benchmark the proof system and key governance under `O002-O004`;
7. measure proof generation, verifier gas and persistent state.

Acceptance: hostile fork/canonicality vectors pass and the Ethereum verifier accepts only the exact
stored-prior-to-new transition and exact settlement output.

References: `minima-consensus-fixture-spec-v1.md`, `fixtures/minima-consensus/`,
`capture-minima-consensus-fixtures.mjs`, `validate-minima-consensus-fixture.mjs`,
`proof-system-selection-matrix.md`, `minima-core-zk-verifier-rfc-2026-08-18.md`,
`minima-core-native-verifier-proposal-2026-08-18.md`, `feasibility-findings-2026-08-18.md`,
`validate-minima-core-zk-surface.mjs`, `validate-rfc-fixtures.mjs`.

### P6. Decentralized attestor and economic security

Outcome: independently controlled operators, objective membership, bounded exposure, slashable
security, neutral remuneration, delayed exits and no central coordinator.

Completed locally:

1. unanimous seven-member roster and opt-out;
2. equal bonds and limited delegated-security pools;
3. one aggregate cap across two lanes;
4. principal-free fee treasury;
5. bond-risk reward indexing;
6. signed readiness and neutral approve-or-reject work records;
7. exact-domain equivocation and mock finalized-fact contradiction;
8. challenge-delayed finalization;
9. one-shot per-asset finalized work-reward indexing;
10. 64 passing Solidity tests.

Remaining, in safe order:

1. bind P4 settlement requests to canonical work records;
2. replace the mock finalized-fact source;
3. bind Ethereum accountability identity to the same member's Minima WOTS authority;
4. implement enumerated objective faults, challenge bonds and verdict finality;
5. implement reward forfeiture and the individual/mutual slash waterfall;
6. implement post-slash reward/depositor accounting;
7. implement claims only after all challenge and forfeiture windows;
8. implement asynchronous exit that remains slashable through every liability window;
9. enforce security runway before accepting new exposure;
10. test real independent operators and resolve `O012`, `O013` and `O015`.

Acceptance: the complete P6 specification's hostile tests pass with real attribution, real operator
independence and selected production economics. Local contract completion alone cannot pass P6.

Product references: `canonical-bridge-attestor-framework-discussion-v1.md`,
`P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md`, `p6/README.md`,
`canonical-bridge-attestor-economics-model.mjs`.

Technical references: all contracts and tests under `p6/contracts/` and `p6/test/`, plus
`validate-canonical-bridge-attestor-economics.mjs` and every
`validate-canonical-bridge-p6-*.mjs` validator.

### P7. Stock-Core attestation feasibility

Outcome: prove that the complete exact threshold-signed transaction fits and mines under stock
Minima limits for six-decimal and 18-decimal lane shapes.

Completed: corrected v2 release transactions mined for both valueless lanes after the v1 block-age
failure. Signature use and failed intents were preserved.

Acceptance already met at this evidence rung: exact record, witness, scripts, proofs, conservation,
size, instructions, `txncheck` and mining.

References: `usdtm-p7-threshold-attestation-v1.md`, `bridge-asset-lanes-v1.md`,
`generic-attestation-schema-v1.md`, `generic-attestation-primary.mjs`,
`generic-attestation-independent.mjs`, `p7/TreeKeySignatureBenchmark.java`,
`p7/GenericLaneTxPowBenchmark.java`, `validate-usdtm-p7-threshold.mjs`,
`validate-generic-attestation-records.mjs`, `validate-minima-treekey-signatures.mjs`,
`validate-generic-lane-txpow.mjs`.

### P8. Unified Minima reserve covenant

Outcome: one immutable per-lane covenant with exact control/reserve topology and all five actions.

Completed: `CLIENT_UPDATE`, `RELEASE`, `CANCEL`, `RETURN` and `PAYOUT_ACK` mined for both valueless
USDTm and ETHm P8 lanes with zero burn and final `I=0`, `P=0`, `R=F`.

Acceptance already met for covenant mechanics only. It does not prove real source facts, operator
independence, P5 or P9.

References: `reserve-covenant-transition-spec-v1.md`, `generic-p8-record-schema-v2.md`,
`generic-p8-records-primary.mjs`, `generic-p8-records-independent.mjs`,
`p8/GenericP8UnifiedSmoke.java`, `render-mainnet-p8-lanes.mjs`,
`validate-generic-p8-records.mjs`, `validate-generic-p8-unified-smoke.mjs`,
`validate-p8-v2-branch-coverage.mjs`, `mainnet-lanes-p8.json`.

### P9. Recovery-safe Minima transactions and WOTS authority

Outcome: no crash, restore, duplicate node, concurrent coordinator, ambiguous post or altered loaded
transaction can reuse a WOTS leaf or create two settlements.

Current completed local work:

- append-only guarded reservation and strict counter model;
- exact transaction-body binding before reserve, each sign step and post;
- durable post-attempt and typed unknown handling;
- exact confirmation and definitive-nonsettlement model;
- fake global fence, independent checkpoint, strict gateway and chain source;
- selected Cloudflare fence and independent AWS checkpoint deployment profile;
- strict deployment-admission schema with 36 hostile configuration and probe cases;
- disabled legacy live build/post entrypoints;
- permanently retired P8 signing domain.

Current blocking implementation sequence:

1. implement and deploy the selected Cloudflare non-expiring signer-domain fence service;
2. implement and deploy the separate AWS DynamoDB/S3 Object Lock checkpoint protocol;
3. make raw Minima signing RPC unreachable except through a strict conditional-sign gateway;
4. implement one complete typed Minima chain-source adapter for confirmation and nonsettlement;
5. establish measured inbound network isolation for every future node run;
6. prove fence-before-checkpoint-before-sign ordering under crash and concurrent restore;
7. prove exact restart, post-unknown reconciliation and one-settlement retry behavior;
8. request separate founder authorization before creating any fresh valueless key domain or running
   a live ceremony;
9. never reactivate or sign with the retired P8 key domain.

Acceptance: a real, globally fenced and independently anchored implementation passes the complete
hostile matrix and an authorized fresh valueless mainnet transaction confirms without leaf reuse.

References: `P9-COMPLETION-SPEC.md`, `P9-WOTS-GUARD.md`, `p9-wots-policy.json`,
`P9-DEPLOYMENT-ARCHITECTURE.md`, `p9-deployment-profile.json`,
`generic-bridge-p9-deployment-admission.mjs`, `validate-generic-p9-deployment-admission.mjs`,
`wots-write-ahead-guard.mjs`, `generic-bridge-transaction-lifecycle.mjs`,
`generic-bridge-p9-signing-authority.mjs`, `generic-bridge-p9-chain-reconciler.mjs`,
`validate-wots-write-ahead-guard.mjs`, `validate-generic-p9-transaction-boundaries.mjs`,
`validate-generic-p9-signing-authority.mjs`, `validate-generic-p9-chain-reconciler.mjs`,
`finalize-generic-p9-evidence.mjs`.

### P10. Complete two-way valueless integration

Outcome: deposit, inbound attestation, Minima release, cancellation/refund, Minima return, proof and
Ethereum payout work twice for both lanes with replaceable permissionless relayers.

Dependencies: P4 review, P5, P6 production-shaped security and P9.

Acceptance: complete accounting reconciliation, no cross-lane mutations, every race ordering, and
successful relayer replacement after interruption.

References: phase P10 in `USDTM-ZK-PROTOTYPE.md`, `adversarial-verification-plan.md`, P4 contracts,
P5 verifier, P6 contracts and P8/P9 constructors.

### P11. Full adversarial campaign

Outcome: attack the integrated system rather than isolated components.

Required families include replay, wrong domain, stale/forked proofs, late heavier forks, malformed
serialization, skipped records, reserve substitution, burn, concurrent spends, proof denial of
service, WOTS restore/reuse, reentrancy, token controls, crash boundaries, cancellation races,
relayer censorship, committee collusion, slashing and claim ordering.

Acceptance: independent refuters report no unresolved critical or high defect.

Reference: `adversarial-verification-plan.md` and phase P11 in the control document.

### P12. Operations, recovery and observability

Outcome: public identifiers, deterministic secret-free recovery bundles, solvency reconciliation,
safe halts and operator reconstruction from authoritative chain evidence.

Remaining: define monitoring without validity authority, prove clean reconstruction, exercise
stale-checkpoint and unknown-fork halts, and document incident/replacement procedures.

Acceptance: a clean independent operator reconstructs the bridge and no monitoring service is
required for validity.

References: phase P12, `P9-COMPLETION-SPEC.md`, `evidence/README.md`, and the recovery sections of
the attestor framework.

### P13. Production go or no-go

Outcome: an explicit decision, not an automatic consequence of passing tests.

Prerequisites:

- every prior phase gate passed;
- every open founder decision closed;
- external technical, economic and legal audits accepted;
- genuine operator independence and slashable security evidenced;
- production contracts, keys, assets, caps and disclosures separately authorized;
- capped per-lane launch and incident procedures approved.

No current work authorizes P13 activity.

References: phase P13, `open-decisions.md`, the attestor framework About-page requirements and all
accepted external audit reports when they exist.

## 9. Immediate work programme

The single authoritative `NOW` phase remains P9. The near-term order is:

1. Implement the selected Cloudflare fence service and provider-independent conformance harness.
2. Implement the separate AWS conditional-head and compliance-history checkpoint adapter.
3. Implement the complete strict node gateway specified by the selected profile.
4. Implement the real chain-source adapter and disposable-guest isolation harness.
5. Run the full P9 hostile suite without a node or signature first.
6. Obtain explicit authorization before any fresh valueless key or live verification.
7. Only after P9 passes, resume the phase dependency order toward P10.

Offline P6 work may continue under `D-USDTM-025` without changing the phase board. Its next safe
sequence is objective forfeiture/slashing, post-slash accounting, then claims and asynchronous exit.
Claims must not be implemented before the challenge and forfeiture state machine is complete.

## 10. Public About page implementation track

The About page is a required safety surface, not marketing decoration. Build it only from fields
that can be independently derived from contracts, chain records or signed public policies.

It must disclose:

1. canonical 1:1 backing and principal location;
2. every live lane, vault, token, reserve and cap;
3. current committee, threshold, epoch and independence evidence;
4. candidate selection, unanimous acceptance and opt-out process;
5. bonds, delegated security, individual and mutual risk;
6. what attestors verify and the fact that a quorum can lie;
7. remuneration, challenge, slashing and claim rules;
8. transfer timing, confirmations, fees, recovery and pause conditions;
9. permissionless relayer/prover roles;
10. liabilities, backing, pending payouts, unresolved incidents and audit links;
11. what is insured and what is not;
12. current deployed facts separated from proposals and research fixtures.

Primary reference: [canonical-bridge-attestor-framework-discussion-v1.md, sections 2 through 19](canonical-bridge-attestor-framework-discussion-v1.md).

## 11. Evidence and documentation protocol

Every implementation slice must update or create:

1. source and tests;
2. a validator that pins compiler/tool versions and hashes every relevant source;
3. a timestamped JSON evidence artifact and SHA-256 sidecar;
4. a finding in the control document stating evidence level and limitations;
5. an execution-journal entry;
6. any affected decision or open-decision reference;
7. the research manifest after the slice stabilizes.

Evidence levels must remain distinct:

```text
design < source-inspected < local model < local runtime < node-observed < mined chain evidence
```

A higher rung for one property does not promote unrelated properties. For example, mined P8
covenant execution does not prove attestor independence, Ethereum source truth or P9 recovery.

Use [evidence/README.md](evidence/README.md) to determine whether an artifact is current. Use
`validate-usdtm-control.mjs` to verify references and sidecars. Do not cite an old artifact as
current merely because its own hash still matches.

## 12. Reference library by purpose

### General control and understanding

- [USDTM-ZK-PROTOTYPE.md](USDTM-ZK-PROTOTYPE.md): authoritative status and logs.
- [canonical-bridge-attestor-framework-discussion-v1.md](canonical-bridge-attestor-framework-discussion-v1.md): product, attestors, economics, alternatives and About page.
- [open-decisions.md](open-decisions.md): founder review list.
- [README.md](README.md): repository and evidence orientation.
- [evidence/README.md](evidence/README.md): evidence currency rules.

### Accounting, records and threats

- `usdtm-p1-threat-model.md`
- `adversarial-verification-plan.md`
- `usdtm-p2-canonical-schema-v1.md`
- `usdtm-p3-reference-state-machine.md`
- `bridge-public-inputs-v1.md`
- `reserve-covenant-transition-spec-v1.md`

### Ethereum vault and attestor implementation

- `usdtm-p4-vault-status.md`
- `p4/contracts/` and `p4/test/`
- `P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md`
- `canonical-bridge-attestor-economics-model.mjs`
- `p6/README.md`, `p6/contracts/` and `p6/test/`

### Minima records, covenant and transaction safety

- `usdtm-p7-threshold-attestation-v1.md`
- `bridge-asset-lanes-v1.md`
- `generic-attestation-schema-v1.md`
- `generic-p8-record-schema-v2.md`
- `P9-COMPLETION-SPEC.md`
- `P9-WOTS-GUARD.md`
- `P9-DEPLOYMENT-ARCHITECTURE.md`
- `p9-deployment-profile.json`

### Consensus proof research

- `minima-consensus-fixture-spec-v1.md`
- `proof-system-selection-matrix.md`
- `minima-core-zk-verifier-rfc-2026-08-18.md`
- `minima-core-native-verifier-proposal-2026-08-18.md`
- `feasibility-findings-2026-08-18.md`

## 13. Definition of a complete bridge

The bridge is not complete when contracts compile, local tests pass, one direction works, a
transaction mines, or a dashboard displays balances. It is complete only when:

1. both directions complete with exact source authentication;
2. all accounting and lane-isolation invariants hold;
3. P9 prevents WOTS reuse across crashes and restored copies;
4. the committee is genuinely independent and economically bounded;
5. objective faults can be proved, challenged, finalized and applied;
6. claims and exits cannot outrun liability or slashing windows;
7. hostile integration and recovery campaigns pass;
8. users receive accurate fees, timing, recovery and risk disclosures;
9. every production parameter and governance choice is explicit;
10. external audits and a separate founder production authorization exist.

Until then, the correct description is a valueless bridge research programme with locally and
onchain-proved components at explicitly different evidence levels.
