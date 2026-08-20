# The Bridge

Canonical Bay-level repository for the valueless Ethereum and Minima asset-lane bridge research
programme. The project moved out of The Pool on 2026-08-20 and is now a peer of The Pool, The Land
and The Springboard.

Read `CANONICAL-BRIDGE-GENERAL-IMPLEMENTATION-PLAN.md` for the complete readable map of the problem,
architecture, components, decisions, findings, phase dependencies, implementation steps, technical
files and remaining work.

Read `USDTM-ZK-PROTOTYPE.md` first. Its legacy filename remains stable, but it is now the living
status board, phase plan, decision log, findings log and evidence index for a generic asset-lane
prototype. USDTm is one ERC-20 lane and native ETH is the first additional feasibility target.

## Repository boundary

This standalone repository is the only canonical bridge implementation. The former Pool location
contains a read-only pointer and must not contain a duplicate implementation. Runtime node data,
wallets, WOTS guard journals, backups, dependency caches and local upstream source checkouts are not
published. See [MIGRATION.md](MIGRATION.md) for the rehome record and boundaries.

## Evidence rules

- Runtime responses are preserved before conclusions are written.
- Source inspection is labelled as source inspection, never runtime proof.
- `runscript` proves parser and VM execution only. It does not prove transaction validity or
  mineability.
- No transaction is signed or posted by the runtime capability probe.
- No token, covenant, vault or bridge is created by this research harness.
- Each generated evidence JSON receives a SHA-256 sidecar and records the probe source hash.

## Current harness

`minima-runtime-probe.mjs` records:

- selected live node identity and canonical tip fields;
- parser verdicts for unavailable proof-related primitives;
- parser and execution verdicts for native `CHECKSIG` and MMR `PROOF`;
- the observed KISS instruction boundary using one passing and one failing script.

Run from this directory:

```powershell
node .\minima-runtime-probe.mjs http://127.0.0.1:9105
```

The harness uses read-only `status` and `runscript` commands. It does not call transaction or wallet
commands.

`minima-kernel-probe.mjs` records the live consensus limits, KISS numeric-bound behavior, a standard
SHA3 vector and the exact chained-SHA3 instruction boundary.

## Minima consensus fixture package

The first independent-verifier fixture rung is documented in
`minima-consensus-fixture-spec-v1.md`:

- `capture-minima-consensus-fixtures.mjs` preserves exact read-only mainnet RPC responses and their
  SHA-256 values for a recent block range and a range beginning at the live Cascade boundary;
- `validate-minima-consensus-fixture.mjs` checks response integrity, heights, displayed target
  consistency, compacted immediate-parent continuity, unique IDs and anchor survival;
- the validator mutates copies in memory and must reject seven claimed fault classes;
- `minima-core-native-verifier-proposal-2026-08-18.md` is the concise Core-facing discussion draft.

Run the collector and validator from this directory:

```powershell
node .\capture-minima-consensus-fixtures.mjs http://127.0.0.1:9105 24 8 8
node .\validate-minima-consensus-fixture.mjs .\fixtures\minima-consensus-mainnet-<stamp>.json
```

The fixture is RPC observation evidence, not canonical consensus serialization. It does not
recompute TxPoW IDs, difficulty adjustment, cumulative work, fork choice, Cascade transitions or
MMR proofs.

## RFC package

The next-stage, still no-funds package is:

- `minima-core-zk-verifier-rfc-2026-08-18.md`: proposed native proof witness,
  `VERIFYZK` surface, deterministic resource model, activation rules and Core promotion gates;
- `bridge-public-inputs-v1.md`: fixed-width 1005-byte public-value schema and replay domain;
- `reserve-covenant-transition-spec-v1.md`: pre-minted reserve meaning, accounting invariants and
  exact branch input/output requirements;
- `usdtm-p1-threat-model.md`: two-chain cancellation lifecycle, exact reserve admission,
  amount-equivalent substitution, ordering attacks and later evidence gates;
- `validate-usdtm-p1-model.mjs`: abstract P1 property and mutation model; not EVM, KISS, proof or
  transaction evidence;
- `usdtm-p2-canonical-schema-v1.md`: exact P2 cancellation record and still-open schema work;
- `usdtm-p2-primary-encoder.mjs` and `usdtm-p2-independent-encoder.mjs`: independent 512-byte
  cancellation encoders;
- `validate-usdtm-p2-cancellation.mjs`: golden, cross-encoder and every-field mutation checks;
- `fixtures/usdtm-p2-records-v1.json`, `usdtm-p2-records-primary.mjs`,
  `usdtm-p2-records-independent.mjs` and `validate-usdtm-p2-records.mjs`: remaining P2 record
  goldens, dual encoders, 136 field mutations and semantic negatives;
- `usdtm-p3-reference-state-machine.md` and `usdtm-p3-reference.mjs`: immutable-successor reference
  machine, tagged sparse nullifier accumulator and deterministic fuzz gate;
- `p4/contracts/`: valueless mock token, mock proof interface, isolated ERC-20 vault and isolated
  native-ETH vault source;
- `p4/package.json`, `p4/package-lock.json` and `p4/hardhat.config.js`: project-local pinned Hardhat
  3.13.0 and Solidity 0.8.24 build profile;
- `p4/test/USDTmVaultV1.js` and `p4/test/NativeAssetVaultV1.js`: 22 local EVM tests over both
  compiled lane vaults, including exact local runtime matching outside compiler-declared immutable
  ranges;
- `usdtm-p4-vault-status.md` and `validate-usdtm-p4-vault-model.mjs`: explicit partial P4 status and
  local source/semantic checks;
- `validate-usdtm-p4-evm.mjs`: clean compile, EVM test, dependency-audit and bytecode evidence gate;
- `validate-minima-core-zk-surface.mjs`: pinned official Core source-surface inspection;
- `usdtm-p7-threshold-attestation-v1.md`: 5-of-7 exact-record protocol, covenant boundary,
  WOTS benchmark gate and decentralization requirements;
- `validate-usdtm-p7-threshold.mjs`: local semantic transition, mutation, atomic-rejection and
  colluding-quorum model;
- `bridge-asset-lanes-v1.md`: isolated per-asset identity, vault, reserve, decimal and exposure
  model, including the provisional exact-wei ETH lane;
- `validate-bridge-asset-lanes.mjs`: two-lane USDTm/native-ETH semantic model and pinned Core decimal
  and numeric assertions;
- `generic-attestation-schema-v1.md`, two independent encoders and
  `validate-generic-attestation-records.mjs`: frozen 444-byte ERC-20/native lane record with all 31
  fields mutated in both fixtures;
- `p7/GenericLaneTxPowBenchmark.java` and `validate-generic-lane-txpow.mjs`: pinned-Core offline
  execution and complete serialized synthetic TxPoW measurement for both lane types;
- `generic-mainnet-ceremony.mjs` and `mainnet-ceremony-state.json`: guarded dual-token mainnet
  ceremony and public-facts-only progress state; both exact lane genesis transactions are mined and
  the one-use issuer is retired after returning every remaining Minima atom;
- `p7/TreeKeySignatureBenchmark.java` and `validate-minima-treekey-signatures.mjs`: pinned official
  Core offline TreeKey verification and exact serialized-signature size benchmark;
- `minima-core-contact-draft-2026-08-19.md`: archived public-issue draft, not posted and not to be
  posted under the stock-Core-only decision;
- `proof-system-selection-matrix.md`: compact SNARK and hash-based STARK candidates and benchmark
  gates;
- `adversarial-verification-plan.md`: attacks and the evidence ladder;
- `open-decisions.md`: choices that remain with the founder;
- `fixtures/bridge-public-inputs-v1.json`: non-monetary deterministic schema fixture;
- `validate-rfc-fixtures.mjs`: local encoder and negative-vector validator;
- `evidence/rfc-fixture-validation-*.json`: executed schema-only result and SHA-256 sidecar;
- `evidence/README.md`: current-versus-superseded evidence rule;
- `research-manifest.json`: artifact hashes generated by `build-research-manifest.mjs`.

Run the schema checks from this directory:

```powershell
node .\validate-rfc-fixtures.mjs
node .\validate-usdtm-control.mjs
node .\validate-usdtm-scope.mjs
node .\validate-usdtm-p1-model.mjs
node .\validate-usdtm-p2-cancellation.mjs
node .\validate-usdtm-p2-records.mjs
node .\usdtm-p3-reference.mjs
node .\validate-usdtm-p4-vault-model.mjs
node .\validate-usdtm-p4-evm.mjs
node .\validate-minima-core-zk-surface.mjs
node .\validate-usdtm-p7-threshold.mjs
node .\validate-minima-treekey-signatures.mjs
node .\validate-bridge-asset-lanes.mjs
node .\validate-generic-attestation-records.mjs
node .\validate-generic-lane-txpow.mjs
```

Add `--evidence` only for a final validator run that should create a new immutable artifact. The P4
EVM validator runs the project-local compile, test and dependency-audit commands. These validators
never send a node, wallet, RPC or transaction command.

## Result

See `feasibility-findings-2026-08-18.md`. The first pure-KISS candidate, Winterfell with SHA3, is
refuted by the current numeric range and instruction limit. No proof was verified on Minima and no
transaction was signed or posted.

The RFC outcome is therefore precise: the previously proposed native-verifier path requires a
Minima Core consensus feature. The founder subsequently ruled out dependence on a Core change or
Minima-team priorities and selected a hybrid architecture. Ethereum-to-Minima now benchmarks a
5-of-7 threshold-attested covenant on stock Minima; Minima-to-Ethereum retains stateful proof
verification on Ethereum. A separate stock-KISS proof-verifier search continues without blocking
the hybrid prototype. Threshold attestations must never be described as ZK verification or a
trustless source-chain proof.

The semantic threshold model proves exact-record binding, unique active-epoch quorum, replay
protection, capacity and exact-output enforcement within its declared abstraction. It deliberately
also proves the opposite boundary: five colluding active signers can authorize a false source claim.
P7 therefore remains open until the exact TreeKey/WOTS witnesses and a real five-signature covenant
transition pass stock-mainnet validation and mineability gates. Logical local keys do not prove
independent operators, bonds or Ethereum-side slashing.

The complete offline synthetic transaction rung now passes against the pinned official jar. Five
verified default TreeKey signatures remain 20,625 bytes. With the 444-byte record, real KISS script,
successor state, outputs, script proof and two deterministic 32-level coin proofs, the ERC-20 TxPoW
serializes to 31,886 bytes and the native-ETH TxPoW to at most 32,054 bytes. The advancing-head control
branch uses 539 instructions and the bounded equal-head branch uses 553. Release preserves the
payout cursor and cumulative-paid counter; payout acknowledgement remains a separate transition.
This offline artifact is not node `txncheck` or a mined transition because its UTXOs and coin proofs
are synthetic. The later live genesis evidence separately supplies real token metadata and UTXOs.

The authorized live ceremony created purpose-specific valueless USDTm, ETHm and two one-unit control
tokens on stock Core 1.1.2.6. Exact two-input/two-output transactions mined isolated covenant genesis
coins for both lanes. Each control coin reproduces all 40 committed state ports and each stateless
reserve holds the exact full test supply. An independent signer-fixture node tracks all four coins.
The issuer returned its complete residual Minima balance to the pinned original funding-input address
with zero burn, now has no sendable coin, and is retired `NEVER-REUSE`. See
`evidence/generic-mainnet-genesis-20260819T121551Z.json`.

The first real five-signature USDTm release then refuted deployed v1. It passed `txncheck` at its
construction height, but `STATE(17) == @BLOCK` became false after the chain advanced and the network
dropped it without spending either input. The first five fixture TreeKeys each consumed one use.
Candidate v2 uses a monotonic, nonfuture construction height within the port-18 posting-lag bound;
its strengthened offline hostile rereview passes 70 assertions and 66 hostile checks per lane. A
normal signer-node restart preserved the five failed WOTS uses and signed intent exactly. Candidate
v2 is not deployed or authorized for another ceremony, and restore/rollback WOTS safety remains
unproved. See `evidence/generic-p7-live-refutation-20260819T122914Z.json` and
`evidence/generic-p7-v2-hostile-rereview-20260819T124647Z.json`.

The protocol is now asset-generic through isolated lanes. The first two-lane model passes for a
six-decimal ERC-20 lane and a provisional 18-decimal native ETH lane. ETH is not locked directly on
Minima: an Ethereum vault would lock native ETH and the Minima reserve would release an isolated
representation such as `ETHm`. Exact wei modeling fits only below the current single-limb maximum of
18.446744073709551615 ETH. The fixture cap is 10 ETH equivalent and valueless only. Native vault
bytecode and 18-decimal Minima token/genesis compatibility now pass their local/live rungs; a real
five-signature KISS transition, source-chain authenticity and complete two-way lifecycle remain open.

The first mainnet fixture run captured 32 blocks from Minima 1.1.2.6 and passed its declared
consistency checks after one deliberately preserved failed assumption about compacted super-parent
entries was corrected. Seven in-memory corruptions were rejected. This advances the fixture rung
only; an independent binary consensus verifier has not yet been implemented.

Current result: P8 is gate-passed. Fresh valueless USDTm and ETHm lane instances each mined
CLIENT_UPDATE, RELEASE, CANCEL, RETURN and PAYOUT_ACK on stock Minima mainnet. All ten transactions
passed full node checks, conserved both token IDs, burned zero and ended with zero issued and pending
liability plus full reserve. The residual Minima returned to the exact funding-input address and the
empty issuer is stopped and `NEVER-REUSE`. Byte-verified backups preceded offline rotation of both
exposed local database passwords; the signer reopened with all 74 keys and exact WOTS counters.
P9 remains `NOW` with a partial local result. The external journal rejects the stale counter state,
the current counter state matches, and offline guard and transaction-boundary validators pass.
Hostile review found that clone network isolation, copied-store fencing, an independent journal
anchor and live-constructor integration are not proved. The first stale-clone run exposed wildcard
RPC without authentication, so the complete P8 fixture key domain is retired from future signing.
The final live policy disables reserve creation and legacy live builders refuse signing and posting.
See `P9-WOTS-GUARD.md` and `evidence/generic-p9-partial-20260819T210506Z.json`.
