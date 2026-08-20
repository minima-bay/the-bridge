# P9 deployment architecture candidate

Date: 2026-08-20

Status: selected provider candidate and offline admission contract. P9 remains `NOW`.

This document turns the abstract P9 authority into one deployable candidate. It does not create any
cloud resource, account, credential, firewall rule, node, key or signature. The checked-in profile
is deliberately `design` stage with activation `disabled`.

## 1. Selected two-domain topology

```text
coordinator
    |
    | private mTLS, structured operations only
    v
single-purpose attestor gateway in an isolated guest
    |                 |                         |
    |                 |                         |
    |                 |                         +--> canonical Minima chain source
    |                 |
    |                 +--> independent checkpoint domain
    |                      AWS DynamoDB conditional head
    |                      + S3 Object Lock compliance history
    |
    +--> global signer-domain fence
         one Cloudflare Durable Object per signer domain
    |
    +--> loopback authenticated RPC
         isolated Minima signer node
```

The fence and checkpoint must use different providers, accounts, credentials and administrative
operators. Neither may share a rollback or backup domain with the node, gateway or local journal.
The signer node has no coordinator-facing or LAN-facing RPC path.

## 2. Why these provider candidates

Cloudflare documents a Durable Object as a globally unique, single-threaded coordination point with
private, persistent, transactional and strongly consistent storage. That is a suitable primitive
for one signer-domain state machine and monotonic fencing counter. The Bridge must still implement
its own non-expiring operation semantics: an active signing operation has no TTL and cannot be
reassigned merely because a process or network connection becomes old.

AWS documents S3 Object Lock as write-once-read-many storage. In compliance mode, a protected
object version cannot be overwritten or deleted even by the account root user during retention.
DynamoDB conditional expressions provide the mutable compare-and-swap head. The two services are
combined because an immutable history alone does not provide a convenient exact head CAS, and a
mutable head alone does not provide rollback-resistant retained history.

These are provisional technical selections, not commercial endorsements or production approval.
Before deployment, account ownership, billing, region, outage, data-retention, legal and operator
independence questions remain explicit review items.

Official capability references:

- [Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/what-are-durable-objects/)
- [Cloudflare transactional storage API](https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/)
- [Amazon S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
- [Amazon DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)

Provider documentation establishes candidate feasibility only. Measured hostile deployment evidence
must establish the properties relied on by The Bridge.

## 3. Global fence state machine

There is one Durable Object identity derived from `SHA-256(signerDomain)`. Its durable record contains:

```text
signerDomain
policyHash
fencingToken
state = FREE | ACTIVE | RECOVERY_BLOCKED | RETIRED
operationId
gatewayIdentityDigest
startedAt
lastAcknowledgedCheckpoint
auditSequence
auditHead
```

Rules:

1. `FREE -> ACTIVE` increments the fencing token exactly once.
2. `ACTIVE` has no automatic expiry.
3. Only the bound gateway identity may assert or release the active operation.
4. A lost or uncertain gateway becomes `RECOVERY_BLOCKED`, never automatically `FREE`.
5. Reassignment requires proof that the old gateway and node are stopped, or permanent retirement
   of the signer domain.
6. Administrative recovery is append-only, attributable and cannot lower the fencing token.
7. A partition, ambiguous response or capability mismatch fails closed.

The Durable Object is not permitted to hold Minima secrets or raw RPC credentials.

## 4. Independent checkpoint protocol

Each local journal transition uses `prepare-cas-commit/v1` while the same global fence is held:

1. Validate that local journal, DynamoDB head and the latest committed immutable record agree.
2. Write an immutable S3 `PREPARE` object containing the exact prior checkpoint, next checkpoint,
   signer domain, policy hash, fencing token and operation ID.
3. Advance the DynamoDB head with a conditional write requiring the exact prior checkpoint and
   fencing token.
4. Write an immutable S3 `COMMIT` object binding the accepted head version and `PREPARE` digest.
5. Strongly reread the DynamoDB head and both immutable objects.
6. Only then may the gateway call a transaction mutation or signing operation.

Crash handling is intentionally conservative:

- `PREPARE` without CAS leaves the prior checkpoint authoritative and requires reconciliation;
- CAS without `COMMIT` leaves the external head ahead and blocks signing until the exact immutable
  commit record is completed or the signer domain is retired;
- a stale fencing token, alternate genesis, missing history, overwrite attempt or paired local
  journal rollback is terminal for automatic operation.

No repair may invent a checkpoint or lower a sequence.

## 5. Strict signing gateway

The coordinator sends typed requests, never Minima command strings. The selected profile fixes the
complete operation allowlist. Unknown fields and operations reject.

The gateway must:

- serialize every custom-transaction creation, mutation, witness, check, post and deletion;
- recompute the exact custom transaction ID, transaction ID and canonical unsigned-body digest
  inside the gateway immediately before `conditional-txnsign`;
- require the active fencing token and externally committed checkpoint;
- expose only protected key counters, never raw wallet output;
- use a random per-process RPC password held in memory and absent from process arguments and logs;
- record `POST_ATTEMPT` before broadcast and reconcile unknown outcomes before any retry;
- reject deletion unless exact confirmation or definitive non-broadcast is proved;
- expose no general RPC proxy, shell, `send`, key creation, seed, restore or arbitrary `txn*` route.

The existing `StrictMinimaOperationGateway` remains an offline model. A production gateway must
implement the complete allowlist in `p9-deployment-profile.json` and be the only network principal
able to reach node RPC.

## 6. Network isolation

Pinned Minima Core opens the base wire listener on a wildcard interface, including with `-nop2p`.
The deployment therefore assumes the listeners exist and contains them with an isolated disposable
guest and default-deny ingress.

Required measured sequence:

1. Create the guest and exact default-deny network policy before copying node data.
2. Allow node RPC only from the local signing gateway; allow no node-wire peer for the isolated test.
3. Read back the effective policy.
4. Start the exact child with random in-memory RPC authentication.
5. Observe every listening port and interface.
6. From an independent host or namespace, prove both wire and RPC denial.
7. From the gateway, prove only the required authenticated RPC route works.
8. Stop the exact child and prove every listener closed.
9. Remove only the validated disposable guest or clone.
10. Persist the cleanup evidence after cleanup completes.

The current locked clone wrapper must not be re-enabled to approximate this topology.

## 7. Chain-source admission

The P9 chain source must provide one consistent canonical view for:

- exact transaction lookup and confirmation depth;
- mempool presence;
- predecessor input existence and spend status;
- predicted output existence and exact bodies;
- conflicting successor spends;
- validity-window expiry;
- a concrete chain anchor and complete-search statement.

Explorer results, bounded address searches and caller-supplied booleans do not satisfy this contract.
The open confirmation and late-fork policy under `O-USDTM-008` remains a prerequisite for declaring
definitive non-settlement.

## 8. Checked-in admission contract

The implementation consists of:

- `p9-deployment-profile.json`: the disabled, unassigned selected-provider design;
- `generic-bridge-p9-deployment-admission.mjs`: strict profile and measured-probe admission;
- `validate-generic-p9-deployment-admission.mjs`: offline positive and hostile cases.

The validator rejects:

- any TTL or automatic stale-operation reassignment;
- shared provider-account or operator rollback domains;
- mutable-only or non-compliance checkpoint history;
- generic command passthrough or incomplete operation allowlists;
- raw coordinator or LAN RPC reachability;
- ignored wildcard listeners or missing external denial probes;
- incomplete chain-source capabilities;
- secret-bearing or field-smuggled profiles and observations;
- multiple fence winners, undetected paired rollback, incomplete cleanup or any unauthorized
  signature or transaction.

A complete synthetic probe returns
`DEPLOYMENT_CONTROLS_OBSERVED_AUTHORIZATION_STILL_REQUIRED`. It cannot set `phaseGatePassed:true`
or authorize a live action.

## 9. Deployment stages

1. `DESIGN`: current stage; providers selected, identifiers unassigned, activation disabled.
2. `ASSIGNED`: separate accounts and operators identified by public digests; still disabled.
3. `OFFLINE HOSTILE`: real fence, checkpoint and gateway tested with synthetic node adapters.
4. `MEASURED ISOLATION`: separately authorized disposable guest run, no WOTS signature.
5. `AUTHORIZATION REVIEW`: independent hostile review of exact source and evidence.
6. `VALUELESS CEREMONY`: only after a new explicit founder authorization and a fresh key domain.

No stage automatically advances the next one.

## 10. Current result and next implementation

This slice selects an implementable two-domain architecture and makes unsafe configuration fail
closed before deployment. It does not prove either provider, the gateway, isolation or chain source
in operation. P9 remains `NOW`, the P8 key domain remains retired, and production remains prohibited.

The next coding slice is the real Cloudflare fence service and a provider-independent conformance
harness. The AWS checkpoint adapter follows, then the strict local gateway. No Minima node is needed
for those first three slices.
