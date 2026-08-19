# USDTm P1 threat model and accounting package

Date: 2026-08-19  
Status: P1 candidate, valueless design and local property evidence only

## 1. Scope and evidence limit

This package defines the safety model required before canonical bytes are frozen in P2. It covers
the Ethereum deposit record, the Minima deposit nullifier, proof-gated refund, source capacity,
reserve admission, reserve substitution, concurrency, halt behavior and the principal ordering
attacks.

The executable companion is `validate-usdtm-p1-model.mjs`. It is a chain-independent state model.
It does not execute EVM bytecode, KISS, a light client, a ZK proof, a signature algorithm available
to KISS, a Minima transaction or a mainnet transaction. P2 must freeze the bytes. P4 through P9 must
prove the exact implementations and transaction shapes.

## 2. Protected assets and authorities

| Asset or state | Canonical authority | Safety rule |
|---|---|---|
| Ethereum vault USDT | Pinned immutable vault runtime and current finalized Ethereum storage | No timeout, administrator or relayer may refund or transfer bridge collateral |
| Ethereum deposit record | Vault mapping entry under the authenticated current state root | The record begins `PENDING`; only `PENDING -> REFUNDED` exists in the cancellation lifecycle |
| Ethereum inbound capacity | Vault counters changed by accepted deposits, proved refunds and proved redemptions | A refund restores the exact deposit amount once, in the same transaction that marks `REFUNDED` |
| Minima deposit nullifier | Sparse tagged tree root in the unique `CLIENT_STATE` coin | Only `EMPTY -> RELEASED` and `EMPTY -> CANCELLED` exist; both terminal states are immutable |
| Minima client and accounting state | One unit of the unique client-control token | Every state transition consumes the current control coin and creates exactly one successor |
| Minima reserve accounting | `R` in the control state plus the fixed sibling reserve output created with that control coin | Every control transition co-spends and recreates the reserve; address balances and donations are not accounting authority |
| Cancellation intent | Exact authority committed by the Ethereum `PENDING` record | A valid signature binds the complete cancellation domain and exact record fields |
| Relayer or prover | None | May deliver data and proofs but has no validity vote, custody key or redirect power |

## 3. Two-chain deposit cancellation lifecycle

### 3.1 Ethereum record state machine

For each unique `messageId`:

```text
ABSENT -> PENDING -> REFUNDED
```

`ABSENT -> PENDING` is the successful vault deposit. The vault measures the actual token balance
increase, assigns a unique record ID, stores the amount, raw Minima recipient, cancellation
authority, both chain and deployment domains, token identities and configuration epoch, and
increments reserved inbound capacity by the measured amount.

`PENDING -> REFUNDED` requires a finalized proof of the matching canonical Minima
`EMPTY -> CANCELLED` transition. In one Ethereum transaction the vault:

1. verifies the Minima light-client transition from its stored prior client state;
2. verifies the exact cancellation transaction and output commitment;
3. checks every proved field against the current `PENDING` record;
4. marks that record `REFUNDED` before the external token transfer;
5. decrements reserved inbound capacity by exactly the recorded amount;
6. transfers exactly the recorded amount to the recorded refund recipient;
7. reverts the entire operation if any check or transfer fails.

All refund and redemption entrypoints share one reentrancy guard. The record is marked and counters
are changed before the token call. A reentrant call may be rejected while the outer transfer still
succeeds, so the required invariant is not that every reentry reverts the outer transaction. It is
that no callback or cross-function entrypoint can create a second transfer or counter change. P4
must test reverting, false-returning, no-return and malicious callback tokens and compare actual
balance changes.

There is no Ethereum `RELEASED` record state in version 1. A record remains `PENDING` after a Minima
release, while Minima's terminal `RELEASED` nullifier prevents a cancellation proof. This separation
avoids requiring a second source-chain transaction for every release. It is safe only because a
refund cannot occur without the mutually exclusive finalized Minima `CANCELLED` state.

Forbidden Ethereum transitions:

- `ABSENT -> REFUNDED`;
- `REFUNDED -> PENDING`;
- `REFUNDED -> REFUNDED`;
- any timeout or administrator transition to `REFUNDED`;
- any capacity decrement outside the same atomic state transition that pays the refund or a
  separately proved successful redemption.

### 3.2 Minima nullifier state machine

For the same `messageId`:

```text
EMPTY -> RELEASED
EMPTY -> CANCELLED
```

`RELEASED` and `CANCELLED` are terminal tagged leaves. No transition changes one into the other or
returns either to `EMPTY`. Both transitions consume the same unique `CLIENT_STATE` coin and prior
nullifier root, so concurrent release and cancellation transactions can race but only one can spend
the canonical control coin. A loser rebuilt against the mined successor sees a non-empty leaf and
must reject.

An inbound release requires all of the following:

- a native proof of the exact current finalized Ethereum vault record as `PENDING`;
- equality of the proof-bound record fields and the release public values;
- prior nullifier status `EMPTY` and successor status `RELEASED`;
- the exact reserve admission and successor shape in section 5;
- exact recipient and amount outputs;
- all accounting and collateral invariants.

A cancellation requires all of the following:

- a native proof of the exact current finalized Ethereum vault record as `PENDING`;
- equality of the proof-bound record fields and the cancellation public values;
- a valid signature by the exact authority stored in that record over the digest in section 4;
- prior nullifier status `EMPTY` and successor status `CANCELLED`;
- no change to `R`, `I`, `P`, `F`, payout counters or redemption publication fields;
- if the cancellation proof advances the authenticated Ethereum client head, `L` becomes the exact
  proof-bound current vault balance and the branch prevalidates `I + P <= newL`; an equal-head
  cancellation preserves `L` exactly;
- exact co-spend of the current control and admitted reserve inputs, then recreation of the control
  at output 0 and the same positive reserve amount at output 1.

### 3.3 Permanent Minima failure

If Minima never finalizes either terminal transition, Ethereum has no trustless fact proving that a
future release is impossible. The deposit can remain `PENDING`, its capacity stays reserved and the
USDT can remain trapped permanently. This is a liveness and user-fund trapping failure. It is not
converted into a signer, federation, timeout or administrator refund. Production disclosure,
exposure caps and checkpoint policy must account for it.

## 4. Cancellation authentication domain

P2 must assign exact widths and enum values. P1 fixes the semantic field set. The cancellation
authority signs a protocol-specific digest over all of these values in this order:

```text
protocol domain = MINIMA_ETH_DEPOSIT_CANCEL_V1
schema version
cancellation action
source Ethereum chain ID
source Ethereum genesis commitment
destination Minima network ID
source vault deployment ID and vault address
destination reserve deployment ID and reserve covenant commitment
source USDT token address
destination USDTm token ID
source deposit record ID
message ID
source amount atoms
destination amount atoms
decimal scale
raw Minima recipient bytes
refund recipient bytes
authority scheme ID
authority public key bytes
configuration epoch
```

The stored `PENDING` record commits the same values. The native Ethereum proof authenticates that
exact record and status under the current finalized state root. The Minima covenant reconstructs
the activated P2 digest, verifies the signature under the committed authority and pins every output.
The signature is not an unrestricted spend branch. A changed action, chain, deployment, record,
message, token, amount, scale, recipient, authority or epoch must fail.

The signature scheme and exact authority encoding are P2 engineering choices, not founder choices.
P2 may select them only after the chosen verification operation is shown to exist with the required
semantics. Parser acceptance of `CHECKSIG` is not execution evidence.

## 5. Reserve admission and successor rules

### 5.1 Canonical accounting identity

The canonical reserve is not a permanent bridge-token coin ID and is not the sum of coins at a
covenant address. Its authority is:

```text
the current unique CLIENT_STATE coin
+ its committed reserve amount R
+ the fixed output-1 reserve sibling created by the same transaction
+ one bridge-token input admitted by the exact branch tuple
```

Every control transition, including client update, cancellation and payout acknowledgement,
co-spends the current control coin and one admitted reserve coin, then recreates the exact reserve
successor at output 1. Non-value transitions preserve its amount. This keeps the current reserve
constructively tied to the transaction that created the current control coin and avoids advancing
the control lineage while leaving reserve discovery in an unrelated earlier transaction.

For inbound release of `A`, the exact tuple is:

```text
input count = 2
input 0 = current one-unit client-control token at the state covenant
input 1 = bridge-token coin at the reserve covenant, amount exactly prior R
output count = 3
output 0 = exact one-unit successor client-control coin, storestate:true
output 1 = bridge-token reserve successor at the reserve covenant, amount R - A
output 2 = bridge-token payout to the proof-bound recipient, amount A
R > A > 0
newR = R - A
newI = I + A
newP = P
newR + newI = F
newI + newP <= proof-bound L
sum bridge-token inputs = sum bridge-token outputs = R
```

The reserve successor must be positive. Version 1 permanently retains a one-atom reserve floor and
has no zero-reserve branch. Ethereum therefore sets `fixedSourceCapacity = F - 1` destination atoms
and requires `usedCapacity + measuredDepositAtoms <= fixedSourceCapacity`. Since used capacity
includes every accepted deposit not yet refunded or redeemed, all still-releasable deposits fit
while leaving at least one reserve atom. A later topology may remove the floor only after it defines
and proves an empty-reserve and return-from-zero path.

The scripts must check the exact input and output counts, fixed indices, addresses, token IDs,
amounts, keep-state flags and every changed or unchanged state port. No extra bridge-token input,
output, fee output or implicit burn is permitted. The reserve input's own address script must also
require the exact unique control input and branch shape. A reserve coin cannot be spent by itself.

For an outbound return of `A`, input 1 must again match current `R`, input 2 is the user's exact
returned bridge-token coin, and output 1 is exactly `R + A`. Exact conservation is
`R + A = newR`; `newI = I - A`; `newP = P + A`; `newR + newI = F`. Client-only updates,
cancellations and payout acknowledgements co-spend and recreate the same positive `R` exactly.

### 5.2 Amount-equivalent substitution

Two bridge-token coins at the same reserve covenant with the same token ID and amount are fungible
for the transition. If a donated or previously displaced coin equals current `R`, consuming it
instead of the last-created successor produces the same authorized outputs and the same next
control state. The unique control coin still permits only one canonical transition.

The unspent equal-amount coin becomes quarantined surplus. It does not increase `R`, reduce `I`,
restore capacity or authorize another transition. It may become amount-eligible again after later
state changes, but spending it still requires the then-current unique control coin and exact tuple.
Thus substitution can change which physical atoms continue the reserve line without changing any
bridge accounting or issuing twice.

This conclusion depends on all of these conditions:

- one and only one unique current control input;
- one and only one reserve input on a value-moving branch;
- input reserve amount equals prior state `R` exactly;
- fixed successor and payout positions with exact output count;
- full token conservation and no implicit burn;
- the reserve script cannot execute without the control input;
- `R` is never computed from address balance or coin count;
- constructors and recovery do not assume the newest, first or last coin is canonical.

If exact KISS cannot express and execute this tuple, amount-equivalent substitution is not proved.
P8 remains blocked until the real covenant rejects extra inputs, short outputs, reserve-only spends,
stale-control races and wrong-amount lookalikes, and until both the normal and substituted shapes
mine with purpose-created valueless assets on Minima mainnet. A failure requires a constructive
lineage redesign before token creation.

### 5.3 Stranded coins and recovery

Version 1 deliberately has no surplus recovery branch. Donations and displaced reserve coins can be
permanently stranded. This prevents a recovery signer from becoming a reserve drain, but creates
three liveness costs that P8 and P9 must measure:

- address pollution can make naive reserve discovery slow or ambiguous;
- losing the known successor coin proof can delay construction even though surplus coins exist;
- a donor cannot recover tokens deliberately sent to the covenant.

The transaction that creates every control successor also creates its reserve successor at output 1.
A clean constructor authenticates the current one-unit control coin, fetches or imports its creating
transaction and selects output 1 only after checking the reserve covenant, bridge-token ID, amount
`R` and positive value. This rule survives any number of client updates and cancellations because
they recreate both siblings together. If that sibling is unavailable locally, a public recovery
bundle supplies its creating transaction and proof; consensus checks, not the bundle, decide
validity. The constructor may use another exact-amount covenant coin only as an explicit
substitution, sorts candidates by coin ID, and never treats total address balance as `R`.

P9 and P12 must demonstrate bounded clean-node reconstruction after non-value control actions,
local proof loss and polluted reserve addresses. If Minima pruning cannot supply or import the
current sibling proof from public chain evidence, the topology fails its recovery gate. No
signer-only sweep is added.

## 6. Accounting transitions and interleavings

All amounts are non-negative integers in token atoms. During the valueless six-decimal research
phase, one Ethereum mock-USDT atom maps to one TEST-USDTm atom.

| Transition | Ethereum source capacity | Minima accounting |
|---|---|---|
| Deposit accepted | `usedCapacity += A` | no immediate change |
| Inbound released | no change | `R -= A`, `I += A` |
| Deposit cancelled on Minima | no change | nullifier only; `R`, `I`, `P` unchanged |
| Cancelled deposit refunded | `usedCapacity -= A` once | no change |
| Outbound return accepted on Minima | no change | `R += A`, `I -= A`, `P += A` |
| Ethereum redemption paid | `usedCapacity -= A` under the separate proved redemption path | Minima remains pending acknowledgement |
| Payout acknowledged on Minima | no change | `P -= A`, proof binds lower `L` |

The Ethereum source counter may be expressed cumulatively as:

```text
usedCapacity = cumulativeAcceptedDepositAtoms
             - cumulativeRefundedDepositAtoms
             - cumulativePaidRedemptionAtoms
fixedSourceCapacity = F - 1 destination atoms
0 <= usedCapacity <= fixedSourceCapacity
```

Refund counters change only with `PENDING -> REFUNDED`; payout counters change only with a consumed
redemption ID and successful transfer. On Minima, every transition preserves `R + I = F` and accepts
a new proof-bound state only when `I + P <= L`.

An inbound release and payout acknowledgement may execute in either order only if each proof extends
the current client and bridge state. A stale loser must rebuild. An inbound release cannot advance
past an unacknowledged Ethereum payout counter, so it cannot use a pre-payout `L` after capacity and
vault balance have fallen.

The P1 executable model treats proof validation as pure. A rejected transition must leave the full
Minima state unchanged, including the accepted Ethereum version, control and reserve UTXOs,
returned-token input, `R`, `I`, `P`, `L`, cursors, nullifiers and publication records. P3 must lift
this semantic rule into byte-identical snapshot or transactional reference-state tests across fuzzed
inputs.

The structural control-and-reserve primitive is not itself a protocol action dispatcher. Release,
cancellation and payout acknowledgement are reachable only through their proof-validating entry
points. A raw structural action label has no authority and must reject before a control or reserve
coin is spent.

## 7. Ordering attacks and expected outcomes

| Ordering or attack | Required result |
|---|---|
| release before cancellation | release wins `EMPTY -> RELEASED`; cancellation rejects non-empty leaf; refund cannot obtain a cancellation proof |
| cancellation before release | cancellation wins `EMPTY -> CANCELLED`; every later release rejects; finalized proof may refund once |
| release and cancellation submitted concurrently | only one spends the current control coin; loser reconciles against terminal leaf and rejects |
| refund before cancellation | reject because no finalized canonical cancellation proof exists |
| refund after cancellation | atomically mark `REFUNDED`, decrement capacity once and pay exact recorded amount |
| refund replay | reject current record `REFUNDED`; capacity and balance unchanged |
| release after refund using current Ethereum state | reject because exact vault record is not `PENDING` |
| release using an older `PENDING` proof after refund | reject unless it also extends the one current Minima client state; a valid cancelled leaf independently blocks release |
| release proof prepared before cancellation but posted after | reject stale control input or non-empty nullifier |
| cancellation proof prepared before release but posted after | reject stale control input or non-empty nullifier |
| competing Minima forks contain release and cancellation before settlement | Ethereum follows its stored fork-choice state and accepts neither branch until the configured settlement rule passes |
| a late heavier Minima fork removes an already refunded cancellation and contains release | refund plus release can coexist; this violates the explicit Minima settlement-finality assumption and is not prevented by the state machines |
| cancellation mines but proof is withheld | record stays `PENDING`, capacity remains used and funds stay locked; any prover may later submit the public proof |
| Minima permanently stops | no trustless refund; record and capacity may remain stuck permanently |
| Ethereum refund transfer fails | entire source transaction reverts; record and capacity remain `PENDING` and unchanged |
| token callback reenters any refund or payout entrypoint | shared guard rejects the nested effect; outer call may succeed, but transfer and counters change at most once |
| equal-amount reserve donation is selected | same next `R`, `I`, control state and outputs; displaced coin is non-accounting surplus |
| two releases race using different equal reserve coins | one control spend wins; loser rejects stale control state |
| stale displaced reserve later matches current `R` | may substitute only with current control coin and exact branch; cannot issue an extra transition |
| reserve coin spent without control | reject in reserve input script |
| control spent on release without reserve | reject exact input shape |
| extra reserve input or short successor | reject exact cardinality and conservation |

## 8. Halt and governance behavior

Version 1 has no administrator drain, signer rescue, timeout refund, proof bypass, upgrade branch or
emergency reserve sweep. Unknown proof versions, verification keys, forks, vault code, token
semantics or client states halt before value moves. A halt may stop new deposits or issuance at the
Ethereum entry point only if the immutable source rules make that state explicit; it cannot redirect
existing vault or reserve funds.

Weak-subjectivity bootstrap, finality, verification-key governance, token freeze behavior, value cap
and production decimals remain the open founder decisions recorded in `USDTM-ZK-PROTOTYPE.md`.

### Conditional Minima settlement-finality assumption

The cancellation state machine gives mutual exclusion only on one canonical Minima history. A proof
accepted by Ethereum is assumed not to be displaced later by a heavier Minima fork. If that
assumption fails after a cancellation refund, a replacement Minima history can contain `RELEASED`
and refund plus release can coexist. Ethereum checkpoint monotonicity prevents its own light client
from rolling back, but cannot stop Minima users from following the replacement history.

P5 must measure and implement a settlement rule based on cumulative work, confirmation delay,
Cascade behavior and accepted-checkpoint ancestry. O-USDTM-008 must select the production delay and
value cap. No finite delay is represented as absolute finality. Production stays blocked unless the
founder accepts the quantified residual reorganization risk after external review. P1 therefore
claims conditional safety under the declared settlement-finality assumption, not unconditional
impossibility across arbitrary late heavier forks.

## 9. P1 exit and later blocking evidence

P1 can pass when this semantic model, its property tests and the complete attack list survive two
independent hostile reviews with no unresolved CRITICAL or HIGH finding. Passing P1 does not prove
the signature primitive, canonical encoding, sparse tree, EVM vault, KISS covenant, light client,
ZK verifier or transaction mineability.

The following gates remain mandatory:

- P2: exact action numbers, widths, statuses, domains, authority and signature bytes, two encoders,
  golden fixtures and field mutations;
- P3: independent reference implementation and fuzzed state sequences;
- P4: atomic EVM refund, reentrancy and failed-transfer tests using a mock proof interface;
- P5: finalized canonical Minima cancellation proof on Ethereum;
- P6 and P7: authenticated Ethereum `PENDING` proof and native verification on Minima;
- P8: exact KISS admission, substitution and hostile branches mined with valueless mainnet assets;
- P9: constructor, proof tracking, unknown-outcome and WOTS recovery behavior.
