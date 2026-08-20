# P6 roster and bond-custody research

This directory contains the first Ethereum committee component from
`P6-ETHEREUM-COMMITTEE-BOND-AND-REWARD-SPEC.md`. It is a local research fixture only.

`AttestorRosterRegistryV1` holds no funds, verifies no bridge message and assigns no real
candidate. It tests one governance rule: seven ordered candidates must all accept the exact roster
and policy commitment, while any candidate may opt out before delayed activation. Activation also
requires one immutable readiness interface to report that all bonds for that exact roster are
posted. The included readiness source is a disposable mock only. The operating bridge quorum remains
five after activation.

The test reuses the exact Hardhat 3.13.0 toolchain pinned by `p4/package-lock.json`. On Windows, the
ignored path `p6/node_modules/hardhat` is a local directory junction to
`p4/node_modules/hardhat`. The validator rejects any other resolution. Run the source-bound gate
from the research root:

```text
node validate-canonical-bridge-p6-roster.mjs
```

`AttestorBondVaultV1` now replaces the readiness mock in a separate focused test. It accepts one
exact valueless bond from each member, partitions the full bond into individual and mutual tranches,
measures the received token balance delta and rechecks current aggregate custody before reporting
readiness. It deliberately exposes no release or slashing function.

Under `D-USDTM-026`, the same vault also accepts public one-way contributions to one chosen attestor
pool. Delegated deposits cannot consume the committed minimum self-bond capacity. The local 30%
self-bond value is illustrative. Contributor positions are internal and non-transferable, with no
reward claim, slash or withdrawal path yet.

`AttestorFeeRewardTreasuryV1` is a separate principal-free fee ledger. Only the two exact
exposure-controller lanes can collect a fee, and only for the same lane's confirmed one-use
settlement identity. Each lane uses an isolated fee asset and security runway. The illustrative
protocol split is 50% attestors, 20% safety, 10% relayers and 20% operations. The attestor pool is
then split 60% readiness, 25% participation and 15% bond risk. The bond-risk pool is reserved for
future pro-rata sharing with self-bonders and voluntary security depositors. No claim or withdrawal
exists until reward attribution, challenge, forfeiture and slashing rules are implemented.

`AttestorEpochRewardIndexV1` now implements that bond-risk allocation as a non-custodial
reward-per-share index. The unanimous roster commits its exact address. The bond vault checkpoints
contributor reward debt before a bond balance can change, and the bound treasury alone can index a
confirmed fee. Every full member pool receives an equal amount; within that pool, the member and its
chosen depositors accrue pro rata to recorded slashable capital. Each fee asset has an independent
index, and the index exposes no payout claim.

`AttestorWorkEpochV1` adds the separate operator-work record. The roster commits one exact recorder.
An approved member can post one readiness heartbeat per fixed window only while the roster is active
and all seven bonds remain posted. Either exact lane can register a unique request with a deadline,
and every member can submit one timely `APPROVE` or `REJECT`; both choices receive equal participation
weight. Request admission and member work both require the active, fully bonded roster. An immutable
verifier can remove a proved-invalid decision before anyone permissionlessly finalizes the epoch
after the challenge delay.

`ObjectiveDecisionVerifierV1` replaces the fixed-evidence verifier in the current test. Every
participation record now requires a valid EIP-712 accountability signature bound to the chain,
verifier, recorder, roster, request, request digest and decision. Two opposite signatures from the
same member on that exact domain objectively prove equivocation. A second programme accepts only an
opposite finalized decision from one immutable fact-source adapter. The local adapter is deliberately
mutable and named `MockFinalizedDecisionFactSource`; it verifies no Ethereum or Minima consensus.
The work recorder hash-chains every accepted heartbeat, request, signed decision and successful
challenge, then binds that ordered history and its counts into finalization. Twelve focused tests
cover the complete lifecycle and hostile proof mutations.

`AttestorWorkRewardIndexV1` consumes those finalized weights without taking custody. The recorder
commits one future index, and that index must register with the exact treasury before the epoch
starts. Only confirmed fees collected inside that epoch feed its readiness and participation
buckets. After the challenge delay, anyone may index each configured fee asset once. Readiness and
participation are calculated independently, challenged decisions earn no participation share, and
integer or zero-weight remainders stay unassigned in treasury custody. Eight focused tests cover
exact binding, early and repeat rejection, challenged work, rounding, asset isolation and exact
epoch boundaries.

These are deliberately narrow facts. A heartbeat proves that the approved Ethereum key acted while
the bond gate was satisfied, not node uptime or correct offchain service. A decision record proves
who submitted which choice and when, not that the choice was true. Equivocation is self-proving, but
a fact-contradiction verdict is only as trustworthy as its immutable fact source. The ECDSA
accountability signature is not yet inseparably bound to the member's Minima WOTS fund-moving
signature. Finalized work weights now produce accounting allocations, but no member can claim or
receive those balances yet.

`AttestorExposureControllerV1` now supplies one immutable cap shared by two roster-committed local
lane callers. New liability requires an active, fully bonded roster and available aggregate
capacity. Liability release remains open when bonding later becomes insufficient. It now records
the exact lane behind each settlement so the separate treasury cannot collect a cross-lane fee.

The next components remain unimplemented: a production finalized-fact source, inseparable Minima
WOTS accountability binding, post-challenge forfeiture, claims, security-runway enforcement, P4
vault adapters and the gated bond-release path. No public deployment is authorized.
