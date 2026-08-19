# Proposal to Minima Core: bounded native proof verification

Date: 2026-08-18  
Status: superseded research draft, retained for history and not to be sent under `D-USDTM-016`

## Request

Would Minima Core consider a deterministic, versioned, resource-bounded proof-verification
facility in consensus?

The immediate research use is verifying an Ethereum light-client proof on Minima without trusting
an off-chain attestor. The facility should remain protocol-generic: Core verifies one pinned proof
relation and exposes authenticated public values, while a KISS covenant decides what those values
authorize.

We are asking for architectural feedback before writing bridge or monetary code.

## Why this requires Core

A proof is portable bytes, but it is not self-authenticating. If an off-chain actor verifies it and
Minima accepts that actor's signature, the trust model is a federation. Minima consensus must run
the verifier for the chain to attest that the configured proof relation accepted the statement.

The tested pure-KISS route does not fit the current runtime:

- live Minima 1.1.2.6 rejected `BLSVERIFY`, `PAIRING`, and `ECRECOVER` at parse time;
- the node accepted native `CHECKSIG` and MMR `PROOF`, but neither verifies an Ethereum light
  client or a general succinct proof;
- a valid generated script crossed the observed 1,024-instruction limit at instruction 1,025;
- a pinned Winterfell SHA3 verifier used 759 SHA3 calls for its default example and 1,466 for a
  stronger profile, before counting the field arithmetic and bridge covenant;
- Winterfell's ordinary f128 field modulus did not fit the observed KISS numeric range, while
  full-width f64 multiplication overflowed before reduction.

No proof was verified on Minima, and no transaction was signed or posted for this research.

## Narrow proposed surface

Add one bounded, ephemeral proof witness to a transaction and one KISS predicate that authenticates
it. A version-1 witness would bind:

- proof-system identifier and verifier version;
- program hash and verification-key hash;
- fixed-width public values;
- bounded proof bytes.

The proof is committed by the signed transaction and counted in the TxPoW size, but is not copied
into recreated covenant state.

Illustrative KISS surface:

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

Bounded accessors could expose the authenticated public-value hash and fixed slices. Core would not
interpret bridge semantics, call RPC endpoints, select checkpoints, or decide token outputs.

## Consensus requirements

The facility must pin and test:

- exact proof format, curve, transcript, verification-key encoding, byte order, and public inputs;
- canonical decoding and rejection of alternate encodings;
- deterministic behavior across supported Java runtimes and platforms;
- fixed proof count, byte, CPU, memory, allocation, and block-validation limits;
- cheap structural rejection before cryptographic work;
- activation height and fail-closed handling of unknown versions;
- exact transaction and signature commitments;
- deterministic revalidation after restart and reorg;
- immutable or activation-bound verification-key governance.

A remote verifier gateway or mutable off-chain key registry would create a trusted control role and
is outside the requested trust model.

## First benchmark target

We recommend benchmarking both compact pairing-based and hash-based candidates, with a fixed
Groth16 verifier as the first feasibility target. This is not a final proof-system choice.

The minimum corpus should include:

- valid minimum and maximum public inputs;
- one-bit mutations of proof and public values;
- wrong program and verification-key hashes;
- non-canonical field elements and invalid subgroup points;
- truncated and oversized proofs;
- old and unknown verifier versions;
- maximum WOTS, MMR, script, and proof overhead in one signed transaction;
- block-level maximum verifier work;
- cross-platform replay with byte-identical verdicts.

One successful proof is not a worst-case benchmark.

## Canonical Minima fixtures needed from Core

An independent Minima verifier also needs Core-owned golden vectors for:

- exact TxPoW and TxBlock binary serialization;
- TxPoW ID hashing and target comparison;
- block difficulty adjustment and cumulative-work calculation;
- super-parent and Cascade transition rules;
- compacted super-parent expansion, including entries whose first displayed difficulty is above
  zero and whose count spans multiple levels;
- fork comparison and competing-branch selection;
- MMR leaf, node, peak, bagging, value-sum, and CoinProof encoding;
- transaction, witness, state, token, and script serialization;
- activation and unknown-version behavior.

This cannot safely be derived from rendered RPC JSON alone. A live 1.1.2.6 node observed during this
research returned `header.chainid:"0x00"` for current mainnet TxPoWs, while older official TxPoW
documentation describes `0x01`. The research package preserves the node response and does not
choose a value. This is exactly why canonical versioned binary vectors are requested.

## Bridge boundary after a verifier exists

Passing native proof verification would not itself make a safe bridge. A separate proved program
and covenant must still enforce:

- authenticated Ethereum bootstrap, sync-committee transitions, fork versions, and finality;
- exact vault and USDT runtime or proxy state;
- actual attributable vault balance and current unspent deposit status;
- a canonical prior-to-new client-state transition;
- complete domain separation and exactly-once consumption;
- exact Minima reserve outputs and `new issued liability <= proved collateral`;
- reverse Minima cumulative-work, Cascade, MMR, and redemption verification;
- issuer freeze, governance, liveness, reorg, and recovery policies.

## Questions for Minima Core

1. Is an ephemeral proof witness plus a narrow KISS predicate architecturally acceptable?
2. Which proof system and curve are most plausible in the current Java and consensus environment?
3. Should the verifier be a witness primitive, a KISS native function, or another bounded consensus
   object?
4. Which existing serialization and consensus vectors can Core publish for independent verifier
   work?
5. What deterministic cost model and per-block quota would protect normal phone nodes?
6. What activation and verification-key governance model would Core accept?
7. Would Core be willing to run its own integration environment for pre-activation testing? Bay
   development itself uses offline deterministic tests and valueless mainnet evidence only.

## Evidence supplied with the discussion

- read-only runtime and kernel capability probes with complete responses and SHA-256 sidecars;
- pinned Winterfell source and proof binaries;
- instrumented proof measurements and explicit limitations;
- a fixed public-input schema, reserve transition specification, and adversarial plan;
- mainnet RPC observation fixtures with continuity and target-consistency checks.

Nothing in this proposal authorizes a Core fork, bridge deployment, vault, token, signature, or
movement of funds.
