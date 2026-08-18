# ZK light-client feasibility findings

Date: 2026-08-18

Status: no-funds research complete for the first pure-KISS candidate

## Outcome

The direct Winterfell SHA3 verifier route is refuted for the current Minima KISS VM. A proof can be
generated and verified by Winterfell off-chain, but the current KISS numeric range and 1,024
instruction ceiling prevent a faithful verifier from fitting. No proof was verified on Minima.

This result does not prove that every ZK bridge design is impossible. It shows that the most direct
hash-compatible STARK candidate tested cannot be implemented as ordinary KISS today. The credible
next route is a bounded native proof-verification primitive or another Minima protocol change. The
Minima-to-Ethereum direction remains a separate engineering path because Ethereum can host a more
capable verifier.

## Safety and concurrency boundary

- Work was confined to this private research directory.
- Pool development, order-book snapshot, release, backup, progress-ledger and implementation-plan
  files remained read-only.
- The live Minima node received only `status`, `txpow` and `runscript` requests.
- No wallet command, signature, transaction post, token creation or movement of value occurred.
- No version bump was required because no application tree was changed.

## Live Minima observations

The latest kernel artifact was captured from Minima 1.1.2.6 at block 2,268,039, hash
`0x0000002F8341B2022D3B37A22D3AC38CF460973ACDD89B99C04AD479EC0FC7B2`.

| Test | Observed result |
|---|---|
| Consensus limits | 65,536-byte TxPoW, 1,024 KISS instructions, 256 transactions |
| `BLSVERIFY`, `PAIRING`, `ECRECOVER` | Parser rejected each name |
| Native `CHECKSIG` | Parsed; dummy data failed during execution at 36 instructions |
| Native `PROOF` | Parsed as an MMR proof; dummy data failed during execution at 7 instructions |
| SHA3-256 of `abc` | Correct standard vector, 5 instructions |
| Winterfell f128 modulus | Parser rejected the value because it exceeds KISS numeric range |
| Winterfell f64 modulus | Parsed and compared successfully |
| Full-width f64 multiplication | Failed before modulo because the intermediate exceeds 2^64 |
| Exact chained SHA3 merges | 203 passed at 1,021 instructions; 204 failed at instruction 1,025 |

The 203-call measurement is deliberately favorable. It performs almost no proof parsing, field
arithmetic, transcript logic or covenant checks. It is therefore an upper bound for that exact
KISS script shape, not a complete-verifier benchmark.

## Authentic Winterfell proof experiment

Upstream source was pinned to Winterfell commit
`2f78ee9bf667a561bdfcdfa68668d0f9b18b8315`, version 0.13.1. The example was a 1,024-step Fibonacci
proof using SHA3-256. Instrumentation counted the upstream verifier's SHA3 entry points and did not
change proof or verifier decisions.

| Profile | Proof bytes | Reported security | Upstream verification | SHA3 calls observed |
|---|---:|---|---|---:|
| Default | 22,813 | conjectured 99; proven list 57, unique 39 | success, 7.5 ms instrumented | 759 |
| 64 queries, quadratic extension | 56,934 | conjectured 128; proven list 111, unique 69 | success, 16.0 ms instrumented | 1,466 |

The stronger proof included 1,060 two-digest merges alone. Current KISS exhausted its entire
instruction budget after 203 equivalent chained SHA3 merge calls. The verifier also requires field
operations that current KISS cannot represent directly: the normal f128 modulus does not parse, and
full-width multiplication in the f64 field overflows before reduction.

The 56,934-byte proof leaves 8,602 bytes under the current 65,536-byte TxPoW ceiling for all
transaction framing, covenant script and state, input MMR proof and WOTS signature. No exact signed
transaction was built, so mineability was not established. Size is a secondary concern here because
the instruction and arithmetic failures already block the route.

The proof binaries and SHA-256 sidecars are preserved. SHA3 call counts and verification timings
were observed from the instrumented console run, but its raw console log was not retained. Those
counts are therefore recorded observations from the run, not a fully self-contained transcript.
The instrumentation notes and pinned upstream source are retained to permit a repeat run.

## What the result means

ZK proofs can remove the need for validators to attest that cross-chain content is true only when
the destination chain verifies all of the following inside consensus:

1. the proof under an exact, pinned verifier and verification key;
2. public outputs binding the source chain, finalized client-state transition, vault, token, amount,
   recipient, direction, program version and replay identifier;
3. a canonical prior-to-new light-client state transition rather than a proof against an arbitrary
   relayer-supplied root;
4. the reserve and liability transition, including `new issued liability <= proved attributable
   vault balance`;
5. exactly-once message consumption and exact covenant outputs.

The current KISS VM cannot outsource these checks by merely attesting to a proof blob. A signature
over the blob proves that somebody signed it, not that Minima consensus verified the proof.

## Recommended next work

Prepare a Minima Core feasibility RFC for one bounded, versioned proof-verification primitive. It
should expose only fixed public inputs and a fixed proof system or program hash, charge a consensus
bounded cost, reject unknown versions, and be exercised against malformed proofs and worst-case
transactions before any bridge covenant is designed.

The founder decision is whether to pursue protocol-level support with Minima Core. If that is not
available, the Ethereum-to-Minima route must remain either research-only or explicitly federated.
It must not be described as trustless.

In parallel, Minima-to-Ethereum can be researched independently as a stateful Ethereum verifier for
Minima TxPoW, cumulative work, cascade and UTXO inclusion. That direction does not solve the reverse
direction and must retain explicit probabilistic reorg and delayed-settlement rules.

## Evidence index

| Artifact | SHA-256 |
|---|---|
| `evidence/minima-runtime-probe-20260818T165850Z.json` | `8d96dce2502d761ea3c82122ed3f80ce0f1e2059004f9766cd3b81a96df1ff76` |
| `evidence/minima-kernel-probe-20260818T174231Z.json` | `8d8ff743ab75dc62c1cb6b2e64e6b8548d2772f76d14f9b5791f7a39211a519c` |
| `evidence/winterfell-sha3-fib1024-20260818.bin` | `e95723134c500397f7dab401c73049ad6531ae49ae4b58ddfd5eeed84d69a883` |
| `evidence/winterfell-sha3-fib1024-default-instrumented-20260818.bin` | `e95723134c500397f7dab401c73049ad6531ae49ae4b58ddfd5eeed84d69a883` |
| `evidence/winterfell-sha3-fib1024-q64e2-instrumented-20260818.bin` | `a674f9659af879417309bdcbd9348509b85441f2c4d92bbabd8825e0315eec9a` |

Harness hashes:

- `minima-runtime-probe.mjs`: `7a7b759ef4e9fd1254bfb8c656d9b0cf7ae4bbaa44d8dc3b70b0a959de6b1cfd`
- `minima-kernel-probe.mjs`: `dcff4b58b91d901b41fd4672fd0130a5b64c8d4cd8c1e613ab00b58d94a11bc8`

## Primary source anchors

- [Winterfell repository](https://github.com/facebook/winterfell)
- [SP1 proof types](https://docs.succinct.xyz/docs/sp1/generating-proofs/proof-types)
- [SP1 Solidity verification](https://docs.succinct.xyz/docs/sp1/verification/solidity-sdk)
- [Ethereum light-client specification](https://ethereum.github.io/consensus-specs/specs/altair/light-client/light-client/)

Repository inspection of SP1 and other proof systems informed candidate selection. It was not
treated as executed Minima evidence.
