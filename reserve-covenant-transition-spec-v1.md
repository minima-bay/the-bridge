# Pre-minted reserve covenant transition specification v1

Date: 2026-08-18  
Status: design only, blocked until native proof verification exists

## 1. Meaning of a pre-minted reserve covenant

Minima fixes a token's total supply when the token is created. A pre-minted reserve covenant holds
the part not yet issued to users. It does not mint on demand.

Inbound bridge action:

```text
proved finalized Ethereum lock
  -> spend reserve and authenticated Ethereum client-state coins
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

The Ethereum vault must enforce a conservative source-side capacity before accepting an
irreversible deposit:

```text
committed inbound USDT atoms * decimalScale <= fixed Minima supply atoms
```

Only a proved finalized Minima return may restore that capacity. A deposit that is never released
can consume capacity and harm liveness, but it cannot make the reserve insolvent. Any refund design
must first consume the same `messageId` as cancelled in the canonical Minima nullifier accumulator,
then prove that cancellation to Ethereum. A local timeout refund is unsafe because a delayed Minima
release proof could otherwise coexist with the refund.

## 2. Accounting model

Let:

```text
F = fixed token supply
R = amount in the canonical reserve coin
I = authoritative issued-not-returned liability
P = returned token atoms reserved for accepted but not yet acknowledged Ethereum payouts
L = proof-bound finalized attributable Ethereum USDT balance, converted to Minima atoms
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

Use two canonical coins and require them to be co-spent for any release:

1. `CLIENT_STATE`, exactly one unit of a unique control token holding authenticated Ethereum client
   and bridge state.
2. `TOKEN_RESERVE`, bridge-token coin holding the canonical inventory.

The control token has fixed supply 1 and is created only at bridge bootstrap. Every branch consumes
that one unit at input 0 and recreates exactly one unit at output 0 to the same covenant. A copied
lookalike coin cannot satisfy the control-token ID and amount checks. Two coins keep the large bridge
token amount out of the client-state amount, but introduce a critical
co-spend rule. Every value-moving branch must consume both exact prior coin IDs or exact covenant
successors and recreate both at fixed output positions. Neither coin has a signer-only spend path.

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
until `VERIFYZK` exists and the token-level script is decided.

### 5.1 Client update only

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, same covenant address, same MINIMA amount, `storestate:true` |

Rules:

- valid proof binds prior and new client-state hashes;
- finalized slot advances;
- sync committees and fork state transition exactly;
- ports 4 through 7, 9 through 14 and 18 through 24 remain unchanged;
- port 8 updates to the proof-bound finalized vault balance;
- ports 15 and 16 remain unchanged and equal the proved current vault payout cursor;
- port 17 becomes the current `@BLOCK` or a block within the fixed posting-lag bound;
- proved execution time in milliseconds satisfies the guarded-difference port-23 and port-24 bounds
  against `@BLOCKMILLI` without division or multiplication in KISS;
- `I + P <= L` is enforced before the successor is accepted;
- port 3 changes only because it commits the new Ethereum-client hash and vault balance;
- no bridge-token output exists;
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

- `VERIFYZK` binds the exact public-values hash;
- proof transitions the consumed client state and proves the vault commitment and balance;
- proof establishes that the vault accepted the deposit under the fixed-supply capacity bound;
- output 2 token ID, amount and recipient equal the proof public values;
- output 1 amount equals prior reserve minus output 2 amount;
- new liability equals prior liability plus output 2 amount;
- pending redemption remains exactly unchanged;
- payout cursor ports 15 and 16 remain unchanged and equal the proved current vault counter;
- an advancing Ethereum head sets port 17 to the current `@BLOCK` or a block within the fixed
  posting-lag bound;
- an equal Ethereum head preserves port 17 exactly and requires `@BLOCK - port17 <= port18`;
- outbound publication ports 19 through 22 and configuration ports 23 and 24 remain unchanged;
- proved execution time in milliseconds satisfies the guarded-difference port-23 and port-24 bounds
  against `@BLOCKMILLI` without division or multiplication in KISS;
- covenant enforces `newI + P <= provedL` inside consensus;
- new reserve plus new liability equals fixed supply;
- message ID is consumed in the new replay state;
- exact output count and token conservation prevent implicit burn;
- no signer, relayer, admin or fee address can redirect reserve value.

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
| 2 | optional fixed MINIMA change only if predeclared and exactly conserved |

Rules:

- returned token ID and amount are exact;
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

### 5.4 Finalized Ethereum payout acknowledgement

Inputs:

| Index | Required input |
|---:|---|
| 0 | exact canonical `CLIENT_STATE` containing the pending redemption |

Outputs:

| Index | Required output |
|---:|---|
| 0 | exact successor `CLIENT_STATE`, same address and MINIMA amount, `storestate:true` |

Rules:

- `VERIFYZK` authenticates the exact cumulative append-only payout range and lower finalized vault
  balance;
- issued liability, reserve amount, fixed supply, decimal scale and deployment IDs remain unchanged;
- pending redemption decreases by the aggregate paid Minima token atoms in the proved cumulative
  payout range;
- payout cursor port 15 advances and cumulative payout port 16 increases by the exact proved USDT
  delta;
- the sparse deposit-nullifier root remains unchanged;
- an advancing Ethereum head sets port 17 to the current `@BLOCK` or a block within the fixed
  posting-lag bound;
- an equal Ethereum head preserves port 17 exactly and requires `@BLOCK - port17 <= port18`;
- ports 19 through 24 remain unchanged;
- proved execution time in milliseconds satisfies the guarded-difference port-23 and port-24 bounds
  against `@BLOCKMILLI` without division or multiplication in KISS;
- `I + newP <= provedL` is enforced inside consensus;
- equal-slot acknowledgement preserves the Ethereum client-state hash exactly;
- advancing-slot acknowledgement applies a valid Ethereum client update;
- no bridge-token output exists and no covenant value can be redirected.

### 5.5 No halt, upgrade or emergency branch in v1

Version 1 has no stateful halt, upgrade, migration or emergency withdrawal branch. Unsupported proof
versions and code states fail because the active covenant does not recognize them. A future migration
requires a separate exact branch specification, founder decision, activation domain and adversarial
review before it can move any state or reserve. There is no signer-only reserve path.

## 6. Replay structure

Version 1 uses a sparse deposit-nullifier accumulator committed by one root in `CLIENT_STATE`. The ZK
program proves that an inbound deposit `messageId` was absent from the prior root and present in the
new root. Minima verifies the proof and exact prior-to-new state hashes. Deposit IDs need not execute
in order, so one malformed or unavailable deposit does not block later independent deposits.

The sparse-tree depth, empty-root constant, leaf encoding, branch order and hash function are fixed
by `bridge-public-inputs-v1.md`. Independent reserve shards cannot each accept
the same message unless they share the one authenticated accumulator transition. Sharding remains
blocked until deterministic routing and global uniqueness are proved.

## 7. Token-level script decision

Minima's token-level script applies to every token coin. Before `tokencreate`, decide whether:

- normal holder transfers remain unrestricted and only reserve coins use covenant addresses; or
- every token transfer carries additional token-level restrictions.

The first model is simpler but cannot observe user burns. The second expands the consensus and
wallet compatibility surface. No existing mxUSDT holder can be silently forced into a new token
script. A new token or explicit migration would require founder approval and a separate backing
reconciliation.

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
txnpost
verify the mined output from an independent node
```

`runscript`, source inspection and `txnpost status:true` are not mineability evidence. WOTS key-use
state must be serialized, and an unknown post result must be reconciled on-chain before retry.

## 9. Mandatory attacks

- proof under wrong chain, deployment, vault, token, program, key, direction or epoch;
- stale or rollback client-state transition;
- same message submitted twice or concurrently;
- reserve and client-state coins spent separately;
- short output that burns bridge tokens while amount checks otherwise pass;
- changed recipient, amount, decimals or output index;
- issued plus pending liability greater than proof-bound vault balance;
- inbound proof interleaved with one or more accepted but unpaid redemptions;
- payout acknowledgement replay or pending-redemption underflow;
- two deposits from the same finalized Ethereum block;
- direct USDT transfer without a vault commitment;
- source deposit later refunded;
- malformed earlier record blocking unrelated valid messages;
- donation coin counted as reserve;
- unknown token runtime, proxy implementation or deprecation state;
- verifier version rotation and old-proof replay;
- fully signed maximum-size TxPoW;
- post timeout followed by a retry.

Each case needs an executed result before value. A design argument is not a passing result.

## 10. Current evidence level

Design only. No covenant script, token, proof witness or transaction was created. Native ZK
verification is a blocking prerequisite.
