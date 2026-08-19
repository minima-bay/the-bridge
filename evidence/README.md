# Evidence status

The RFC schema and validator changed during hostile review. Older `rfc-fixture-validation` artifacts
remain preserved as historical run records, but they do not evidence later source revisions.

`research-manifest.json` identifies `currentFixtureEvidence` only when an evidence artifact reports:

- `passed: true`;
- the exact current fixture SHA-256; and
- the exact current validator SHA-256.

If `currentFixtureEvidence` is null, the current schema has no matching executed fixture evidence.
Sidecars authenticate an evidence file itself; they do not make stale evidence current.

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
