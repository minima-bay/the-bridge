# USDTm P3 reference state machine

Status: local reference gate passed. This is a chain-independent model, not an EVM, KISS, proof or
consensus implementation.

## Transition rule

`apply(predecessor, action)` clones the predecessor, validates and applies the complete action to the
clone, checks every invariant, and returns that immutable successor. Any exception discards the
clone, so rejection cannot mutate the caller's state.

The modeled actions are deposit, same-block deposit batch, client update, release, cancellation,
refund, return, redemption payout, same-block redemption payout batch and cumulative payout
acknowledgement. Release and cancellation consume independent tagged nullifier leaves, so valid
records may settle out of order without a global nonce lane.

## Invariants

```text
usedCapacity = accepted - refunded - paid
0 <= usedCapacity <= F - 1
R > 0
R + I = F
I + P <= L
0 <= payoutCursor <= source payout count
0 <= acknowledgedPaid <= source cumulative paid
REFUNDED implies canonical CANCELLED on the modeled history
```

Returned coins bind the exact token ID, coin ID, amount and recipient-derived canonical redemption
ID. Payout records are consumed once. Proof-bearing transitions bind the exact current source
version, vault balance and cumulative payout state.

## Tagged sparse nullifier accumulator

The accumulator is a depth-256 sparse SHA2-256 tree keyed by the raw 32-byte message ID. A non-empty
leaf is `SHA2-256(0x00 || messageId || statusByte)`, where status 1 is `RELEASED` and status 2 is
`CANCELLED`. Internal nodes are `SHA2-256(0x01 || left || right)`. Empty hashes are recursively
precomputed from `SHA2-256(0x00 || ZERO32 || 0x00)`. Map insertion order therefore cannot change the
root, while changing the status tag must change it.

## Executed local gate

`usdtm-p3-reference.mjs` executes 64 deterministic seeds of 128 steps each, plus focused same-block,
out-of-order and crash/retry scenarios. It checks every rejected fuzz action against the complete
predecessor digest and deliberately breaks ten guards. This bounded fuzzing is reproducible evidence,
not an exhaustive proof over all sequences.
