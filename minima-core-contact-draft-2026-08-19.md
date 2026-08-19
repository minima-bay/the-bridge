# Draft public Core feasibility question

Status: archived, not posted, and not to be posted under `D-USDTM-016`.

Historical proposed channel: a public issue in `minima-global/Minima`. The founder subsequently
closed external Core contact and selected a stock-Core-only path.

## Proposed title

Feasibility question: bounded native ZK verification for light-client proofs

## Proposed issue body

We are researching a proof-only, two-way Ethereum and Minima bridge using valueless assets first.
The design does not permit a federation or off-chain signer to authorize settlement.

Our read-only probe of Minima 1.1.2.6 and source inspection of official Core commit
`52542f25605a28a776e9b3b43b0808a05dceab01` found:

- no native general ZK verifier in the KISS function registry;
- the current witness serializes signatures, input CoinProofs and ScriptProofs, with no generic proof
  witness collection;
- the hard limits remain 64 KiB per TxPoW and 1,024 KISS operations;
- `CHECKSIG` and MMR `PROOF` are available, but neither verifies an Ethereum light client or a
  general succinct proof.

Would Minima Core consider a deterministic, versioned and resource-bounded proof-verification
facility in consensus? The narrow proposal is an ephemeral proof witness committed by the signed
transaction, plus a predicate such as `VERIFYZK` that checks a pinned proof-system version, program
hash, verification-key hash and public-values hash. KISS would still control exact outputs.

The first questions are:

1. Is this architecture acceptable in principle, or is native proof verification outside Core's
   intended scope?
2. Would a witness extension, a KISS native function over bounded transaction data, or another
   consensus object be the preferred extension point?
3. Which proof system and curve are plausible in the current Java runtime, with deterministic cost
   on phone-class nodes?
4. What proof-byte, CPU, memory and per-block quotas would Core require?
5. Can Core publish canonical binary vectors for TxPoW, TxBlock, cumulative work, Cascade, MMR and
   fork selection so an independent verifier can be tested against consensus-owned fixtures?
6. If feasible, would Core run a cross-platform malformed-proof and worst-case transaction benchmark
   before considering activation?

The complete proposal and local evidence contain no token creation, deployment, signed transaction
or funds. We are asking for an architectural verdict before investing in the full bridge prover.

## What a useful answer closes

- `No, native verification is not planned`: stop the proof-only bridge path immediately and avoid
  months of implementation work.
- `Potentially, use this extension point`: build only the requested benchmark and integration spike.
- `An equivalent primitive already exists`: retarget the prototype to that exact versioned surface
  and prove it on multiple nodes.

Silence or informal interest is not a feasibility confirmation. The P7 gate needs a specific
technical direction and an executed bounded benchmark.
