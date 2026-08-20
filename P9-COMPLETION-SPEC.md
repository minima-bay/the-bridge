# P9 completion specification

Date: 2026-08-20

Status: implementation specification with an offline production-shaped authority model. P9 remains
`NOW` and does not pass from this document or its dependency-injected tests.

Authority: `USDTM-ZK-PROTOTYPE.md`. The current P8 fixture key domain remains permanently retired.
No fresh key domain, restored signer, node startup, signature, transaction or post is authorized by
this specification.

## 1. Objective

P9 must prove that restoring, copying or crashing a Minima signer cannot reuse a TreeKey/WOTS leaf,
silently lose a signing intent, sign a different transaction from the reserved transaction or create
two successors for one settlement.

The local guard already proves durable reservations and one-shot sign-step records within one
journal directory. P9 completion adds the missing deployment-level authority:

1. one globally exclusive signing domain for every seed;
2. a monotonic checkpoint outside every node, backup and local journal rollback domain;
3. a strict command gateway that is the only route to the signing RPC;
4. exact transaction rebinding immediately before a conditional signing operation;
5. measured network isolation for all ordinary and restored signer nodes;
6. exact chain reconciliation before retry after an ambiguous post.

## 2. Threat model

The design must fail closed against:

- a stale node backup with lower WOTS counters;
- two live copies of the same seed on one or several hosts;
- two copies of the local journal and matching local head;
- rollback of the node and its local guard store together;
- crash before, during or after every journal, anchor, sign, check, post and confirmation boundary;
- a transaction changed after reservation or immediately before `txnsign`;
- a signing RPC reachable without the guard;
- a lease that expires while a sign command is in progress;
- accepted broadcast followed by response loss;
- operator error that attempts to clear a lock, lower a counter or rebuild an unresolved settlement.

An administrator able to replace the global fencing service, independent anchor and signer gateway
at once remains a governance and infrastructure trust boundary. It must not be hidden as a local
filesystem guarantee.

## 3. Required topology

```text
coordinator or relayer
        |
        | structured intent only
        v
attestor signing authority
  |-- global non-expiring operation fence
  |-- independent monotonic or WORM checkpoint
  |-- local append-only WOTS journal
  |-- exact transaction binder
  |-- strict serialized command gateway
        |
        | private authenticated transport only
        v
isolated Minima signer node
```

The coordinator has no raw node RPC credential or network path. The Minima signer node accepts
commands only from its local or private signing gateway. A restored node is observation-only until
the same global authority explicitly activates it after the prior signer is proved stopped.

## 4. Global fence requirements

The fencing authority is scoped to one immutable signer or seed domain. It must provide:

- linearizable exclusive acquisition across every host and restored copy;
- monotonically increasing fencing tokens;
- no automatic expiry while a protected operation is executing;
- acknowledged revocation before the authority can reassign the signing domain;
- durable audit records for acquisition, release, revocation and administrative recovery;
- a fail-closed result during partition or uncertainty;
- authenticated clients and a policy preventing coordinators from acquiring signing authority.

A normal TTL lease is insufficient. If it expires during `txnsign`, a second host may acquire the
domain while the old host is still signing. Either the authority owns the sole signing gateway as a
non-clonable service, or lease revocation must be enforced by the gateway before reassignment.

The local `writer.lock` remains useful for filesystem serialization but is not the global fence.

## 5. Independent monotonic checkpoint

Every durable local journal state is represented by:

```text
guardId
policyHash
lastSeq
lastHash
journalBytes
```

The independent anchor must:

- live outside all node, backup and local journal rollback domains;
- initialize exactly once for one policy and signer domain;
- compare and swap the exact prior checkpoint to the exact next checkpoint;
- reject stale fencing tokens;
- make deletion, truncation or alternate reinitialization independently detectable;
- durably commit before the signing RPC becomes callable;
- retain an auditable history or WORM record of checkpoint advancement.

A hash-chained local journal and colocated head do not satisfy this requirement. Rolling both back
to an older valid pair otherwise creates an undetectable alternate history.

If the local journal advances but the external checkpoint does not, the domain enters
`LOCAL_JOURNAL_AHEAD_ANCHOR`. No signature is made and no automated repair or retry is permitted.
Recovery must prove which local event was durably written and either advance the anchor to that exact
event or retire the signer domain.

## 6. Exact signing sequence

For every key in the ordered signer set:

1. Acquire the global signer-domain fence.
2. Verify that the local journal checkpoint equals the independent checkpoint.
3. Load the named custom transaction and recompute its transaction ID and canonical unsigned-body
   digest.
4. Observe every protected TreeKey counter and validate the exact expected prefix.
5. Append and flush one `SIGN_STEP` for the exact intent, transaction, ordered key set and next key.
6. Advance the independent checkpoint by compare and swap while the same fence is held.
7. Rebind the exact loaded transaction.
8. Invoke a serialized conditional signing operation that rechecks the exact custom transaction,
   transaction ID and unsigned-body digest inside the sole command gateway before calling
   `txnsign`.
9. Observe counters again. Exactly the selected key advances by one and every other key is unchanged.
10. Release the global fence.

The sign step permanently retires the reserved leaf before step 8. If signing fails without a
counter increment, that leaf is still never reused.

The gateway must serialize every operation that can create, mutate, sign, delete or post a custom
transaction. If raw RPC remains reachable, the conditional signing guarantee is only procedural and
P9 cannot pass.

## 7. Whole-transaction sequence

The recovery-safe order is:

```text
verify exact unsigned shape
acquire global fence and reserve all leaves
anchor reservation
for each signer: anchored one-shot conditional sign
observe exact counters and commit
txnmmr
explicit txnscript witnesses
strict txncheck normalization
record CHECK result
record and anchor POST_ATTEMPT
broadcast the already signed transaction
record ACCEPTED, DEFINITE_REFUSAL or UNKNOWN
reconcile exact inputs, outputs and transaction identity
confirm exact mined successor
```

The P8 explicit witness exception remains deliberate. The tested covenant scripts exceed the wallet
script-registry limit, so the candidate uses `txnmmr` plus explicit `txnscript` witnesses rather than
silently substituting `txnbasics`.

No rejected or unknown transaction is rebuilt under the same signing intent. A definitively rejected
settlement may create an explicit superseding intent using fresh leaves. An unknown post never
authorizes rebuilding or reposting until exact-chain reconciliation proves a safe terminal state.

## 8. Strict command gateway

`generic-bridge-p9-signing-authority.mjs` introduces a structured allowlist. The modeled gateway
allows only named operations with exact identifiers. It rejects arbitrary commands such as sends,
key creation or user-supplied command strings.

The production implementation must additionally:

- keep RPC passwords and transport credentials out of command lines and logs;
- authenticate and encrypt non-local transport;
- serialize all custom-transaction mutations and signing calls;
- recompute transaction bindings from node output, not caller assertions;
- project key-list output immediately to protected public keys, shapes and counters;
- avoid persisting raw wallet responses or sensitive node configuration;
- expose no generic command passthrough;
- make post and confirmation adapters return typed documented values only.

## 9. Network isolation

Pinned Core opens its base wire listener on a wildcard interface even with `-nop2p`. RPC may also
bind broadly. Node flags alone therefore do not establish isolation.

Before any future restored-node test, the harness must:

1. create an exact temporary host or VM firewall policy for the chosen base and RPC ports;
2. allow only the signing gateway and local verification client;
3. read back the effective policy;
4. observe the actual listeners and interfaces;
5. probe from an independent network namespace or host and prove inbound denial;
6. use a random in-memory RPC password and authenticated requests;
7. record the exact process, jar hash, launch flags and ports;
8. stop the exact child process and prove all listeners closed;
9. remove only the validated disposable clone after shutdown;
10. persist cleanup and isolation evidence after cleanup, not before it.

Until this is implemented and independently reviewed, the clone runner must remain locked before
startup.

## 10. Unknown-post reconciliation

A timeout is not a refusal. A live reconciler must query by the exact transaction ID and validate:

- canonical-chain membership and the required confirmation policy;
- mempool presence or absence;
- the exact predecessor input coin IDs;
- the exact predicted output IDs and complete output bodies;
- conflicting spends of any predecessor;
- validity-window expiry;
- a concrete chain anchor and complete bounded search policy.

Only one of these outcomes is safe:

- exact transaction confirmed;
- exact transaction pending, so wait;
- conflicting successor, so halt and adjudicate;
- definitively never settled after expiry, permitting an explicit fresh superseding intent;
- unknown, so halt without reposting or rebuilding.

## 11. Current offline implementation

The following local components now exist:

- `WotsWriteAheadGuard.checkpoint()` exposes a validated local checkpoint;
- `FencedAnchoredWotsAuthority` wraps every guard mutation with a declared global fence and an
  independent compare-and-swap checkpoint;
- `executeSigningStep()` holds that fence across rebinding, anchored `SIGN_STEP`, conditional
  signing and exact post-sign counter observation;
- `StrictMinimaOperationGateway` serializes its allowlisted operations and rejects generic command
  passthrough;
- `RecoverySafeTransactionLifecycle` automatically uses the guarded execution method when the guard
  provides it;
- `validate-generic-p9-signing-authority.mjs` exercises these interfaces with shared dependency-
  injected fakes;
- `ExactMinimaChainReconciler` derives confirmation and definitive non-settlement from one consistent
  typed chain-source interface, and the lifecycle can record only the resulting exact proof;
- `validate-generic-p9-chain-reconciler.mjs` rejects inconsistent, incomplete, pending, spent,
  conflicting and weak-source negative claims.

This is production-shaped code, not a deployed authority. A fake that declares the required
capabilities cannot prove a real service is linearizable, non-expiring, independently durable or
network isolated.

## 12. Required hostile acceptance cases

Before P9 can pass, tests must cover:

- simultaneous reserve and sign attempts from two hosts and two copied stores;
- crash after local append but before external checkpoint;
- crash after external checkpoint but before node signing;
- crash after the node increments the counter but before returning;
- fence loss before and after conditional signing;
- attempted lease expiry and reassignment during a blocked signing call;
- local journal and head rollback together;
- independent checkpoint rollback, deletion and alternate initialization;
- transaction mutation before reservation, before every signer and inside the conditional gateway;
- unchanged, incremented, jumped, missing and duplicate counters after every signer;
- direct raw RPC attempts from coordinator, LAN and restored-node environments;
- accepted broadcast with lost, malformed or contradictory response;
- exact confirmation, conflicting successor and definitive non-settlement;
- shutdown failure, stale process, remaining listener and failed clone cleanup.

Every failure must leave each reserved leaf permanently retired and must not create a second
successor.

## 13. P9 exit evidence

P9 passes only when all of the following exist:

1. a real globally consistent signer-domain authority or non-clonable sole signing gateway;
2. a real independent monotonic or WORM checkpoint service;
3. a production-equivalent strict node adapter with no reachable raw signing path;
4. measured and independently reviewed network isolation;
5. exact live-chain reconciliation for ambiguous posts;
6. hostile multi-process and multi-host results;
7. a separately authorized fresh valueless key domain proving stale restore rejection and one safe
   end-to-end transition;
8. post-run evidence that every node stopped, every test listener closed and every disposable clone
   was safely removed.

The future live ceremony is the final evidence rung, not the next coding action. It must not be
authorized until items 1 through 6 pass without using any live key.
