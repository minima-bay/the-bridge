# P6 Ethereum committee, bond and reward contract specification

Date: 2026-08-20

Status: offline implementation specification. No contract is deployed and no production parameter
is selected.

Authority: `USDTM-ZK-PROTOTYPE.md`, `canonical-bridge-attestor-framework-discussion-v1.md` and the
still-open founder decisions `O-USDTM-012`, `O-USDTM-013` and `O-USDTM-015`.

## 1. Purpose

This specification converts the attestor governance and economics discussion into separable
Ethereum contract responsibilities. It deliberately does not create one administrator-controlled
contract that can change membership, seize bonds, raise exposure and distribute claims.

Version 1 should contain eight narrowly scoped components:

1. committee roster registry;
2. bond custody vault;
3. aggregate exposure controller;
4. fee and reward treasury;
5. objective work-epoch recorder;
6. finalized work-reward index;
7. objective fault adjudicator;
8. claim distributor.

The existing immutable ERC-20 and native-asset lane vaults remain principal custody. None of the six
components may withdraw lane principal.

## 2. Common identities

Every committee epoch binds:

```text
bridgeId
epoch
ordered seven member identities
ordered Ethereum bond/accountability addresses
ordered Minima signing public keys
ordered operational evidence commitments
threshold
equal bond amount
bond asset identity
minimum attestor self-bond basis points
epoch reward index address
work-epoch recorder address
work-reward index address
individual and mutual tranche basis points
exposure safety basis points
policy hash
dossier root
activation delay
challenge period
exit delay
```

The epoch ID is a domain-separated hash of the canonical encoding and the Ethereum chain and registry
deployment. A member acceptance for another chain, deployment, order, key or policy is invalid.

## 3. Committee roster registry

### Required states

```text
PROPOSED -> ACCEPTED_BY_ALL -> ACTIVE -> RETIRING -> RETIRED
          -> WITHDRAWN before activation
```

### Rules

- The proposed roster contains exactly seven unique identities and a threshold of five in the
  benchmark configuration.
- Every member accepts the same complete epoch ID.
- Any member may withdraw acceptance before activation.
- Activation requires all seven acceptances, all equal bonds confirmed, the cooling period expired
  and no conflicting active epoch.
- Anyone may execute a fully satisfied activation. No privileged coordinator is necessary.
- A member cannot exit an active epoch immediately.
- A replacement epoch cannot erase the liability, challenge or slashability of its predecessor.
- The active and retiring epochs remain queryable forever.

No function may let a majority silently replace one member, reorder keys or alter the policy hash
inside an already accepted proposal.

## 4. Bond custody vault

### Separation

The bond vault holds only attestor stake. It does not hold:

- lane principal;
- protocol fees;
- the fee-funded safety reserve;
- public insurance deposits;
- relayer reimbursements.

### Equal bond rule

Every active member posts exactly the epoch's equal bond amount in the exact bond asset. Borrowed,
delegated or externally indemnified ownership remains a diligence concern even if the transfer is
valid onchain.

Each bond is accounted as:

```text
individual tranche + mutual tranche = total equal bond
```

The illustrative review model uses 80% individual and 20% mutual. The final values are not selected.

### Open delegated security pools

`D-USDTM-026` permits voluntary public security deposits behind one chosen approved attestor. These
deposits are not bridge principal and never alter the canonical 1:1 reserve. The attestor retains a
minimum self-bond that delegated capital cannot replace. Public capital grants no signing,
committee-admission or transfer-control right.

Initial positions are non-transferable internal accounting. Depositors share only the security-fee
allocation and accept disclosed slashing risk for their chosen pool. Withdrawal remains absent until
an asynchronous request can remain slashable through every liability, evidence, challenge and claim
window. Exact self-bond, fee, reward-index and withdrawal parameters remain open.

### Withdrawal rule

Withdrawal requires all of:

- the epoch accepts no new liability;
- a replacement epoch is active if the bridge continues;
- all liability secured by the epoch is zero or transferred through a proved continuity rule;
- every attestation expiry and fraud challenge has passed;
- every pending claim or adjudication is resolved;
- the exit delay has passed.

No emergency, owner or upgrade function may bypass these conditions.

## 5. Aggregate exposure controller

For equal bond `b`, quorum `q` and safety factor `alpha`:

```text
maximum aggregate liability = floor(b * q * alphaNumerator / alphaDenominator)
```

The controller tracks aggregate liability across every lane secured by the same committee. A lane
vault requests an increase before accepting new liability and releases liability only after exact
refund or completed redemption.

Required invariants:

- the same bond is never counted independently for two lanes;
- a committee cannot raise its own safety factor or cap;
- inactive, retiring, underbonded or unresolved-slash epochs cannot accept new liability;
- a stale price cannot increase a multi-asset cap;
- cap failure reverts the complete deposit and fee collection;
- pause blocks new liability but never blocks a valid refund or redemption.

Multi-asset valuation remains an open decision. Version 1 should prefer isolated bond pools unless a
conservative common valuation rule is independently approved.

## 6. Fee and reward treasury

### Required ledgers

```text
attestor reward pool
fee-funded safety reserve
relayer and prover budget
operations and audit budget
bootstrap security treasury
```

Every deposit quote separates principal, protocol fee and network cost. The lane vault routes fee
atoms to the treasury only if the liability transition succeeds.

The illustrative protocol-fee allocation is:

- 50% attestor pool;
- 20% safety reserve;
- 10% relayers and provers;
- 20% operations, audits and development.

The illustrative attestor-pool allocation is:

- 60% readiness;
- 25% timely valid participation;
- 15% time-weighted bonded risk.

These values are constructor or immutable epoch parameters in a prototype, not hard-coded production
decisions.

### Reward neutrality

- A timely valid approval and timely valid rejection receive equal participation weight.
- Invalid, late, missing or malformed decisions receive no participation weight.
- Reaching five signatures does not remove readiness or risk pay from the other active members.
- Settlement-related pay accrues only after exact confirmation.
- Rewards remain challengeable until the epoch reward-finality delay expires.
- A culpable member forfeits unpaid affected rewards.
- Integer rounding remains in the isolated reward pool and is never taken from principal.

### Security runway

```text
security runway = available nonprincipal security funds / minimum epoch security budget
```

If runway is below the published minimum, the exposure controller rejects new liability. Redemption,
return and refund remain open.

## 7. Objective fault adjudicator

The adjudicator accepts only canonical public evidence for enumerated fault programmes, such as:

- equivocation over the same lane, epoch and settlement identity;
- attestation to a nonexistent immutable Ethereum vault record;
- wrong chain, vault, lane, asset, amount, recipient or epoch;
- replay of a consumed settlement identity;
- authorization above the onchain cap;
- a destination transaction different from the attested transaction.

Temporary downtime, alleged negligence, censorship and ambiguous reorg judgement are not automatic
catastrophic slash programmes.

Every programme has an immutable verifier address or code hash, canonical evidence schema, challenge
period and exact slash rule. No administrator may submit an arbitrary percentage or arbitrary
culprit list.

### Blocking signature-attribution problem

Ethereum must objectively bind the evidence to the Minima TreeKey/WOTS signer whose bond is held.
Until Ethereum can verify the exact WOTS authorization or an inseparable Ethereum-verifiable
accountability signature, the production adjudicator cannot safely identify a culpable bonded
member.

A mock verifier may be used for local interface testing only. It must be named and reported as a
mock and may never become production authority by configuration accident.

The current local verifier implements two narrow programmes:

1. same-request EIP-712 accountability equivocation, proved by opposite signatures from the same
   roster member over the exact chain, verifier, recorder, roster, request and request digest;
2. contradiction with an opposite finalized result returned by one immutable fact-source adapter.

Programme 1 is self-contained for the EIP-712 identity. Programme 2 inherits the fact source's trust
and proof quality. Neither proves that the EIP-712 signer created the corresponding Minima WOTS
authorization until both signatures are made inseparable in the fund-moving protocol.

## 8. Slash distribution

For an objective individual fault:

1. slash only the culprit's individual accountability tranche according to the programme;
2. remove or suspend that member;
3. pause new liability if active membership or bond falls below policy;
4. preserve every other member's individual and mutual tranche.

For an objective successful quorum fraud causing covered loss:

1. slash culpable individual tranches;
2. slash culpable mutual tranches;
3. if policy conditions require it, apply one equal limited mutual slash to every epoch member;
4. use the fee-funded safety reserve;
5. use a separately approved insurance layer, if any;
6. record uncovered loss.

An honest non-signer's individual tranche is never used for another member's fraud. The total mutual
loss of any member cannot exceed that member's precommitted mutual tranche.

Any bond recovery beyond the exact covered claim goes to a disclosed penalty or safety ledger, not
to principal custody or an administrator.

## 9. Claim distributor

The distributor receives a finalized adjudication containing:

```text
claimId
affected lane
affected settlement IDs
recognized loss
culprit set
individual slash amounts
mutual slash amount per member
safety-reserve amount
claimant root
claim deadline
```

It uses pull-based claims with replay protection. It cannot alter the adjudication or draw from lane
principal. Unclaimed funds follow a predeclared rule after the deadline and cannot be swept by a
general administrator.

## 10. Administration and upgrades

The safest version 1 contracts are immutable and narrowly parameterized. If an upgrade path is later
selected, it requires:

- an explicit founder governance decision;
- delayed activation;
- public code hash and configuration commitment;
- independent review;
- user exit time;
- no retroactive change to bonds, fault programmes, claims or liability;
- no proxy administrator capable of moving principal or bonds.

A pause role may stop new liability only. It cannot release principal, clear nullifiers, forgive a
slash, shorten exit or redirect rewards.

## 11. Local implementation order

1. Implement and test the immutable roster state machine without money.
2. Implement a bond-vault interface using a mock valueless bond token.
3. Implement aggregate exposure across two mock lane vaults.
4. Implement fee separation, reward accrual and security-runway pause.
5. Implement objective readiness and approve-or-reject records with challenge-delayed finalization.
6. Consume finalized work weights into separate readiness and participation indices.
7. Implement mock objective-fault programmes and the exact slash waterfall.
8. Replace fixture evidence with verifier-derived production evidence.
9. Integrate the existing ERC-20 and native vaults only after the interfaces survive hostile review.
10. Fuzz every transition and compare results with
   `canonical-bridge-attestor-economics-model.mjs`.
11. Keep all EVM execution local until a separate deployment authorization exists.

## 12. Required hostile tests

- duplicate, missing, reordered and remapped roster members;
- partial acceptance, withdrawal before activation and attempted withdrawal after activation;
- unequal, wrong-asset, fee-on-transfer and borrowed-bond representations;
- cap double counting across lanes;
- fee collection when the principal transition reverts;
- principal withdrawal through every bond, fee, slash and claim function;
- approval-only reward bias and first-five reward capture;
- integer rounding and zero-weight reward epochs;
- runway exhaustion with redemption still open;
- subjective evidence submitted as an objective fault;
- foreign-chain, foreign-epoch, foreign-lane and foreign-transaction slash evidence;
- duplicated claim and slash execution;
- honest individual tranche touched by another member's fault;
- mutual slash above its committed limit;
- exit before liability, challenge or claim completion;
- reentrancy and callback failure in bond, reward and claim transfers;
- malicious token return values and balance-delta behavior;
- upgrade, pause or administrator route to principal or bond seizure.

## 13. Current evidence boundary

`canonical-bridge-attestor-economics-model.mjs` and its validator provide an integer-only executable
reference. The current run passes 416 assertions, four hostile scenarios and 100 randomized accounting
steps. It proves internal consistency of illustrative rules only.

The moneyless `AttestorRosterRegistryV1` implements the first local step. Seven source-bound EVM
tests cover exact unanimous acceptance, opt-out, activation delay, immutable roster commitment and
an exact-roster bond-readiness interface.

`AttestorBondVaultV1` implements the second local step as one-way custody. Eight source-bound EVM
tests cover self-consistent roster registration, exact equal bonds, complete 80/20 tranche
partition, current aggregate custody coverage, seven-member readiness, unsolicited balances,
fee-on-transfer and malformed token behavior, no-return compatibility and callback reentrancy. Its
ABI deliberately has no withdrawal, slash, sweep, rescue, owner, administrator or upgrade route.

Six additional focused tests cover the `D-USDTM-026` delegated-security decision. A public
contributor can back one chosen member, but delegated capital cannot consume the illustrative 30%
self-bond capacity. A pool becomes ready only at the full equal bond with the minimum self-bond
present. Positions remain internal, non-transferable and one-way.

`AttestorExposureControllerV1` implements the third local step for exactly two committed lane
callers. Seven tests cover one shared discounted quorum-bond cap, cross-lane replay protection,
inactive and underbonded rejection, lane-isolated release and release liveness while new exposure is
blocked. The current lanes are disposable forwarders, not the P4 vaults.

`AttestorFeeRewardTreasuryV1` implements the next local one-way rung. Eight focused tests bind fees
to the exact controller-confirmed lane and settlement, preserve lane principal, split the complete
fee into isolated attestor, safety, relayer and operations ledgers, subdivide the attestor pool into
readiness, participation and bond-risk ledgers, reject cross-lane replay, and calculate an
asset-specific security runway from attestor fees plus bootstrap security funding. Atomic cap
failure, fee-on-transfer, false-return, no-return, reentrancy and integer rounding are covered. The
bond-risk ledger is reserved for eventual self-bonder and delegated-depositor sharing, but no
per-account claim exists yet.

`AttestorEpochRewardIndexV1` now indexes that bond-risk ledger per roster epoch. The roster commits
the exact index, the bond vault checkpoints contributor reward debt before any balance change, and
only the bound treasury can add a confirmed reward. Each full member pool receives an equal
bond-risk allocation, then a reward-per-share accumulator divides it between the member self-bond
and voluntary depositor capital. Two fee assets remain independent. Repeated fee events accumulate,
and indivisible member or per-share rounding remains unclaimed in treasury custody. Eight focused
tests cover authorization, equal-member neutrality, 30/35/35 proportional sharing, cross-asset
isolation, repeated rewards, rounding and rollback on insufficient live bond custody.

`AttestorWorkEpochV1` adds the next local, non-custodial rung. The roster commits one exact recorder.
Members can submit one readiness heartbeat per fixed window only while the roster is active and all
bonds are posted. Either exact controller lane can register a unique request and decision deadline.
All seven members can submit one timely `APPROVE` or `REJECT`, with both choices receiving equal
participation weight. An immutable verifier alone can validate a challenge, which removes exactly
one participation unit. After the full challenge delay, anyone can freeze the ordered readiness and
participation totals in a domain-separated finalization digest.

`ObjectiveDecisionVerifierV1` now requires every participation record to carry the member's EIP-712
accountability signature, bound to chain, verifier, work recorder, roster, request, request digest
and decision. Two opposite signatures from the same member for that exact domain prove equivocation
without an external fact oracle. The finalized-fact-contradiction programme accepts only the
opposite result returned by one immutable fact source. The local source is explicitly mutable and
mocked; it verifies no source-chain consensus. The recorder hash-chains each accepted heartbeat,
request, signed decision and successful challenge, and finalization commits that ordered history,
record counts and member weights. Twelve focused tests cover exact bindings, timing, neutrality,
accountability signatures, hostile fact claims, signature-domain mutations, duplicate rejection,
challenge and finalization lifecycle.

The objective claim is intentionally narrow. A readiness transaction proves only approved-key
activity while the roster and aggregate bond gate were valid. It does not prove Minima-node uptime,
network reachability or correct offchain processing. A decision transaction proves only the member,
choice, evidence commitment and time. It does not prove decision truth. Equivocation is self-proving,
but finalized-fact correctness remains only as strong as the immutable fact source. The current
fact source is a disposable fixture, and the EIP-712 accountability key is not yet inseparably bound
to the member's Minima WOTS fund-moving authorization.

`AttestorWorkRewardIndexV1` now implements the non-custodial finalized-weight adapter. Its exact
address is committed before the epoch, it registers with the exact treasury before the start block,
and the treasury attributes only in-epoch confirmed fees to that recorder. After finalization,
anyone may consume each asset once. Readiness and participation buckets are allocated independently
across the ordered seven members, successfully challenged participation has already been removed,
and all integer or zero-weight remainder stays unassigned in treasury custody. Eight focused tests
cover exact deployment binding, challenge effects, one-shot use, two-asset isolation, exact epoch
boundaries, zero weights and rounding without a token transfer. These are indexed balances only and
are not payable.

No production claim or post-challenge forfeiture contract exists. No production bond asset or value is selected,
and bond release remains absent until liability, challenge, claim and exit-delay gates exist. No
Minima signer attribution proof exists. No contract is deployed and no public-chain or Minima WOTS
signature or transaction is authorized.
