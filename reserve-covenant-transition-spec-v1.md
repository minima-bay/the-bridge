# Pre-minted reserve covenant transition specification v1

Date: 2026-08-18  
Status: semantic specification with an executed offline P8 five-action candidate; fresh mainnet all-branch evidence remains open

The P7 threshold specification supersedes this document wherever this document still says an
Ethereum fact is natively proved on Minima. Action-specific threshold records for standalone vault
updates, releases, payout acknowledgements and deposit cancellation, plus the owner-authorized
RETURN record, are frozen in `generic-p8-record-schema-v2.md`. The unified offline KISS candidate
executes all five actions in `p8/GenericP8UnifiedSmoke.java`. No obsolete native-proof branch may be
implemented silently.

`D-USDTM-018` and `bridge-asset-lanes-v1.md` further generalize this topology. Every asset receives
its own instance of the control and reserve lineage, nullifier namespace, accounting counters and
cap. References to USDTm describe the first ERC-20 instance only. No branch may consume or recreate
another lane's token or state.

## 1. Meaning of a pre-minted reserve covenant

Minima fixes a token's total supply when the token is created. A pre-minted reserve covenant holds
the part not yet issued to users. It does not mint on demand.

Inbound bridge action:

```text
5-of-7 attestation of one canonical finalized Ethereum lock and vault snapshot
  -> spend reserve and authenticated bridge-state coins
  -> pay exact token amount to exact Minima recipient
  -> recreate smaller reserve and updated client state
```

Outbound bridge action:

```text
user returns exact token amount to reserve covenant
  -> recreate larger reserve and lower issued liability
  -> record a redemption commitment
  -> Ethereum releases USDT only after proving this finalized Minima transition
```

The covenant is a lockbox for a fixed inventory. It is not a faucet controlled by a signer.

The Ethereum vault must enforce a conservative source-side capacity before accepting a deposit:

```text
usedCapacity = cumulativeAcceptedDepositAtoms
             - cumulativeRefundedDepositAtoms
             - cumulativePaidRedemptionAtoms
0 <= usedCapacity <= fixedSourceCapacity
fixedSourceCapacity = fixed Minima supply atoms - 1 destination atom
usedCapacity + measuredDepositAtoms <= fixedSourceCapacity
```

Only a proved finalized Minima return, or a proof-gated refund of a deposit that was never released,
may restore that capacity. A deposit that is neither released nor cancelled can consume capacity
and harm liveness, but it cannot make the reserve insolvent. A refund must first consume the same
`messageId` as cancelled in the canonical Minima nullifier accumulator, then prove that cancellation
to Ethereum. The vault atomically changes `PENDING` to `REFUNDED`, returns the deposit and restores
its reserved inbound capacity exactly once. A local timeout refund is unsafe because a delayed
Minima release proof could otherwise coexist with the refund.

The one-atom floor is mandatory in version 1. It keeps `R` positive because Minima coins and outputs
must have positive amounts. An inbound release requires `0 < A < R`; there is no zero-reserve or
return-from-zero branch.

## 2. Accounting model

Let:

```text
F = fixed token supply
R = amount in the canonical reserve coin
I = authoritative issued-not-returned liability
P = returned token atoms reserved for accepted but not yet acknowledged Ethereum payouts
L = latest quorum-attested finalized attributable Ethereum USDT balance, converted to Minima atoms
```

Required invariants:

```text
R + I = F
I + P <= L
```

`I` is the bridge liability counter, not a global holder census. `P` prevents an inbound release
from reusing collateral which an accepted redemption is about to pay out. A Minima return moves the
same amount from `I` to `P`. A finalized Ethereum payout acknowledgement decreases `P` and proves
the correspondingly lower `L`. User burns do not automatically
decrease it. Tokens sent to the covenant outside the canonical transition are quarantined donations
until a separately proved reconciliation path exists.

If marketing says every fixed-supply token is backed, the full `F` must be collateralized upfront.
Otherwise the accurate statement is that covenant-released, issued-not-returned liability is
backed, while locked reserve inventory is not circulating.

## 3. Proposed coin topology

Use one unique state-control coin and one amount-equivalent reserve input for every control transition:

1. `CLIENT_STATE`, exactly one unit of a unique control token holding authenticated Ethereum client
   and bridge state.
2. `TOKEN_RESERVE`, bridge-token coin holding the canonical inventory.

The control token has fixed supply 1 and is created only at bridge bootstrap. Every branch consumes
that one unit at input 0 and recreates exactly one unit at output 0 to the same covenant. A copied
lookalike coin cannot satisfy the control-token ID and amount checks. Two coins keep the large bridge
token amount out of the client-state amount, but introduce a critical co-spend rule. Every
value-moving branch must consume the unique control coin and exactly one bridge-token input at the
reserve covenant address whose token ID and amount equal state port 6, then recreate the declared
successor reserve at the fixed output position. Bridge-token coins are fungible, so the covenant
does not pretend that a prior reserve coin ID is a permanent identity. If an equal-amount donation
is selected, it is value-equivalent for the transition; the unspent old coin becomes quarantined
surplus and cannot increase `R`, authorize an extra transition against the same control state or
alter `I`. It may later substitute in a legitimate serial transition if current `R` again equals its
amount. The implementation must
prove this amount-equivalent substitution safe under concurrent spends and must measure the
resulting liveness and recovery behavior. If it cannot, `P8` stops and the topology must add a
constructive reserve-lineage mechanism. Neither coin has a signer-only spend path.

Every branch co-spends input 0 control and input 1 reserve and recreates them at outputs 0 and 1.
Client updates, cancellations and payout acknowledgements preserve the positive reserve amount.
The transaction creating the current unique control coin therefore also creates its current reserve
sibling at output 1, which is the constructive clean-recovery anchor. For release, exact cardinality
is part of admission: two inputs and three outputs only. Input 0 is
the current unique control coin. Input 1 is one reserve-covenant bridge-token coin whose amount is
exactly port 6. Output 0 is the exact control successor, output 1 is the exact reserve successor and
output 2 is the exact proof-bound payout. An extra reserve input, extra bridge-token output or short
successor rejects. The reserve input's address script independently requires input 0 and the same
shape, so no reserve coin can move without the current control coin.

The complete P1 safety argument, stranded-coin limitation and ordering table are in
`usdtm-p1-threat-model.md`. The abstract property model is not KISS evidence. P8 still requires both
normal and equal-amount substituted transactions to mine with purpose-created valueless assets on
Minima mainnet, and every hostile shape to fail.

This topology remains a design choice until exact KISS and Core witness behavior are prototyped. It
must be fixed before token creation.

## 4. Exact state ports

`CLIENT_STATE` uses these exact ports in version 1:

| Port | Value |
|---:|---|
| 0 | state schema version, exactly 1 |
| 1 | configuration epoch |
| 2 | canonical Ethereum client-state hash |
| 3 | canonical bridge-state hash |
| 4 | authoritative issued liability `I` |
| 5 | pending redemption `P` |
| 6 | canonical reserve amount `R` |
| 7 | fixed supply `F` |
| 8 | last proof-bound attributable vault balance in USDT atoms |
| 9 | decimal scale |
| 10 | sparse tagged nullifier root |
| 11 | destination network ID |
| 12 | bridge deployment ID |
| 13 | Minima token ID |
| 14 | unique client-control token ID |
| 15 | last acknowledged payout record ID |
| 16 | cumulative acknowledged payout atoms |
| 17 | Minima block at which the current Ethereum client head was accepted |
| 18 | maximum Minima blocks for equal-head proof reuse |
| 19 | latest redemption ID published by an outbound return |
| 20 | latest raw 20-byte Ethereum recipient published by an outbound return |
| 21 | latest returned Minima coin ID published by an outbound return |
| 22 | latest returned bridge-token amount published by an outbound return |
| 23 | maximum authenticated Ethereum-head age in milliseconds |
| 24 | maximum permitted Ethereum future skew in milliseconds |

The exact fixed-width preimages and hashes for ports 2 and 3 are defined in
`bridge-public-inputs-v1.md`. Every branch pins all unchanged ports with `SAMESTATE` or exact
`VERIFYOUT` checks. No relayer-supplied uncommitted field may affect a payout.

## 5. Exact branch tables

These tables are the required transaction shapes. Concrete KISS syntax is intentionally deferred
until the P7 `CHECKSIG` branch, exact TreeKey/WOTS witness form and token-level script are decided.

### 5.1 Client update only, authentication record not yet revised

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` |
| 1 | admitted positive `TOKEN_RESERVE` with amount exactly port 6 |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, same covenant address, same MINIMA amount, `storestate:true` |
| 1 | exact sibling `TOKEN_RESERVE`, same covenant and amount, `storestate:false` |

Rules after a separate canonical threshold snapshot record is frozen:

- five unique members of the active seven-member epoch attest the exact prior and next snapshot;
- the vault state version advances exactly once and the finalized block does not roll back;
- no same-transition committee rotation is permitted;
- ports 4 through 7, 9 through 14 and 18 through 24 remain unchanged;
- port 8 updates to the attested finalized vault balance;
- ports 15 and 16 remain unchanged and equal the attested current vault payout cursor;
- port 17 is monotonic, is not in the future, and is within the fixed posting-lag bound:
  `STATE(17) >= PREVSTATE(17)`, `STATE(17) <= @BLOCK`, and
  `@BLOCK - STATE(17) <= PREVSTATE(18)`;
- attested execution time in milliseconds satisfies the guarded-difference port-23 and port-24 bounds
  against `@BLOCKMILLI` without division or multiplication in KISS;
- `I + P <= L` is enforced before the successor is accepted;
- port 3 changes only because it commits the new Ethereum-client hash and vault balance;
- reserve input and output 1 preserve the exact positive `R` and full bridge-token conservation;
- no arbitrary fee output can be taken from covenant value.

### 5.2 Inbound release

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` |
| 1 | exact canonical `TOKEN_RESERVE` |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, `storestate:true` |
| 1 | exact successor `TOKEN_RESERVE`, `storestate:false` unless its own state is required |
| 2 | exact user payout, `storestate:false` |

Rules:

- the covenant parses the 444-byte record defined in `generic-attestation-schema-v1.md`;
- five unique active-epoch TreeKey witnesses satisfy `MULTISIG` over the complete transaction ID,
  binding the exact control input, record, successor state and outputs;
- the snapshot version is equal to the accepted version with identical snapshot fields, or exactly
  the next version with nondecreasing block, payout cursor and cumulative paid amount;
- output 2 token ID, amount and recipient equal the signed canonical record;
- output 2 amount is strictly less than prior reserve, so output 1 remains positive;
- output 1 amount equals prior reserve minus output 2 amount;
- new liability equals prior liability plus output 2 amount;
- pending redemption remains exactly unchanged;
- payout cursor ports 15 and 16 equal the attested current vault counter;
- an advancing Ethereum head requires monotonic bounded construction height:
  `STATE(17) >= PREVSTATE(17)`, `STATE(17) <= @BLOCK`, and
  `@BLOCK - STATE(17) <= PREVSTATE(18)`. Exact equality to `@BLOCK` is prohibited because the value
  becomes stale between mempool admission and block inclusion;
- an equal Ethereum head preserves port 17 exactly and requires `@BLOCK - port17 <= port18`;
- outbound publication ports 19 through 22 and configuration ports 23 and 24 remain unchanged;
- attested execution time in milliseconds satisfies the guarded-difference port-23 and port-24 bounds
  against `@BLOCKMILLI` without division or multiplication in KISS;
- covenant enforces `newI + P <= attestedL` inside consensus;
- new reserve plus new liability equals fixed supply;
- the successor journal commitment includes the lane ID and message ID; transaction replay is
  prevented by the spent unique control input, while historical message non-reuse is still a
  quorum-journal assumption pending the founder decision recorded in the control document;
- exact output count and token conservation prevent implicit burn;
- no signer, relayer, admin or fee address can redirect reserve value.
- a valid quorum can still attest a false Ethereum fact; this is the declared conditional trust
  boundary in `D-USDTM-017`, not a property the covenant can detect.

### 5.3 Outbound return

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` |
| 1 | exact canonical `TOKEN_RESERVE` |
| 2 | user's exact returned bridge-token input |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, `storestate:true` |
| 1 | exact successor `TOKEN_RESERVE` containing prior reserve plus returned amount |

Rules:

- returned token ID and amount are exact;
- exact input count is three and exact output count is two; no optional change branch exists;
- returned amount is divisible by the scale factor for Ethereum USDT atoms;
- issued liability decreases by the returned amount;
- pending redemption increases by exactly the returned amount;
- reserve increases by exactly the returned amount;
- a unique redemption ID commits Ethereum recipient, amount, deployment and epoch;
- output 0 port 19 equals that calculated redemption ID;
- output 0 port 20 equals the exact raw 20-byte Ethereum recipient;
- output 0 port 21 equals the exact input-2 returned coin ID;
- output 0 port 22 equals the exact returned bridge-token amount;
- ports 17, 18, 23 and 24 and the deposit-nullifier root remain unchanged;
- Minima tokens are already inaccessible to the user before any Ethereum payout;
- no timeout recreates the user's tokens after an Ethereum payout can be proved;
- Ethereum consumes the proved redemption ID atomically with transferring USDT;
- a later Ethereum proof acknowledges that payout on Minima and decreases pending redemption by the
  exact paid amount while authenticating the lower vault balance.

Canonical redemption commitment:

```text
redemptionId = SHA2-256(
  ASCII_ZERO_PAD_32("MINIMA_ETH_REDEMPTION_V1") ||
  destinationNetworkId || bridgeDeploymentId || tokenId || returnedCoinId ||
  UINT128_BE(returnedAmountAtoms) || ethereumRecipient20 ||
  UINT64_BE(configurationEpoch)
)
```

`ethereumRecipient20` is exactly 20 raw address bytes, never a text address. `returnedCoinId` is the
exact 32-byte Minima coin ID at input index 2. Output 0 ports 19 through 22 are the canonical Minima
publication point for the redemption. A later Minima-to-Ethereum proof proves the finalized outbound
transaction, the exact output-0 coin and those four state ports. A later transaction may overwrite
the latest-publication ports because the proof authenticates the original mined TxPoW and its output.
The spent UTXO coin ID provides one-time Minima authorization, and the Ethereum vault consumes
`redemptionId` exactly once. The sparse deposit-nullifier root remains unchanged on this branch. The
vault decodes no Minima text and pays only the committed 20-byte recipient and integer amount.

### 5.4 Finalized Ethereum payout acknowledgement, authentication record not yet revised

The proof-specific authentication bullets in this subsection are historical proof-route
requirements. They are not implementable under `D-USDTM-017` until P6 freezes an equivalent
threshold-signed payout-acknowledgement and vault-snapshot record.

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` containing the pending redemption |
| 1 | admitted positive `TOKEN_RESERVE` with amount exactly port 6 |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, same address and MINIMA amount, `storestate:true` |
| 1 | exact sibling `TOKEN_RESERVE`, same covenant and amount, `storestate:false` |

Rules:

- `VERIFYZK` authenticates the exact cumulative append-only payout range and lower finalized vault
  balance;
- issued liability, reserve amount, fixed supply, decimal scale and deployment IDs remain unchanged;
- pending redemption decreases by the aggregate paid Minima token atoms in the proved cumulative
  payout range;
- payout cursor port 15 advances and cumulative payout port 16 increases by the exact proved USDT
  delta;
- the sparse deposit-nullifier root remains unchanged;
- an advancing Ethereum head requires `STATE(17) >= PREVSTATE(17)`, `STATE(17) <= @BLOCK`, and
  `@BLOCK - STATE(17) <= PREVSTATE(18)`; exact equality to `@BLOCK` is not mineable robustly across
  mempool-to-block delay;
- an equal Ethereum head preserves port 17 exactly and requires `@BLOCK - port17 <= port18`;
- ports 19 through 24 remain unchanged;
- proved execution time in milliseconds satisfies the guarded-difference port-23 and port-24 bounds
  against `@BLOCKMILLI` without division or multiplication in KISS;
- `I + newP <= provedL` is enforced inside consensus;
- equal-slot acknowledgement preserves the Ethereum client-state hash exactly;
- advancing-slot acknowledgement applies a valid Ethereum client update;
- reserve input and output 1 preserve exact positive `R`; no covenant value can be redirected.

### 5.5 Deposit cancellation, authentication record not yet revised

The proof-specific authentication bullets in this subsection are historical proof-route
requirements. They are not implementable under `D-USDTM-017` until P6 freezes an equivalent
threshold-signed pending-deposit snapshot record while retaining the separate depositor cancellation
authority signature.

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` |
| 1 | admitted positive `TOKEN_RESERVE` with amount exactly port 6 |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, same address and MINIMA amount, `storestate:true` |
| 1 | exact sibling `TOKEN_RESERVE`, same covenant and amount, `storestate:false` |

Rules:

- a native proof authenticates the exact current finalized Ethereum vault record as `PENDING`,
  including its fresh message ID and canonical Minima cancellation authority;
- the transaction carries that exact authority's signature over the protocol-specific cancellation
  domain, schema and action, source chain and genesis, destination network, both deployments and
  covenant identities, both token identities, record ID, message ID, both integer amounts, scale,
  raw Minima recipient, refund recipient, authority scheme and key, and configuration epoch;
- a bounded native proof transitions the tagged deposit leaf from absent to `CANCELLED`;
- `RELEASED` and `CANCELLED` are terminal and mutually exclusive for one message ID;
- `R`, `I`, `P`, `F`, payout cursor and publication ports remain unchanged;
- an advancing proof updates the client-state commitment, `L` and posting-age state exactly as a
  client update and prevalidates `I + P <= newL`; an equal-head cancellation preserves `L` and the
  client-state commitment exactly;
- reserve input and output 1 preserve exact positive `R` and establish the successor sibling;
- the unique state-control coin serializes a cancellation against a competing release;
- Ethereum refunds only after its Minima light client proves this finalized cancellation output and
  atomically changes the matching vault record from `PENDING` to `REFUNDED`, returns the exact
  deposit and restores its reserved inbound capacity once;
- the Ethereum vault rejects refund after release and a Minima release rejects a cancelled record;
- no local timeout or administrator signature can substitute for the finalized Minima proof.

The Ethereum deposit record has only `ABSENT -> PENDING -> REFUNDED` in this lifecycle. The Minima
nullifier has only `EMPTY -> RELEASED` and `EMPTY -> CANCELLED`. Ethereum does not need to mark a
released record: it can refund only against the mutually exclusive finalized Minima cancellation.
The refund marks `REFUNDED`, restores exact capacity and transfers the exact amount atomically;
failure reverts all three effects. The exact action number, fixed-width fields, signature algorithm
and proof public values remain a P2 encoding gate. Permanent Minima failure can still strand a
pending Ethereum deposit because a trustless refund cannot prove that a future Minima release is
impossible without a finalized cancellation.

### 5.6 No halt, upgrade or emergency branch in v1

Version 1 has no stateful halt, upgrade, migration or emergency withdrawal branch. Unsupported proof
versions and code states fail because the active covenant does not recognize them. A future migration
requires a separate exact branch specification, founder decision, activation domain and adversarial
review before it can move any state or reserve. There is no signer-only reserve path.

## 6. Replay structure

The earlier proof-route design required a sparse deposit-nullifier accumulator committed by one root
in `CLIENT_STATE`. The stock-KISS threshold candidate does not prove arbitrary historical
non-membership. It commits an ordered journal update, and the unique control input prevents replay of
the same signed transaction, but honest operators must independently refuse a previously released or
cancelled `laneId || messageId`. Five colluding operators can sign a duplicate under the same
declared threshold assumption that lets them sign a nonexistent deposit.

The founder accepted that quorum-journal boundary for the valueless prototype in `D-USDTM-020`.
Production may retain it only under the same explicit fewer-than-five-collude trust statement, or add
an exact stock-KISS non-membership mechanism that passes the complete transaction and mainnet gates.
The abstract sparse accumulator remains a later proof-route option and must not be claimed as
executed P7 behavior.

The sparse-tree depth, empty-root constant, leaf encoding, branch order and hash function are fixed
by `bridge-public-inputs-v1.md`. Independent reserve shards cannot each accept
the same message unless they share the one authenticated accumulator transition. Sharding remains
blocked until deterministic routing and global uniqueness are proved.

## 7. Token-level script decision

Minima's token-level script applies to every token coin. The authorized valueless USDTm and ETHm
ceremony chooses the first model below:

- normal holder transfers remain unrestricted and only reserve coins use covenant addresses; or
- every token transfer carries additional token-level restrictions.

USDTm and ETHm therefore use no token-level restriction. Only their reserve coins use covenant
addresses. This is simpler and keeps normal holder transfers compatible, but it cannot observe user
burns. The second model remains outside version 1 because it expands the consensus and wallet
compatibility surface. No existing mxUSDT holder can be silently forced into a new token script. A
new token or explicit migration would require founder approval and a separate backing reconciliation.

## 8. Verification workflow after authorization

For a future valueless prototype only:

```text
txncreate
txninput without scriptmmr:true
txnoutput with fixed indices and exact amounts
txnstate for the exact successor state
txnsign
txnbasics
txncheck
txnpost auto:false
verify the mined output from an independent node
```

`runscript`, source inspection and `txnpost status:true` are not mineability evidence. Normalize and
require explicit typed `txncheck` verdicts. Every WOTS leaf or range is reserved durably outside the
rollback domain before signing and retired even if no transaction mines. Restored nodes remain
disabled until they rotate to a fresh key domain or move beyond a durable high-water mark, and
duplicate restored nodes never sign. An unknown post result must be reconciled on-chain before retry
or deletion.

## 9. Mandatory attacks

- proof under wrong chain, deployment, vault, token, program, key, direction or epoch;
- stale or rollback client-state transition;
- same message submitted twice or concurrently;
- release, cancellation and refund attempted in every ordering;
- reserve and client-state coins spent separately;
- equal-amount bridge-token lookalike selected instead of the previously observed reserve coin;
- short output that burns bridge tokens while amount checks otherwise pass;
- changed recipient, amount, decimals or output index;
- issued plus pending liability greater than proof-bound vault balance;
- inbound proof interleaved with one or more accepted but unpaid redemptions;
- payout acknowledgement replay or pending-redemption underflow;
- two deposits from the same finalized Ethereum block;
- direct USDT transfer without a vault commitment;
- source deposit later refunded;
- repeated deposit, cancellation and proof-gated refund restores reserved source capacity exactly once;
- malformed earlier record blocking unrelated valid messages;
- donation coin counted as reserve;
- unknown token runtime, proxy implementation or deprecation state;
- verifier version rotation and old-proof replay;
- fully signed maximum-size TxPoW;
- post timeout followed by a retry.

Each case needs an executed result before value. A design argument is not a passing result.

## 10. Current evidence level

Design only. No covenant script, token, TreeKey/WOTS signature or transaction was created. The P7
5-of-7 deposit branch is specified semantically but its exact stock-KISS transaction remains a
blocking prerequisite for P8. The remaining Ethereum-to-Minima snapshot, payout-acknowledgement and
cancellation branches must be harmonized with `D-USDTM-017` before implementation.
