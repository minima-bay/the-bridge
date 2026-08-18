# Winterfell SHA3 instrumentation notes

Pinned upstream commit: `2f78ee9bf667a561bdfcdfa68668d0f9b18b8315`

These notes record the instrumentation used for the 2026-08-18 feasibility run. They are a
reconstruction of the small source changes, not a byte-for-byte preserved patch. The temporary
instrumented checkout and raw console log were not retained, so the SHA3 counts must be repeated
before they are treated as independently reproducible evidence.

## Proof capture

In `examples/src/main.rs`, immediately after `let proof_bytes = proof.to_bytes();`, the runner wrote
the bytes when `WINTER_PROOF_OUT` was set:

```rust
if let Ok(path) = std::env::var("WINTER_PROOF_OUT") {
    std::fs::write(path, &proof_bytes).expect("failed to write proof bytes");
}
```

## SHA3 call counters

In `crypto/src/hash/sha/mod.rs`, five `AtomicUsize` counters using relaxed ordering were added for:

- `Hasher::hash`
- `Hasher::merge`
- `Hasher::merge_many`
- `Hasher::merge_with_int`
- `ElementHasher::hash_elements`

Each method incremented its counter exactly once at method entry. Two helpers reset all counters and
returned the five values. The helpers were re-exported through `crypto/src/hash/mod.rs` and
`crypto/src/lib.rs`.

Immediately before `example.verify(proof)`, the example runner reset the counters. Immediately after
verification, it printed the five values and their sum. Proof generation was therefore excluded
from the counts.

## Commands represented by retained proof files

Default profile:

```text
winterfell --hash_fn sha3_256 fib -n 1024
```

Stronger profile:

```text
winterfell --hash_fn sha3_256 --queries 64 --field_extension 2 fib -n 1024
```

The exact upstream source is retained as a shallow bare repository under `upstream/winterfell.git`.
The retained proof bytes and their SHA-256 sidecars are the durable artifacts. The timings and call
counts in the findings document are observations from the completed run and need a logged rerun for
independent reproduction.
