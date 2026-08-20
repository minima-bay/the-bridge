# Canonical bridge attestor, economics and recovery framework

Date: 2026-08-20

Status: discussion draft for founder, technical, economic and legal review

Evidence boundary: this document proposes a production framework. It does not authorize production,
real collateral, a production token, a bond deposit, an attestor appointment or a fund-moving
transaction. The existing bridge evidence uses valueless USDTm and ETHm test lanes. P8 proved the
five covenant actions on stock Minima mainnet with one fixture operator controlling the test keys.
P9 remains a local partial result, and that fixture key domain is retired. Nothing in this document
turns those tests into evidence of independent operators, real Ethereum facts or production safety.

## 1. Executive recommendation

The preferred design is a canonical 1:1 bridge with isolated asset lanes, a mutually selected and
equally bonded attestor committee, permissionless relayers, objective slashing where proof is
possible, and atomic user recovery paths inspired by HTLC swaps.

The current 5-of-7 threshold is a useful benchmark, not yet a final production decision. Under that
model:

1. Ethereum custody and deposit records live in an immutable per-asset Ethereum vault.
2. The corresponding representation is released from a fixed per-asset Minima reserve.
3. Five of seven attestors authenticate an Ethereum fact before an inbound Minima release.
4. A stateful Minima proof is intended to authorize the reverse Ethereum payout.
5. Relayers and provers may be permissionless. They carry data and complete transactions but do not
   decide whether a source-chain fact is true.
6. Each attestor posts the same bond and risks its individual accountability tranche for its own
   objectively provable misconduct.
7. Only a limited mutual-guarantee tranche of every committee member's bond is exposed to a
   successful quorum fraud. Honest attestors do not lose their entire stake because other members
   lied.
8. Bridge exposure is capped by the slashable value of the smallest dishonest quorum, with a safety
   discount.
9. Attestors receive a combination of equal availability pay, verified participation pay and
   capital-at-risk pay. They are not paid merely for voting yes.
10. User principal, attestor bonds, safety reserves and operating fees remain separate ledgers and
    separate custody domains.

This is not a trustless bridge. It is better described as an economically secured, mutually selected,
five-of-seven threshold-attested canonical bridge with atomic recovery paths.

## 2. What 1:1 means

For every `A` units of bridge representation in circulation, the relevant source vault must hold
at least `A` attributable units of the source asset for that lane. Principal backing is not revenue.
It cannot pay attestors, relayers, developers, claims or gas.

Fees should therefore be quoted in addition to principal:

```text
user payment = principal to be represented + disclosed bridge fee + external network costs
minted or released representation = principal to be represented
recorded backing liability = principal to be represented
```

For example, if a user wants 1,000 USDTm and the disclosed fee is 3 USDT, the user deposits 1,003
USDT plus any separately quoted gas. The vault records 1,000 USDT as backing liability and 3 USDT
as fee revenue. The interface must never imply that 997 units received against a 1,000-unit deposit
is an undisclosed 1:1 transfer.

Each asset has an isolated lane. Its vault, Minima token, reserve, accounting, nullifiers, cap and
loss pool cannot silently subsidize another lane. If one committee secures several lanes, its
exposure cap must nevertheless use the aggregate value across those lanes.

## 3. Trust model and security boundary

The Minima covenant can enforce the exact control coin, reserve coin, state transition, recipient,
token, amount and output layout. It cannot independently observe Ethereum consensus. In the inbound
direction, a valid threshold can therefore lie about the source deposit.

For a 5-of-7 committee:

- any five cooperating attestors can authorize a release;
- three unavailable attestors can stop progress;
- fewer than five dishonest attestors cannot create a valid threshold authorization;
- collateral and slashing may deter or compensate fraud but cannot prevent five valid signers from
  creating an immediately valid false authorization.

The public About page must state this boundary directly. It must not describe threshold attestation
as an Ethereum light-client proof or call the bridge trustless.

## 4. Onchain and offchain pieces

| Location | Component | Purpose |
|---|---|---|
| Ethereum | Immutable lane vault | Custodies source principal and creates persistent deposit and redemption records |
| Ethereum | Committee registry | Pins the active epoch, exact members, identity keys, bond keys and policy hash |
| Ethereum | Bond and adjudication contract | Holds bonds, enforces delayed exit and executes objective slash verdicts |
| Ethereum | Exposure controller | Rejects new liability above the committee and lane caps |
| Ethereum | Fee and reward accounting | Accrues attestor, relayer, safety and operating allocations without touching principal |
| Ethereum | Minima proof verifier | Intended authority for Minima-to-Ethereum redemption |
| Minima | Lane control coin and KISS covenant | Enforces the exact state machine and successor transaction |
| Minima | Fixed lane reserve | Holds the pre-created representation inventory for releases and returns |
| Minima | Per-transfer HTLC branches | Optional user claim and unilateral timeout recovery |
| Offchain | Seven attestor installations | Independently observe Ethereum and issue threshold authorizations |
| Offchain | Watchers | Detect false statements, equivocation, missing operations and exposure breaches |
| Offchain | Relayers and provers | Move public evidence and completed transactions between chains |
| Offchain | Evidence repository | Stores public committee policies, signed decisions, audits and incident records |
| Offchain | Confidential diligence store | Holds encrypted identity, financial and infrastructure evidence that must not be public |
| Offchain | Monitoring and incident response | Measures health, challenges misconduct and coordinates safe pauses |

No offchain coordinator is authoritative. Any coordinator may assemble a canonical request, collect
signatures and relay a valid result. Each attestor must derive the source fact from its own
independent chain view.

## 5. Attestor responsibilities

An attestor is not merely a signer. It is an independent bridge security operator. Its duties are:

1. Operate independent Ethereum and Minima observations with diverse infrastructure and RPC paths.
2. Reconstruct every active lane's deposits, releases, cancellations, returns and redemptions.
3. Verify finality, domain, vault, lane, asset, amount, recipient, epoch, exposure and replay status.
4. Sign only the exact canonical record and exact destination transaction it verified.
5. Record a signed refusal when a request is invalid or unverifiable.
6. Protect signing keys, prevent restored-node and WOTS reuse, and maintain auditable recovery
   procedures.
7. Publish health, key-rotation, incident and conflict disclosures required by policy.
8. Remain slashable throughout the full challenge, expiry and unbonding period for its decisions.

Correctly refusing an invalid request is honest service. Remuneration must not create a financial
bias toward approval.

## 6. Candidate admission and background checks

Candidate admission cannot be completely anonymous and permissionless at first. Without an
identity and independence gate, one organization can occupy several seats through Sybil entities.

Each candidate dossier should cover:

### Identity and legal standing

- legal entity, beneficial owners, directors, operating jurisdiction and accountable persons;
- sanctions, politically exposed person, adverse-media and conflict checks;
- relevant criminal, civil, insolvency and regulatory history;
- signed disclosure of relationships with other candidates.

### Financial capacity

- proof that the bond is owned and unencumbered;
- source-of-funds and source-of-wealth checks appropriate to the bond size;
- capacity to absorb a slash without hidden indemnity from another committee member;
- common investors, creditors, guarantors and insurers that could create correlated control.

### Independence

- ownership, directors, employees, administrators and contractors;
- cloud providers, regions, physical locations and network providers;
- Ethereum and Minima data sources;
- key custody, recovery personnel and approval paths;
- parent companies, lenders, banks and other shared dependencies.

Independence should be evaluated as a graph, not as seven corporate names. Seven entities using one
administrator, one cloud account or one RPC provider are not seven independent operators.

### Technical readiness

- isolated nodes and diversified source-chain observations;
- protected signing with an HSM or equivalent control where technically compatible;
- WOTS counter rollback protection, global duplicate-node fencing and no raw signing bypass;
- reproducible build and update provenance;
- monitoring, incident response, backup, restoration and key rotation;
- external penetration testing and operational audit.

### Probation

Candidates should complete a valueless operational epoch covering valid, nonexistent, malformed and
duplicate deposits, stale RPC data, reorgs, outages, conflicting requests, crash recovery, restored
node detection, cancellation, rotation and timely refusal.

Reviews should be refreshed periodically and after any ownership, key, infrastructure or incident
change.

## 7. Mutual committee formation

The user requirement that every candidate may accept or refuse every other candidate is best
implemented as unanimous acceptance of one complete roster, rather than a collection of ambiguous
pairwise votes.

Recommended formation process:

1. Each candidate publishes a public dossier commitment. Confidential evidence stays encrypted
   with approved reviewers.
2. Reviewers produce signed assessments with issue dates and expiries.
3. A proposed ordered seven-member roster is assembled.
4. Each proposed member signs the same message containing the bridge ID, epoch, complete ordered
   roster, bond addresses, Minima signing keys, accountability keys, policy hash, dossier root and
   activation date.
5. The epoch activates only when all seven have signed exactly the same roster hash and posted the
   required equal bond.
6. Any member may withdraw before activation. A refusal or withdrawal means that roster does not
   activate and a different roster may be proposed.
7. A public cooling period gives users, watchers and candidates time to inspect the proposed epoch.

After activation, there is no immediate opt-out. An attestor exits only after new liability has
stopped, a replacement epoch is active, every relevant claim and challenge period has expired and
the unbonding delay has completed.

Public records should show that a roster was not accepted, but need not publish sensitive or
potentially defamatory veto reasons.

## 8. Recommended attestor remuneration

### 8.1 Design goals

Remuneration should pay for four different things:

1. continuous readiness and secure infrastructure;
2. careful and timely verification work;
3. capital locked and genuinely at risk;
4. successful, confirmed bridge service.

It should not reward blind signing, an approval race or unnecessary transaction volume.

### 8.2 Fee charged to the user

For a transfer amount `A`, use a transparent quote:

```text
bridgeFee(A) = fixedServiceFee + riskRate * A
totalUserCost = A + bridgeFee(A) + estimatedExternalNetworkCosts
```

The fixed component covers minimum verification and operating work. The variable component pays for
capital at risk and should rise when outstanding exposure is close to the cap. The quote must state
its validity period, minimum, maximum and refund treatment before the user locks principal.

Network costs should be estimated separately and reconciled to actual costs where practical. No
oracle or cross-asset conversion should be required for version 1. Fees may be denominated in the
lane asset and accrued for periodic Ethereum claims.

### 8.3 Attestor reward pool

The attestor share of protocol fees should be calculated per epoch and divided into three buckets:

| Bucket | Illustrative share of attestor pool | Distribution principle |
|---|---:|---|
| Readiness | 60% | Equal among active members for eligible time and measured availability |
| Participation | 25% | Proportional to timely, valid approve or reject decisions on assigned requests |
| Bond risk | 15% | Proportional to time-weighted slashable bond exposure; equal when bonds are equal |

These percentages are a review starting point, not a final decision.

This approach avoids a first-five race. All seven may earn participation credit during a defined
decision window, even when the threshold is reached earlier. A timely refusal of an invalid request
can earn participation credit. A yes vote is not intrinsically more valuable than a correct no.

The epoch reward for attestor `i` can be represented as:

```text
reward_i = readiness_i + participation_i + bondRisk_i - measuredPenalties_i
```

Eligibility requires an active bond, current diligence and audit status, valid active keys, required
availability and no unresolved critical incident. An attestor found to have committed slashable
misconduct forfeits unpaid rewards for the affected period.

### 8.4 When rewards become payable

- Transfer-related reward accrues only after the canonical settlement is confirmed.
- Accrued rewards remain subject to a challenge and clawback window.
- Payout occurs periodically, not after every transfer, to reduce costs and Minima WOTS activity.
- A response lost after broadcast is reconciled by exact transaction identity before any reward or
  retry.
- No reward is paid twice for the same settlement ID.

The protocol needs a bootstrap budget because low early volume may not fund seven serious operators.
Before launch, a disclosed treasury should fund minimum retainers for a fixed runway. User fees can
progressively replace that subsidy as volume grows.

### 8.5 Long-lived liability and reward runway

A canonical representation can remain in circulation for months or years after the entry transfer.
A one-time entry fee may therefore be insufficient to compensate attestors for the full period in
which their bonds and infrastructure secure that liability. Principal cannot be invested or reduced
to solve this without changing the custody and 1:1 risk claim.

The protocol should maintain a forward security runway calculation:

```text
securityRunway = availableNonPrincipalRewardFunds / minimumEpochSecurityBudget
```

The available reward funds may include earned entry and exit fees, the disclosed bootstrap treasury
and other unrestricted protocol revenue, but never backing principal or user claim reserves. If the
runway falls below a published minimum, the exposure controller must stop accepting new liability.
Existing redemption, return and refund paths remain open.

The fee schedule should be reviewed periodically using outstanding liability duration, actual
operating cost and expected redemption behavior. Possible future funding sources include a clearly
disclosed exit fee or independent treasury revenue. A hidden recurring charge against the backing
asset is prohibited because it would break the simple 1:1 claim.

### 8.6 Protocol fee allocation

A possible version 1 starting model is:

| Recipient | Illustrative share of protocol fee | Purpose |
|---|---:|---|
| Attestor pool | 50% | Readiness, participation and bond-risk rewards |
| Fee-funded safety reserve | 20% | Claims that exceed collected slashes or bridge-controlled failures |
| Relayers and provers | 10% | Permissionless completion of required chain actions |
| Operations, audits and development | 20% | Monitoring, security review, compliance and maintenance |

The percentages require economic and legal review. The safety reserve is not part of 1:1 backing and
must not be advertised as making every loss fully insured.

Relayer payment is separate from attestor payment. A relayer earns a published bounty for completing
a public chain action. It does not earn authority over the attested fact.

## 9. Equal bonds, limited mutual responsibility and the exposure cap

Let:

- `b` be the equal bond posted by each attestor;
- `q` be the minimum signing quorum, initially modeled as 5;
- `L` be aggregate outstanding bridge liability secured by that committee;
- `alpha` be a conservative safety factor below 1.

The cap should satisfy:

```text
L <= alpha * q * b
```

For example, with seven equal bonds of 125,000 units, a five-member quorum has 625,000 units at
risk. With `alpha = 0.8`, aggregate outstanding liability would be capped at 500,000 units. This is
an illustration, not a recommended production value.

Each bond should be divided logically into:

| Tranche | Illustrative amount | Function |
|---|---:|---|
| Individual accountability | 80% | Exposed only to that attestor's objectively proved misconduct |
| Mutual committee guarantee | 20% | Limited shared exposure when a successful quorum fraud causes user loss |

The split answers the concern about honest members. If five members sign a fraudulent settlement,
their individual accountability tranches may be fully slashed. The two honest non-signers do not
lose those individual tranches. If the policy uses a mutual-guarantee layer, only the pre-agreed
limited mutual tranche of all seven is additionally exposed.

The reason for any mutual tranche is that each member unanimously accepted the committee and shares
responsibility for ongoing independence monitoring. Its size should remain small enough that honest
refusal is always economically preferable to joining a suspicious quorum.

The cap must be enforced onchain and cannot be raised by the attestors whose bond it measures.
Liability remains outstanding as long as the representation remains issued, not merely while one
transfer is in progress.

## 10. Objective dishonesty and slashing

Slashing is safe only when a contract or narrowly defined adjudicator can evaluate canonical public
evidence. Suitable candidate faults include:

- two conflicting signed statements for the same lane, epoch and deposit or redemption ID;
- a signed deposit that does not exist in the immutable Ethereum vault record;
- wrong chain, vault, lane, asset, amount, recipient, epoch or source record;
- reuse of an already consumed deposit or redemption ID;
- authorization by an expired or unauthorized epoch;
- authorization that exceeds the onchain exposure cap;
- a signed destination transaction that differs from the canonical statement.

Temporary downtime, a stale RPC view, censorship, ambiguous reorg judgement and alleged negligence
without a contradictory signed statement are not suitable for catastrophic automatic slashing.
They should trigger availability adjustments, investigation, pause or rotation.

The largest unresolved cryptographic issue is signature attribution across chains. Minima's current
TreeKey/WOTS transaction signature must be provably attributable to the identity whose bond is held
on Ethereum. A production design needs one of:

1. an Ethereum-verifiable WOTS fraud-proof mechanism;
2. a cross-chain signature form verifiable by both systems;
3. a second accountability signature cryptographically bound to the exact Minima authorization,
   with a construction that cannot be bypassed.

Without this binding, an Ethereum bond contract may be unable to prove which bonded operator signed
the fund-moving Minima transition. This is a production blocker, not a documentation detail.

## 11. Compensation and loss waterfall

When objective fraud or a covered bridge failure causes a user loss, recovery should follow a
published waterfall:

1. recover any asset still present in the affected source or destination contract;
2. slash the individual accountability tranches of objectively culpable attestors;
3. use the limited mutual-guarantee tranches only if the policy conditions are met;
4. use the fee-funded safety reserve up to its available balance;
5. use any separate, explicitly governed insurance pool if one exists;
6. record any residual uncovered loss transparently.

Principal backing must never be diverted to compensate a different user or lane.

A user refund should be automatic when possible, not dependent on slashing. HTLC timeout recovery is
intended to return the user's original asset when the other bridge leg was never completed. Slashing
is for fraud and residual loss, not the normal refund path.

## 12. Optional public insurance pool

A public pool could allow third parties to deposit capital if they trust the committee and earn a
share of fees. It could deepen compensation capacity, but it creates a new financial product and a
new attack surface:

- adverse selection and bank-run behavior after an incident;
- unclear seniority between users, attestor bonds and insurers;
- oracle and valuation risk across asset lanes;
- governance capture over claim decisions;
- smart-contract, liquidity and withdrawal-queue risk;
- securities, insurance, collective-investment and licensing questions.

Recommendation: do not make an open insurance pool a version 1 dependency. Start with equal attestor
bonds, conservative caps and a fee-funded safety reserve. Design any public pool later as a separate,
audited, opt-in layer with explicit loss seniority and no access to principal custody.

## 13. HTLC-assisted atomic recovery

The inspected Atomix repository implements peer-to-peer cross-chain swaps using a shared secret,
two HTLCs and staggered timeouts. It is not a canonical bridge and does not create 1:1 issuance, but
its recovery pattern is useful.

An HTLC-assisted Ethereum-to-Minima flow could be:

1. The user creates secret `s` and hash `h`, then locks source principal in an Ethereum bridge intent
   with a long timeout `T_E`.
2. After Ethereum finality and attestor approval, the covenant releases the exact representation
   from the Minima reserve into a user HTLC with a shorter timeout `T_M`.
3. The user claims on Minima and reveals `s`.
4. Any relayer submits `s` to finalize Ethereum custody and earns the published relayer bounty.
5. If the Minima leg never appears, the user refunds the Ethereum principal after `T_E`.
6. If the user never claims, the Minima representation returns to the reserve after `T_M`.

The reverse flow mirrors this ordering. The source-side timeout must be longer than the destination
timeout plus finality, congestion, relay and safety margins.

This reduces liveness and custody risk. It does not prove that the Ethereum deposit is real. Five
colluding attestors can still authorize a false release unless the Ethereum fact is verified by a
sound proof.

Version 1 must test secret loss and premature disclosure, duplicate hashes, timeout boundaries,
cross-chain clock differences, gas spikes, relayer outages, reorgs and every refund branch.

## 14. Expected transfer time

These are planning estimates, not protocol guarantees:

| Direction | Normal planning range | Main components |
|---|---:|---|
| Ethereum to Minima | about 18 to 25 minutes | Ethereum finality, independent attestation, Minima construction and mining |
| Minima to Ethereum | about 20 to 30 minutes | Minima settlement policy, proof generation/relay and Ethereum inclusion |
| Full round trip | about 40 to 60 minutes | Both directional flows without congestion or manual review |

Ethereum currently documents finality as normally requiring two epochs, about 15 minutes. The
Minima side is probabilistic and needs a value-dependent cumulative-work or confirmation policy.
Congestion, disagreement or unusual reorg conditions should delay settlement safely rather than
weaken the finality rule.

Refund timeouts will be much longer than the normal completion target. Their exact values must be
derived from worst-case finality, chain congestion, challenge and monitoring assumptions and then
proved in both covenant implementations.

## 15. Integritas as an evidence layer

Integritas can be useful for document integrity and audit traceability. Its public material describes
hashing or stamping records and later verifying that they were not altered, with anchoring on
Minima. Appropriate bridge uses include commitments to:

- candidate dossiers and independent assessment reports;
- the committee charter and unanimous roster acceptance;
- bond, key and policy ceremonies;
- software and configuration manifests;
- periodic audits, independence reviews and incident reports;
- committee rotations and retirement records.

Sensitive personal and business evidence should remain encrypted offchain. Public records should
contain canonical hashes, issuer signatures, result status, issue date and expiry.

A timestamped hash proves that a particular document existed and has not changed. It does not prove
that the document was truthful, that the issuer was independent or that the attestor is currently
honest. Live membership, bonds, keys, epochs and caps must remain in the bridge's authoritative
contracts and Minima control state.

Before depending on Integritas, review canonicalization, independent hash recomputation, API and
service availability, export, self-hosting or fallback, data residency, privacy and external
security evidence. The protocol should retain a direct Minima anchoring fallback.

## 16. Why this structure instead of other bridge types

| Structure | Advantage | Why it was not selected as the first bridge |
|---|---|---|
| Full light-client bridge in both directions | Strongest cryptographic source verification | A stock-Minima Ethereum verifier has not yet met the KISS, instruction and transaction-size gates |
| Single custodian or multisig | Simpler and faster to build | Concentrated control, weak transparency and no credible decentralization claim |
| Liquidity network | Fast transfers without canonical minting | Adds market makers, liquidity fragmentation, price spreads and different solvency assumptions |
| Optimistic bridge | Few normal-path proofs | Requires reliable watchers, challenge windows and objective fraud verification on both chains |
| P2P atomic swaps | No pooled canonical custodian for each swap | Needs matching counterparties and liquidity; it does not create one canonical 1:1 representation |
| Threshold-attested canonical bridge | Works with stock Minima and preserves one canonical representation | Depends on quorum honesty, operator independence, bonds and objective accountability |

The chosen structure is a pragmatic hybrid. It preserves the canonical 1:1 product while admitting
the current source-verification limitation. Atomix contributes atomic recovery mechanics, not the
bridge's price formation or issuance model.

## 17. How far it can decentralize

The following can be decentralized:

- ownership and operation of the seven attestor installations;
- Ethereum and Minima data sources;
- request construction and signature collection;
- relaying, proof generation, monitoring and fraud submission;
- public dossier review and incident observation;
- future committee nomination and roster formation.

The following remain concentrated unless specifically solved:

- a 5-of-7 quorum remains a bounded federation;
- unanimous roster acceptance can make membership conservative and self-perpetuating;
- the bond adjudicator or upgrade authority may become a governance center;
- common cloud, investors, contractors or RPC providers may create hidden correlated control;
- one legal or regulatory event may affect several attestors;
- a committee securing many lanes concentrates portfolio risk.

Decentralization should therefore be measured through verifiable control and dependency diversity,
not the number of public keys alone.

## 18. Public About page requirements

The bridge About page should explain:

1. what canonical 1:1 backing means and where principal is held;
2. the exact current committee, threshold, epoch and member identities;
3. how candidates were checked and how the full roster was unanimously accepted;
4. each bond, its individual and mutual tranches, and the aggregate exposure cap;
5. what attestors verify, what they cannot prove and how they are paid;
6. which faults can be slashed and what public evidence is required;
7. the claim and loss waterfall, including what is not insured;
8. the role of relayers, watchers, Integritas and HTLC recovery;
9. the normal transfer target, timeout recovery and pause conditions;
10. all live lane liabilities, vault balances, reserve balances, cap use and unresolved incidents;
11. the fact that five colluding attestors can authorize a false inbound release;
12. links to current audits, policy hashes, contracts, covenant identities and source code.

The page should distinguish current deployed facts from future proposals. A dashboard is evidence
only if every displayed value can be independently derived from the chains or signed public records.

## 19. Principal risks introduced by this design

- quorum collusion or hidden common control;
- attestor unavailability and committee deadlock;
- bond value falling below liability;
- inability to prove Minima WOTS signer identity to the Ethereum adjudicator;
- governance capture of cap, registry, adjudication or upgrade functions;
- flawed HTLC timeout ordering or secret handling;
- erroneous finality or reorg handling;
- fee incentives that encourage approval or excess volume;
- underfunded early operation and declining monitoring quality;
- a safety or insurance pool creating additional financial and contract risk;
- personal-data exposure in candidate diligence;
- misleading claims that threshold attestations are trustless proofs.

Safe failure should pause new liability while preserving user redemption and refund paths wherever
possible.

## 20. Decisions required before implementation

| Decision | Proposed review default | Status |
|---|---|---|
| Production quorum | Keep 5-of-7 for modeling | Open |
| Roster formation | Unanimous signature over the full ordered roster | Proposed |
| Equal bond | Yes | Proposed |
| Bond tranche split | 80% individual, 20% mutual | Illustrative only |
| Exposure factor `alpha` | 0.8 | Illustrative only |
| Attestor reward split | 60% readiness, 25% participation, 15% bond risk | Illustrative only |
| Protocol fee split | 50% attestors, 20% safety, 10% relayers, 20% operations | Illustrative only |
| Low-volume retainer funding | Fixed disclosed bootstrap treasury runway | Proposed |
| Open delegated attestor security pools | Opt-in, principal-separated, minimum self-bond, non-transferable initial positions | Decided in `D-USDTM-026` |
| Open public insurance pool | Defer from version 1 | Recommended |
| Objective slash verifier | Exact cross-chain attribution mechanism | Unresolved blocker |
| Committee epoch and cooling period | Derive after operational tests | Open |
| Challenge and unbonding periods | Longer than every liability and evidence window | Open |
| HTLC timeout values | Derive and formally test both directions | Open |
| Minima finality policy | Value-dependent cumulative-work or confirmation rule | Open |
| Integritas integration | Evidence layer only, with independent fallback | Proposed |

## 21. Review and implementation sequence

1. Founder review of the trust model, mutual selection principle and economic objectives.
2. Independent economic modeling of bond size, aggregate cap, fee demand, reward runway and loss
   scenarios under bond-price stress.
3. Legal review of custody, attestor status, slashing, public diligence, fees and any safety or
   insurance pool.
4. Cryptographic design for binding Minima fund-moving signatures to Ethereum-held bonds.
5. Exact Ethereum contract and Minima covenant specifications, including HTLC recovery.
6. Hostile offline models for admission, rotation, fees, cap, slashing, claim ordering and every
   timeout boundary.
7. Independent security review and formal invariant review.
8. Valueless multi-operator probation with genuinely separate infrastructure and identities.
9. Public About page and machine-verifiable dashboard implementation.
10. A new explicit founder decision before any fresh signing key, real bond, production contract or
    real collateral is created.

### 21.1 Executable review model

`canonical-bridge-attestor-economics-model.mjs` now encodes the illustrative committee, fee, reward,
bond, exposure, runway and loss-waterfall rules in an offline integer-only reference model.
`validate-canonical-bridge-attestor-economics.mjs` checks unanimous roster activation, aggregate
multi-lane exposure, principal and fee separation, neutral approve/reject participation rewards,
limited honest-member mutual loss, subjective-fault rejection, open redemption during a security-
runway pause and randomized accounting sequences.

This model exists to expose contradictions before Solidity implementation. Its percentages and
amounts remain illustrative. It does not prove contract safety, signature attribution, economic
sufficiency, legal enforceability or production approval.

### 21.2 Open delegated security pools

`D-USDTM-026` decides the architecture for public capital participation. Ordinary bridge users are
not security depositors: their 1:1 bridge principal never earns attestor fees and never bears a
slash. A separate voluntary security depositor chooses one approved attestor, contributes only to
that attestor's bond pool, shares that pool's allocated fees and accepts its disclosed slashing
risk. Capital provision grants no signing key, committee seat or transfer-level vote.

Every attestor must retain an immutable minimum self-bond so public capital cannot replace operator
skin in the game. The self-bond is intended to be first-loss for an objectively proved individual
fault. Initial depositor positions are internal and non-transferable. Exit must use an asynchronous
request and remain slashable through every settlement, reorg, evidence, challenge and claim window.
The exact self-bond percentage, reward split, withdrawal delay, share-loss accounting and legal
treatment remain open under `O-USDTM-013`.

The local bond vault now implements one-way self and delegated contribution accounting. Delegated
capital cannot consume the reserved self-bond capacity, and a member pool is not ready until its
full equal bond and minimum self-bond are both present. This does not yet implement per-account fee
rewards, slashing, withdrawal or transferable vault shares.

The separate local fee treasury now creates the fee side of this structure without touching bridge
principal. It reserves the attestor bond-risk share for later pro-rata allocation between the
attestor and that attestor's voluntary security depositors. Readiness and participation pools remain
distinct because public capital does not perform attestation work. Claims remain locked until an
epoch index can use time-weighted contribution checkpoints, exact settlement confirmation,
challenge finality, forfeiture and post-slash balances. The treasury's current runway calculation
is observable but not yet enforced by the exposure controller.

The local epoch reward index now implements only the objective bond-risk portion. Each confirmed
fee event advances a separate reward-per-share accumulator for each lane fee asset. All seven fully
bonded member pools receive the same amount, and each member pool then divides its amount pro rata
between the attestor self-bond and voluntary depositor positions. The bond vault checkpoints reward
debt before any future contribution change, preventing new capital from inheriting earlier indexed
fees. This is capital-weighted accounting, not a complete attestor work epoch.

The local work-epoch recorder now supplies those separate records. The roster unanimously commits
one recorder address. A direct member heartbeat in a fixed block window counts only while the roster
is active and every committed bond is posted. The record therefore proves that the approved
Ethereum key acted at that block under the bond gate. It does not prove that a Minima node, watcher,
network connection or offchain service was continuously available.

For participation, either exact bridge lane registers a unique request digest and deadline. Each of
the seven members may submit one timely approval or rejection, and both choices receive equal weight.
This preserves the rule that honest refusal must not be punished and removes the first-five race.
The record proves the member, choice, evidence commitment and timing. It does not by itself prove
that the external fact was true or that the choice was correct.

Incorrect-decision challenges are accepted only through an immutable verifier chosen with the
epoch. A successful challenge removes that decision's single participation unit. Anyone may freeze
the ordered weights only after the complete challenge period.

The current objective verifier improves this boundary in two ways. First, every participation
record requires an EIP-712 accountability signature bound to the exact chain, verifier, recorder,
roster, request, request digest and decision. Two opposite signatures from the same member for the
same domain prove equivocation without asking an oracle which decision was true. Second, a finalized
fact source may prove that the recorded decision contradicts the exact final result. That result is
only as trustworthy as the immutable source. The local source is a mutable mock and proves no
Ethereum or Minima consensus.

The recorder also hash-chains every accepted heartbeat, request, signed decision and successful
challenge. Delayed finalization binds that ordered history, request and decision counts, final
weights and challenge total.

The separate local work-reward index now consumes those finalized weights. The roster commits the
recorder, the recorder commits one future index, and that index must register with the exact treasury
before the epoch starts. Only confirmed fees collected inside the exact work-epoch block range enter
its readiness and participation buckets. Once the challenge delay has ended, anyone can index each
configured fee asset exactly once. Readiness and participation are divided independently among the
seven finalized member weights. A successfully challenged decision has no participation weight,
while an honest timely refusal remains equal to an honest timely approval. Asset ledgers cannot
cross, and integer or zero-weight remainders remain in treasury custody. Indexing does not transfer
tokens and creates no current claim right.

A production system still needs canonical P4 request binding, a real finalized-fact source,
inseparable binding between the EIP-712 accountability key and Minima WOTS authorization,
challenger economics, appeal and forfeiture policy, and a safe claim lifecycle.

## 22. Sources and related project documents

Project specifications:

- [USDTm P7 threshold attestation v1](usdtm-p7-threshold-attestation-v1.md)
- [Generic bridge asset lanes v1](bridge-asset-lanes-v1.md)
- [Reserve covenant transition specification](reserve-covenant-transition-spec-v1.md)
- [P9 WOTS guard](P9-WOTS-GUARD.md)
- [Open founder decisions](open-decisions.md)
- [Prototype control document](USDTM-ZK-PROTOTYPE.md)
- [Executable attestor economics model](canonical-bridge-attestor-economics-model.mjs)

External primary material:

- [Ethereum finality explanation](https://ethereum.org/roadmap/single-slot-finality/)
- [Integritas product overview](https://integritas.technology/)
- [Integritas blockchain integration documentation](https://docs.integritas.technology/docs/technical-docs/blockchain-integration/)
- [Atomix repository](https://github.com/eurobuddha/minima-core-android-atomix)
- [Atomix source inspected at commit 830d1cb](https://github.com/eurobuddha/minima-core-android-atomix/tree/830d1cb944e1089bfdb4c658afd8d6f24c7b9ba5)

The Atomix conclusions here are based on source inspection, not a runtime audit or on-device
mainnet validation. Integritas is treated as an optional evidence service, not as bridge consensus,
committee selection or slashing authority.
