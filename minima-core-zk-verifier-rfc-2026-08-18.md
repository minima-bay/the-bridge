# RFC: bounded native ZK proof verification for Minima

Date: 2026-08-18  
Status: research proposal, not implemented  
Scope: Minima Core consensus capability, not a bridge deployment

## 1. Decision requested from Minima Core

Add one deterministic, versioned and resource-bounded proof-verification facility to Minima Core.
The first target should be a compact Groth16-style wrapped proof with a fixed curve, transcript,
verification-key format and public-value encoding. A hash-based STARK verifier should remain a
separate benchmark track, not an automatic fallback.

This is a consensus and transaction-serialization change. It cannot be shipped as an ordinary
MiniDapp or KISS covenant. The current pure-KISS Winterfell/SHA3 experiment was refuted by executed
limits: the verifier needs more hashes and field arithmetic than the current 1,024-instruction and
unsigned 64-bit numeric environment can provide.

No bridge, token, vault or monetary deployment is authorized by this RFC.

## 2. Why a native primitive is needed

A ZK proof is useful cross-chain only if the destination consensus verifies it. A relayer signature
over proof bytes proves who signed those bytes, not that the proof or the source-chain statement is
valid. Minima currently exposes signature, script and coin MMR witnesses. Current `Witness.java`
serializes signatures, coin proofs and script proofs, but no general ZK proof witness. The live
1.1.2.6 node also rejected `BLSVERIFY`, `PAIRING` and `ECRECOVER` as KISS function names.

SP1 shows that an Ethereum light-client program can produce a succinct proof which commits a
finalized Ethereum state. Its execution-header mode commits the finalized execution block hash and
receipts root, which can support receipt and log inclusion. That proves portability of the proof
concept, not Minima compatibility. SP1's documented Groth16 and PLONK wrappers are presently
verified by EVM-oriented verifier contracts. Minima needs its own consensus verifier.

## 3. Proposed transaction witness extension

Add an ephemeral `ZKProofWitness` list to the transaction witness. The proof is part of the signed
transaction and TxPoW size calculation, but is not copied into a recreated covenant state coin.

Version 1 entry:

| Field | Encoding | Maximum |
|---|---|---:|
| `proofSystemId` | unsigned 16-bit | fixed registry |
| `verifierVersion` | unsigned 16-bit | fixed registry |
| `programHash` | 32 bytes | exactly 32 |
| `verificationKeyHash` | 32 bytes | exactly 32 |
| `publicValues` | length-prefixed bytes | 4,096 bytes |
| `proofBytes` | length-prefixed bytes | candidate-specific, initially 2,048 bytes |

Initial consensus limits:

- at most one ZK proof witness per transaction;
- no network access, remote gateway or mutable external registry;
- canonical minimal integer and length encodings only;
- exact byte limits checked before allocation or cryptographic work;
- unknown proof system, version, curve, transcript or public-value schema fails closed;
- proof bytes are committed by TxPoW serialization; the exact transaction-signature commitment
  must be specified and tested rather than assumed;
- malformed proofs produce a deterministic false result, never an exception-dependent verdict;
- duplicate verification calls for the same witness use one transaction-local cached result;
- proof verification has a separate consensus cost unit, not a misleadingly small KISS instruction
  charge.

The existing witness wire format cannot be extended without activation rules. Nodes must reject
version-1 proof witnesses before the activation height and must reject blocks containing an unknown
witness version after activation.

## 4. Proposed KISS surface

Expose one narrow predicate:

```text
VERIFYZK(
  witnessIndex,
  expectedProofSystemId,
  expectedVerifierVersion,
  expectedProgramHash,
  expectedVerificationKeyHash,
  expectedPublicValuesHash
)
```

It returns true only when:

1. the indexed witness exists;
2. every expected identifier equals the witness identifier;
3. `SHA2-256(publicValues)` equals `expectedPublicValuesHash`;
4. the native verifier accepts `proofBytes` for the exact public values and pinned key;
5. all resource and canonical-encoding checks pass.

The covenant remains responsible for binding `expectedPublicValuesHash` to its own inputs, outputs
and state. Add two bounded accessors for that purpose:

```text
ZKPUBLICHASH(witnessIndex)
ZKPUBLIC(witnessIndex, offset, length)
```

`ZKPUBLIC` returns at most 64 bytes from the exact public-value array used by the indexed proof.
Out-of-range, non-canonical or oversized reads fail. The covenant must first require `VERIFYZK` for
that same witness, then compare every action-bearing field against exact inputs, outputs and state.
Passing `ZKPUBLICHASH(index)` back as the expected hash is not by itself an authorization. It is safe
only when the covenant also binds the required fields, or when the hash was already committed by a
canonical prior state.

`VERIFYZK` and the accessors must not interpret bridge semantics, call an RPC, select a checkpoint or
decide what a token payout means.

## 5. Consensus determinism requirements

The implementation must specify and test:

- exact field modulus, subgroup checks, point-at-infinity rules and compressed-point encoding;
- rejection of non-canonical field elements and alternate encodings;
- transcript hash function and byte order;
- verification-key serialization and hash;
- public-input count and fixed-width encoding;
- bounded CPU steps, memory, stack, allocations and proof bytes;
- identical success and failure results across supported Java runtimes and platforms;
- no data-dependent unbounded loops;
- no native-library behavior that can vary by architecture;
- fail-closed behavior on arithmetic, decoding or allocation errors;
- consensus activation, rollback prohibition and unknown-version halt policy.

If the first implementation uses BN254 pairings, EIP-197 is a useful specification reference for
the pairing relation, but Minima must pin its own complete encoding, gas-equivalent cost and invalid
input behavior. Reusing the name or curve is not sufficient for cross-implementation consensus.

## 6. Verification-key governance

The production key must be one of:

1. immutable in the activated Core version; or
2. selected from a finite, activation-height-bound registry whose entries are part of consensus.

A remote or upgradeable verifier gateway is outside this trust-minimized model. SP1 documents that
its canonical EVM gateway can freeze verifiers and recommends upgradeable program verification
keys. That can be an accepted EVM governance model, but it must not be silently inherited by a
Minima-native bridge. Any key rotation requires a new version, a delayed activation rule, distinct
domain separation and an explicit policy for messages proved under the prior key.

## 7. Candidate proof systems

### 7.1 Compact SNARK track

First feasibility target: an SP1-compatible Groth16 wrapper or an equivalently specified fixed
Groth16 proof.

Documented reference characteristics, not Minima benchmarks:

- approximately 260 proof bytes;
- bounded pairing-based verification;
- trusted-setup assumptions remain;
- the exact program verification key must be pinned.

PLONK is a second compact candidate. SP1 documents approximately 868 proof bytes and a different
setup profile. It still requires its exact curve, transcript, verifier and key to be specified.

### 7.2 Hash-based STARK track

Winterfell with SHA3 is attractive because it avoids pairings and a trusted setup. The tested
current-KISS route failed:

- default proof: 22,813 bytes and 759 observed verifier SHA3 calls;
- stronger profile: 56,934 bytes and 1,466 observed verifier SHA3 calls;
- KISS passed only 203 favorable chained SHA3 calls before crossing its instruction ceiling;
- required field arithmetic did not fit current KISS numeric behavior.

A native STARK verifier is still theoretically researchable, but it needs its own bounded native
implementation and benchmarks. Winterfell itself states that it is research software and has not
been audited for production use.

## 8. Required Core benchmark corpus

Every candidate must be measured using fixed vectors and complete signed transaction shapes:

| Case | Required verdict |
|---|---|
| valid minimum public input | accept |
| valid maximum public input | accept within fixed budget |
| one-bit proof mutation | reject |
| one-bit public-value mutation | reject |
| wrong program or key hash | reject |
| non-canonical field element | reject |
| invalid subgroup point | reject |
| truncated and oversized proof | reject before expensive work |
| duplicate witness and index confusion | reject or deterministically select the exact index |
| old and unknown verifier version | reject |
| maximum script, MMR and WOTS overhead plus proof | remain below TxPoW limit and mine |
| repeated verification call | one cached result, no repeated cryptographic charge |
| cross-platform replay corpus | byte-identical verdict on every supported node |

Metrics:

- proof and public-value bytes;
- full TxPoW bytes after WOTS signature and MMR proof;
- verifier wall time and deterministic cost units;
- peak memory and allocations;
- block validation impact at the maximum allowed proof count;
- malformed-input worst case;
- initial-sync and reorg replay cost.

One successful proof is not evidence of the worst case. Promotion requires the maximum bounded
corpus and every negative vector.

## 9. Activation and denial-of-service policy

The primitive must not allow a cheap invalid transaction to force unbounded work on every node.
Before verification, nodes check transaction syntax, proof count, proof size, exact identifiers and
public-value size. The consensus cost must be high enough that a block cannot contain more verifier
work than normal nodes can validate within the accepted block budget.

Recommended initial policy:

- one proof per transaction;
- a small proof-verification quota per block, separately capped from transaction count;
- no mempool relay for proofs failing cheap structural checks;
- deterministic cache keyed by proof-system/version/key/public-values/proof hash;
- cache never changes the consensus verdict;
- benchmarked revalidation after restart and reorg.

## 10. Security boundary

Passing this RFC would prove only that Minima can verify one pinned proof relation. A bridge still
needs a correct Ethereum light-client program, authenticated bootstrap, sync-committee transitions,
fork handling, receipt and vault-state proofs, exactly-once consumption, solvency enforcement and a
fund-safe covenant.

The verifier cannot replace:

- Ethereum weak-subjectivity checkpoint policy;
- USDT issuer and contract behavior;
- vault custody and governance analysis;
- Minima covenant conservation;
- replay and client-state transitions;
- adversarial mined testing.

## 11. Promotion gates

P0, specification:

- proof format, curve, transcript, key, public encoding and resource model fixed;
- independent reviewer can implement every decoder from the RFC alone;
- Core team accepts that this is a consensus change.

P1, deterministic prototype:

- two independent implementations agree on all valid and invalid vectors;
- fuzzing finds no crash, unbounded allocation or divergent verdict;
- exact source revision and vector hashes retained.

P2, Core integration on a private network:

- full signed transactions pass validation and mine;
- block-level maximum corpus remains within the approved time and memory budget;
- old nodes reject the activated witness as specified;
- unknown versions fail closed.

P3, public valueless network test:

- proof transactions mine and survive restart, catch-up and reorg handling;
- independent nodes reproduce the verdict and resulting state;
- adversarial malformed proofs cannot stall block validation.

P4, bridge research may start:

- all prior gates pass;
- the exact production verifier and key governance are decided;
- no monetary token or vault is used.

## 12. Stop conditions

Stop or reclassify the route if:

- the worst-case signed TxPoW does not fit;
- deterministic verification exceeds the accepted block budget;
- platform-dependent arithmetic or parsing remains;
- verifier or key validity depends on a remote administrator without explicit trusted governance;
- a proof can be accepted under ambiguous encoding, key, program, chain or destination domain;
- invalid proofs create materially greater work than valid proofs without a safe block quota;
- no independent implementation matches the Core verifier;
- the selected proof system or dependency has an unresolved security advisory.

## 13. Current evidence level

This RFC is a design specification grounded in source inspection, official proof-system
documentation and executed KISS capability probes. No native verifier was implemented. No ZK proof
was verified by Minima consensus. No transaction was signed or posted for this RFC.

## 14. Primary sources

- [Current Minima Witness source](https://github.com/minima-global/Minima/blob/master/src/org/minima/objects/Witness.java)
- [Current Minima KISS function tree](https://github.com/minima-global/Minima/tree/master/src/org/minima/kissvm/functions)
- [SP1 proof types](https://docs.succinct.xyz/docs/sp1/generating-proofs/proof-types)
- [SP1 Solidity verifier and gateway](https://docs.succinct.xyz/docs/sp1/verification/solidity-sdk)
- [SP1 Helios](https://github.com/succinctlabs/sp1-helios)
- [Ethereum light-client specification](https://ethereum.github.io/consensus-specs/specs/altair/light-client/light-client/)
- [EIP-197 pairing check](https://eips.ethereum.org/EIPS/eip-197)
- [Winterfell](https://github.com/facebook/winterfell)
