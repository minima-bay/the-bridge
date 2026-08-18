# Proof-system selection matrix

Date: 2026-08-18  
Status: research comparison, no selection made

## Decision rule

Benchmark a compact pairing-based proof and a hash-based transparent proof against the same fixed
public-value schema. Do not select by proof size alone. The winning candidate must have deterministic
Core verification, a bounded malformed-input cost, an acceptable trust/governance model and a full
signed transaction that mines under the consensus size limit.

| Candidate | Reference proof size | Native capability needed | Main benefit | Main blocker | Current evidence |
|---|---:|---|---|---|---|
| SP1 Groth16 wrap | about 260 bytes | BN254 field, groups, subgroup rules, pairing, transcript and fixed VK | smallest witness target and bounded verifier shape | new consensus cryptography, trusted setup, exact SP1 compatibility and key governance | official documentation only; no Minima verifier |
| SP1 PLONK wrap | about 868 bytes | exact PLONK curve, transcript, commitments and VK | compact, avoids a circuit-specific setup | still new consensus cryptography; reference proving time and verifier differ | official documentation only; no Minima verifier |
| Winterfell SHA3 STARK | 22,813 to 56,934 bytes in tested profiles | native field arithmetic, Merkle/FRI/transcript hashing | transparent and hash-based | pure KISS exceeded arithmetic and instruction capability; stronger proof leaves little TxPoW room | proof generation and off-chain verification executed; Minima verification refuted |
| Native Ethereum light client | update-dependent, not a succinct wrapper | BLS12-381, SSZ, fork schedule, committee state, MPT/RLP | no external proof-system soundness assumption | much larger consensus surface and continuous fork maintenance | specification research only |
| Generic hash-based zkVM proof | system-dependent | exact field, hash, FRI/STARK verifier and proof parser | transparent possibility | proof size, CPU, memory and worst-case TxPoW are unknown | hypothesis only |

The documented sizes are source claims or observed proof files, not promised Minima TxPoW sizes.
Transaction framing, scripts, MMR proofs and WOTS signatures must be included in the final measure.

## Benchmark phases

### B0: pin exact candidates

For each candidate record:

- repository and commit;
- proof-system and verifier version;
- curve or field;
- transcript and hash functions;
- proof encoding;
- program hash and verification-key hash;
- trusted setup or security ceremony;
- security advisories and audit status;
- license and long-term maintenance owner.

### B1: standalone deterministic verifier

Use identical valid and invalid vectors in two independent implementations. Measure:

- proof bytes and public-value bytes;
- valid and worst invalid verification time;
- peak memory and allocations;
- malformed decoding cost;
- deterministic agreement across supported platforms.

### B2: Minima Core private-network integration

Measure the full transaction and block effects:

- complete signed TxPoW bytes;
- validation time per proof and at per-block quota;
- catch-up and reorg replay cost;
- mempool rejection cost;
- behavior before and after activation;
- exact mined result on independent nodes.

### B3: Ethereum light-client workload

The proof program must cover more than one deposit. Corpus includes:

- bootstrap from a trusted weak-subjectivity checkpoint;
- current and next sync committee;
- committee-period transition;
- missed-period catch-up;
- at least one supported fork-format transition;
- finality stall and low participation;
- wrong fork domain and invalid aggregate signature;
- SSZ execution branch;
- typed and legacy receipt, RLP and MPT cases;
- vault commitment plus actual net token balance semantics;
- stale, conflicting and rollback updates.

### B4: adversarial maximum corpus

Run maximum proof size, maximum public inputs, invalid subgroup points, non-canonical field elements,
truncations, duplicates and altered program/key hashes. A candidate passes only if invalid inputs are
bounded and the maximum complete transaction mines.

## Promotion scorecard

| Criterion | Required for promotion |
|---|---|
| Consensus determinism | two implementations and all supported nodes agree |
| Soundness trust | explicit proof-system, setup, program, verifier and governance assumptions |
| Encoding | one canonical parser, alternate encodings rejected |
| Resource bounds | proof bytes, CPU, memory and block quota fixed in consensus |
| Transaction fit | maximum fully signed transaction mines |
| Ethereum coverage | bootstrap, rotations, forks, finality, receipt and vault state executed |
| Governance | immutable or explicit delayed/versioned trust role |
| Failure behavior | unknown versions, forks and token semantics halt before payout |
| Auditability | source, binaries, vectors, logs and hashes retained |

No candidate currently passes. Groth16 is the recommended first native feasibility target because its
witness is compact, not because it is already safe. The transparent STARK track should continue only
as a native-Core benchmark; the ordinary KISS route is already refuted.

## Primary sources

- [SP1 proof types](https://docs.succinct.xyz/docs/sp1/generating-proofs/proof-types)
- [SP1 Solidity verifier](https://docs.succinct.xyz/docs/sp1/verification/solidity-sdk)
- [SP1 Helios](https://github.com/succinctlabs/sp1-helios)
- [EIP-197](https://eips.ethereum.org/EIPS/eip-197)
- [Ethereum light-client specification](https://ethereum.github.io/consensus-specs/specs/altair/light-client/light-client/)
- [Winterfell](https://github.com/facebook/winterfell)
