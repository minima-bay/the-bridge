# P9 WOTS guard status

Date: 2026-08-19

Status: partial local proof only. P9 remains `NOW`.

## Current safety disposition

The protected P8 fixture key domain is retired from all future signing. The live policy sets
`signingEnabled:false`, the legacy P8 and v2 live builders refuse build and post operations, and no
new signature is authorized. The external journal remains useful as a rollback detector for the
known current and stale counter states.

The retirement is mandatory because the first disposable stale-clone run opened Core RPC on a
wildcard interface without RPC authentication. The wrapper itself issued only `keys action:list`
and `quit`, but outside access was not excluded. Later runs authenticated RPC with an in-memory
random password, but Core still opened its Minima wire listener on wildcard port 19701. Those later
runs cannot repair the provenance gap in the first run. A future ceremony must use a fresh key
domain and an independently justified network-isolation and fencing design.

## External journal

Active location:

`C:\Users\Charles\Documents\Crypto\Minima\WotsGuards\BridgeTestSigners-P9`

The location is outside `BridgeTestSigners`, its data directory and every backup directory. The
current journal contains only the retired-policy genesis entry. Earlier policy journals were moved
to sibling `obsolete-*` directories and preserved. They are not current authority.

The active policy pins:

- the exact ordered seven-key committee, threshold 5 and committee root;
- both cancellation keys and the shared return-owner key;
- floors `[12,12,12,12,12,0,0]`, cancellation `[1,1]` and return owner `2`;
- TreeKey size 64, depth 3 and maximum uses 262144;
- a disabled live signing state.

## Locally proved behavior

The offline guard validator uses a synthetic enabled policy. It proves append-only canonical
journal records, hash chaining, a colocated trusted head, file flushes, local exclusive writers,
one-shot durable `SIGN_STEP` events, strict counter equality, exhaustion rejection, typed lifecycle
states, payload-field whitelists, crash faults and corruption detection. Every reservation advances
the minimum before signing. Every sign step is durably consumed before its callback can run.

The transaction-boundary validator uses dependency-injected fakes only. It binds the exact loaded
unsigned body before reserve and every sign step, uses the P8 explicit witness order, requires
nonempty exact token accounting, records `POST_ATTEMPT` before broadcast, blocks duplicate post
callbacks, binds post and negative reconciliation to the reserved custom transaction, transaction
body and expected settlement, and requires exact on-chain input, output, successor and confirmation
evidence.

The P8 witness exception is deliberate: these covenants exceed the wallet script-registry limit.
The proven order is `txnsign`, `txnmmr`, explicit `txnscript`, then `txncheck`, not `txnbasics`.

## Unresolved blockers

- A local lock cannot fence a copied journal or another host.
- Journal and head can be rolled back together without an independent monotonic or WORM anchor.
- Windows directory-entry fsync is not proved through Node.js.
- The real live constructor is locked, not integrated with a globally fenced guard.
- Clone verification needs an authorized measured isolation control for Core's wildcard wire port.
- Unknown-post retry still needs a trusted exact-chain reconciler in live operation.
- One fixture controls all seven keys, Ethereum facts are synthetic, no generic Minima consensus
  light client exists, and independent operator decentralization is unproved.

Do not clear a writer lock automatically, lower a counter, restore signing in this key domain, run
the clone wrapper, or re-enable a legacy live builder. Do not create a new key domain or signature
without a fresh authorization.

## 2026-08-20 production-shaped authority increment

`P9-COMPLETION-SPEC.md` now defines the missing deployment authority. The local guard exposes a
validated checkpoint, and `generic-bridge-p9-signing-authority.mjs` adds dependency-injected
interfaces for a global non-expiring operation fence, an independent compare-and-swap checkpoint,
a serialized strict command gateway and an anchored signing step held through exact counter
observation.

The new validator proves in an offline model that the independent checkpoint advances before the
conditional signing callback, one of two copied stores is fenced, local-ahead anchor failure blocks
signing, and transaction substitution before the final conditional check records a halt without a
signature. It also runs the complete existing lifecycle through check, post and exact confirmation.

This increment narrows the implementation gap but does not close it. The fence and anchor are fakes,
not deployed services. No operating-system network isolation, raw-RPC exclusion, live node or WOTS
signature is proved. P9 therefore remains `NOW`, the live policy remains disabled and the P8 fixture
key domain remains retired.

## 2026-08-20 selected deployment-admission increment

`P9-DEPLOYMENT-ARCHITECTURE.md` and `p9-deployment-profile.json` now freeze a provisional real
topology: a non-expiring Cloudflare Durable Object fence in one trust domain, and a separate AWS
DynamoDB conditional head plus S3 Object Lock compliance history in another. The profile remains
unassigned, design-only and disabled.

The strict admission module and validator pass 44 assertions and 36 hostile cases while keeping
`phaseGatePassed:false` and `authorizationGranted:false`. They reject expiring leases, automatic
stale recovery, shared rollback control, generic RPC, missing wildcard-listener probes, incomplete
chain sources, source-unbound observations and cleanup gaps. No provider service or live Minima
capability was exercised, so P9 remains `NOW` and the retired P8 domain remains unusable.
