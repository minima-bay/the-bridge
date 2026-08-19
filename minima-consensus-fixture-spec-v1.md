# Minima consensus fixture package v1

Date: 2026-08-18  
Status: first observation rung, not a consensus verifier

## Purpose

Create reproducible mainnet observations for developing an independent Minima consensus verifier
without touching wallets or posting transactions. The first package tests RPC response integrity,
canonical parent continuity, displayed proof-of-work target consistency, and anchor survival.

It deliberately does not claim to recompute TxPoW IDs from consensus bytes. RPC JSON is not the
canonical binary serialization required by a real verifier.

## Capture surface

The collector uses only:

- `status`;
- `help command:txpow`;
- `help command:block`;
- `help command:printtree`;
- `block`;
- `printtree depth:64`;
- `txpow block:<height>`;
- `txpow onchain:<txpowid>`.

It signs nothing, posts nothing, changes no node setting, and reads no wallet command.

## Fixture ranges

The collector captures two contiguous ranges:

1. a recent range ending several blocks behind the observed tip;
2. a short range beginning at the live `status.chain.cascade.start` boundary.

The recent delay reduces shallow-tip instability but does not make the blocks final. The boundary
range is only a source observation for later Cascade work. It is not a proof that the captured
branch can never be displaced.

## Stored request record

Each request record contains:

- exact command;
- capture timestamp;
- semantic kind and requested height where applicable;
- raw HTTP response text;
- SHA-256 of those exact response bytes.

The validator reparses the raw response and recomputes every hash.

## Baseline checks

- fixture schema and declared safety boundary;
- initial and final node version agreement;
- successful response envelopes;
- exact requested and returned block heights;
- block and TxPoW flags;
- unique TxPoW IDs;
- valid displayed hexadecimal identifiers and targets;
- `txpowid <= header.blkdiff` as unsigned integers;
- the first compacted super-parent entry of height H expands to the immediate parent and equals the
  captured TxPoW ID at H-1;
- anchor lookup reports the same block ID and sufficient confirmations;
- a final height lookup still returns the captured anchor ID.

## Negative controls

The validator mutates copies in memory and must reject:

- changed raw bytes without a new response hash;
- wrong returned height;
- broken parent linkage;
- a TxPoW ID above its displayed target;
- duplicate TxPoW IDs;
- malformed hexadecimal identifiers;
- mismatched anchor identity.

These controls establish that the validator detects the consistency faults it claims to detect.
They do not test binary serialization, difficulty adjustment, fork choice, Cascade validation, or
MMR proof semantics.

The first execution of this validator deliberately failed on a naive assumption that an immediate
parent is always represented by an entry labelled difficulty zero. The preserved mainnet fixture
shows compacted entries such as `difficulty:1,count:2`, where the first entry still names the
immediate parent. The validator now checks the first compacted entry and leaves expansion semantics
for the later Core golden-vector rung.

## Next fixture rungs

1. Obtain version-pinned Core golden binary TxPoW and TxBlock vectors.
2. Recompute TxPoW IDs independently from those bytes.
3. Add exact difficulty and cumulative-work vectors.
4. Add competing-branch and Cascade transition vectors.
5. Add MMR construction and CoinProof vectors using public no-value coins.
6. Build the independent verifier against those vectors without calling a node for its verdict.

Any discrepancy between current node output, official documentation, and canonical Core vectors is
recorded and escalated. It is never resolved by guessing.
