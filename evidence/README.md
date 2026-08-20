# Evidence status

The RFC schema and validator changed during hostile review. Older `rfc-fixture-validation` artifacts
remain preserved as historical run records, but they do not evidence later source revisions.

`research-manifest.json` identifies `currentFixtureEvidence` only when an evidence artifact reports:

- `passed: true`;
- the exact current fixture SHA-256; and
- the exact current validator SHA-256.

If `currentFixtureEvidence` is null, the current schema has no matching executed fixture evidence.
Sidecars authenticate an evidence file itself; they do not make stale evidence current.

General implementation-plan evidence is current only when schema v1 binds the exact plan,
validator, control document, attestor framework, P6 specification, P9 completion specification,
P9 guard status and these evidence rules. It checks all 28 binding-decision references, all 13 open
decisions, all 11 complete finding families, all 14 implementation phases, required technical
files, local Markdown links and critical status boundaries. It is documentation-traceability
evidence only and does not pass a bridge phase or validate bridge security.

The Minima consensus RPC fixture uses the same rule separately. The manifest identifies the latest
captured `minima-consensus-mainnet-*` fixture and a current validation artifact only when it reports:

- `passed: true`;
- the exact fixture SHA-256; and
- the exact current `validate-minima-consensus-fixture.mjs` SHA-256.

That evidence proves only the checks named in `minima-consensus-fixture-spec-v1.md`. It is not proof
of canonical binary serialization or a complete Minima consensus verifier.

The manifest also selects current USDTm control evidence only when document and validator hashes
match and the evidence sidecar verifies. Scope evidence must match the current repository HEAD,
protected `Pool/2_development` tree and scope-validator hash, report no protected changes and report
no current uncommitted paths outside the explicit research allowlist. The manifest independently
recomputes the current outside-allowlist and protected-path status before selecting evidence, so an
older clean artifact cannot hide later working-tree changes. This is a current-delta check,
not a trusted pre-slice baseline or attribution record.

The manifest selects P1 model evidence only when its validator hash matches, schema v2 passed and
the deliberately preserved late-fork assumption counterexample was observed. It separately selects
P2 cancellation evidence only when the current fixture and validator hashes match, both encoders
produced 512 bytes and every recorded field mutation was detected. Neither artifact is chain-runtime
evidence.

P2 record evidence additionally requires the five-record fixture and validator hashes, five records
and complete mutation detection. P3 evidence requires the current immutable reference source and all
declared deliberate mutations detected. P4 model evidence is selected only as `partial-pass` with
`phaseGatePassed:false`, matching all three reviewed Solidity source hashes. P4 EVM evidence is also
selected only as `local-pass` with `phaseGatePassed:false`; it must match the current validator,
lockfile, configuration, both test and vault source hashes, exact compiler and Hardhat versions, 22
passing tests and a dependency audit with no moderate-or-higher finding. Neither selector may turn local EVM
execution into a public deployment or Minima-proof-authenticity claim.

Core source-surface evidence is selected only when the validator hash and exact official commit
match, the source inspection reports no native ZK surface, and its sidecar verifies. It is
source-inspected evidence only, not a Core build, benchmark, maintainer decision or activated
consensus feature.

P7 threshold evidence is selected only when the current validator hash matches, the 5-of-7 semantic
model passes, the colluding-quorum false-claim counterexample remains observable and the artifact
explicitly reports that exact signed-TxPoW measurement, mainnet mining and operator independence are
false. This prevents the local model from being promoted into KISS, WOTS, transaction, economic or
decentralization evidence.

TreeKey signature evidence is selected only when the current Java harness and Node validator hashes
match, the exact pinned Core commit and official jar are used, five default signatures verify and
their serialized total is 20,625 bytes. It must continue to report
`exactSignedTxPowMeasured:false` and `mainnetTransactionMined:false`. It is an offline signature-size
rung, not a complete witness, KISS branch, `txncheck` or transaction result.

Generic asset-lane evidence is selected only when the current validator hash matches, two isolated
lanes pass, exact wei remains bounded by the recorded unsigned 64-bit maximum, forced ETH is excluded
from attributable collateral, and cross-lane replay and state mutation reject. The selector requires
the artifact to keep 18-decimal token runtime and KISS execution false. It is a semantic plus pinned
source-inspection rung, not Solidity bytecode, a Minima token, a signed transaction or chain evidence.

Generic attestation evidence requires two independent encoders to agree on the exact 444-byte,
31-field record for both lanes and detect all 62 one-field mutations. Generic P7 TxPoW evidence then
requires both complete synthetic transactions to execute against the pinned Core jar, preserve exact
TreeKey verification and token conservation, preserve payout acknowledgement counters during release,
accept only bounded exact-snapshot equal-head reuse, preserve ports 19 through 24, reject all 63
recorded hostile checks per lane, remain below
65,536 bytes and keep each executed branch below 1,024 instructions. It must continue to report
synthetic coin proofs, no node `txncheck`, no 18-decimal token creation and no mainnet mining.

Mainnet genesis evidence is current only when the JSON plus SHA-256 sidecar records the real token
IDs, transaction IDs, mined TxPoW IDs and blocks for both isolated lanes; proves each control coin has
the exact 40-port `mainnet-lanes.json` state; proves each reserve is stateless and holds the exact full
valueless test supply; confirms an independent node tracks all four covenant coins; and proves the
issuer returned all remaining Minima to the pinned input address and has no sendable coin. This rung
does not pass P7 by itself: it must retain `phaseGatePassed:false` until a real 5-of-7 signed covenant
transition mines with exact successor verification. A one-controller seven-key fixture is mechanics
evidence only and must never be counted as decentralization evidence.

A live candidate that passes initial `txncheck` but is later dropped is refutation evidence, not a
partial pass. Preserve its transaction ID, construction height, before/after validation flags,
input/output existence, mempool observation and exact WOTS use increments. Never reuse signatures
from a failed attempt. A corrected offline candidate remains `phaseGatePassed:false` until it passes
independent hostile rereview and a separately authorized real transaction survives ordinary posting
lag and mines with exact successor verification.

P9 evidence is current only when the final partial artifact binds the current policy, guard,
lifecycle, production-shaped signing authority, exact-chain reconciler, all four validators and
legacy-builder lock by SHA-256; names the exact current journal policy and head; selects matching
sidecar-verified guard, transaction-boundary, signing-authority and chain-reconciler runs; keeps
`phaseGatePassed:false`; records the stale-clone network-isolation refutation; and confirms the live
P8 signing policy is disabled. Stale/current counter observations prove only the recorded key
metadata and wrapper cleanup fields. They do not prove that the wildcard listeners were unreachable,
that no outside signature occurred during the first stale run, or that a copied store or second host
is fenced by a real authority. The new authority and reconciler evidence uses dependency-injected
fakes. It does not prove a real non-expiring cross-host fence, independent WORM checkpoint, complete
live chain source, strict node gateway or measured network isolation. The P8 fixture key domain is
retired and must not sign again.

P9 deployment-admission evidence is a separate lower rung. It is current only when schema v1 binds
the exact architecture, selected-provider profile, admission module and validator hashes; reports
the profile as `design` and activation as `disabled`; keeps both `phaseGatePassed` and
`authorizationGranted` false; and records zero node startups, signatures and transactions. It
proves strict configuration and measured-probe admission semantics only. Provider documentation,
placeholder account identities and synthetic probe results do not prove a deployed global fence,
independent checkpoint, strict gateway, network isolation or complete live chain source.

P6 roster evidence is current only when the validator, Solidity contract, local EVM test, Hardhat
configuration and pinned P4 lockfile hashes match; exactly seven tests pass with Solidity 0.8.24 and
Hardhat 3.13.0; and the compiled ABI still contains no payable, owner, administrator or upgrade
function. It proves only the moneyless unanimous-selection and pre-activation opt-out mechanism.
Its bond-readiness dependency is a source-bound mock. It does not select candidates or economic
values and does not implement bond custody, rewards,
slashing adjudication, claims, bridge-message verification or a public deployment.

P6 bond-vault evidence is current only when the validator, vault, roster, valueless token fixture,
focused test, Hardhat configuration and pinned lockfile hashes match; exactly eight focused tests
pass; and the compiled ABI contains no payable, privileged, withdrawal, slash, sweep or rescue
function. It proves exact local one-way custody, full individual/mutual tranche partition, exact
balance-delta receipt, minimum self-bond capacity, separated self/delegated accounting, current
aggregate custody coverage and fail-closed hostile token behavior.
It does not prove a production asset, beneficial ownership, economic sufficiency, withdrawal,
objective adjudication, claims, signer attribution or public deployment.

P6 delegated-security-pool evidence is current only when the validator, vault, roster, valueless
token fixture, focused test, Hardhat configuration and pinned lockfile hashes match; exactly six
focused tests pass; and `D-USDTM-026` remains the controlling decision. It proves that a voluntary
public depositor can back one selected approved attestor, cannot consume the committed minimum
self-bond capacity and cannot make the member ready before the exact full pool and self-bond are
present. The current contributor position is internal, one-way and non-transferable. It does not
prove per-account reward indexing or fee distribution, slashing, asynchronous withdrawal,
beneficial ownership, legal treatment, a production self-bond percentage, a real asset or public
deployment.

P6 exposure-controller evidence is current only when the validator, controller, two-lane fixture,
roster, bond vault, token fixture, focused test, Hardhat configuration and pinned lockfile hashes
match; exactly seven focused tests pass; and the compiled ABI has no payable, privileged,
lane-replacement or cap-raising function. It proves one immutable shared cap, cross-lane replay
protection, underbonded increase rejection and lane-isolated risk-reducing release. It does not prove
the P4 lane adapters, production deterministic deployment, retirement, replacement, slashing state,
security runway, multi-asset valuation or public operation.

P6 fee-reward-treasury evidence is current only when the validator, treasury, exposure controller,
atomic lane fixture, two valueless token fixtures, focused test, Hardhat configuration and pinned
lockfile hashes match; exactly eight focused tests pass; and the compiled ABI has no payable,
privileged, claim, withdrawal, release, slash, sweep or rescue function. It proves exact-lane
confirmed-fee admission, one-use settlement binding, complete fee-ledger conservation, principal
separation in the atomic lane fixture, isolated per-asset runway calculation and fail-closed hostile
token behavior. It does not prove P4 lane integration, quote correctness, runway enforcement,
per-account reward attribution, depositor claims, challenge finality, forfeiture, slashing, a
production allocation or public operation.

P6 epoch-reward-index evidence is current only when the validator, reward index, treasury, bond
vault, roster, exposure controller, atomic lane and token fixtures, focused test, Hardhat
configuration and pinned lockfile hashes match; exactly eight focused tests pass; and the compiled
ABI has no payable, privileged, payout claim, withdrawal, transfer, slash, sweep or rescue function.
It proves roster commitment, vault-before-balance checkpoints, treasury-only indexing, equal member
pool allocation, capital-proportional member/depositor accounting, isolated fee-asset indices,
repeated accrual, rounding retention and underbonded atomic rollback. It does not prove objective
readiness or participation records, challenge finality, forfeiture, post-slash updates, withdrawals,
payouts, P4 integration, a native-ETH fee adapter or public operation.

P6 work-epoch evidence is current only when schema v2 binds the validator, work recorder, objective
decision verifier, finalized-fact-source fixture, exact lane fixture, roster, bond vault, exposure
controller, token fixture, focused test, Hardhat configuration and pinned lockfile hashes; exactly
twelve focused tests pass; and both compiled ABIs have no payable, privileged, payout, custody,
claim, withdrawal, transfer, release, slash, sweep or rescue function. It proves exact-recorder
commitment, one fully bonded member heartbeat per readiness window, active-and-bonded exact-lane
request admission, approve-or-reject neutrality, mandatory domain-bound EIP-712 accountability,
self-proving same-request equivocation, immutable-source fact-contradiction handling, hostile proof
rejection, full work-history accumulation and permissionless finalization only after the challenge
delay. It does not prove infrastructure uptime, decision truth beyond the selected fact source, a
production source-chain verifier, Minima WOTS signer attribution, P4 request binding, challenge
economics, reward allocation, claims, payouts, slashing, public deployment or production operation.

P6 work-reward-index evidence is current only when schema v1 binds the validator, work index, work
recorder, objective verifier, finalized-fact fixture, fee treasury, bond-risk index, bond vault,
roster, exposure controller, lane and token fixtures, focused test, Hardhat configuration and pinned
lockfile hashes; exactly eight focused tests pass; and the work index and treasury ABIs expose no
payable, privileged, claim, withdrawal, redemption, release, transfer, payout, slash, sweep or rescue
function. It proves pre-epoch exact-index registration, in-epoch confirmed-fee attribution,
challenge-finalized one-shot readiness and participation allocation, challenged-decision removal,
two-asset isolation, exact epoch boundaries, zero-weight handling and retained rounding without a
token transfer. It does not prove a production fact verifier, P4 request binding, Minima WOTS signer
attribution, forfeiture, claims, payouts, slashing, public deployment or production operation.
