# Generic bridge asset lanes v1

Date: 2026-08-19

Status: semantic design, valueless only

Authority: `USDTM-ZK-PROTOTYPE.md`. This specification generalizes the bridge protocol; USDTm is
one possible lane rather than the protocol identity.

## 1. Decision

The bridge is a lane protocol. Each asset lane has its own immutable identity, Ethereum custody
configuration, Minima token, reserve/control lineage, nullifier namespace, accounting counters and
exposure cap. Code and attestor membership may be shared, but asset inventory and authoritative
state are not pooled.

This avoids four failures:

1. a bad or frozen asset cannot corrupt another asset's reserve accounting;
2. one depleted reserve cannot consume another lane's inventory;
3. a deposit cannot replay against a different token or native asset;
4. one token's decimal or transfer semantics cannot silently become another token's semantics.

One multi-token reserve coin or one mutable asset-selector state branch is excluded from version 1.
The same reviewed covenant template may be instantiated once per lane with different committed
constants.

## 2. Lane identity

Each canonical bridge record binds the following lane fields in addition to the existing action,
deposit, vault-snapshot, committee and source-execution-time fields:

| Field | Meaning |
|---|---|
| `laneVersion` | Exact lane schema version |
| `laneId` | Domain-separated hash of every field in this table |
| `sourceAssetKind` | `0` native currency, `1` ERC-20 |
| `sourceAsset` | Zero address for native ETH, exact contract for ERC-20 |
| `sourceDecimals` | Source atomic decimal count |
| `destinationTokenId` | Exact Minima token ID |
| `destinationDecimals` | Minima token decimal count |
| `sourceQuantumAtoms` | Smallest accepted source amount quantum |
| `destinationQuantumAtoms` | Destination atoms produced per source quantum |
| `ethereumVault` | Exact immutable lane vault deployment |
| `reserveCovenant` | Exact Minima covenant identity |
| `configurationEpoch` | Delayed immutable configuration generation |

Version 1 recommends identical source and destination decimals with both quantum fields equal to 1.
If decimals differ, every accepted source amount must be exactly divisible by the source quantum and
the KISS branch must verify the conversion by multiplication inequalities without VM division.
Rounding, dust and donation-based credit are prohibited.

The nullifier key is `HASH(laneId || sourceRecordId)`. The same source record bytes may therefore
exist in two lanes without collision, while a record signed for one lane cannot move another lane.

## 3. Ethereum vault structure

The safest first implementation is one immutable vault deployment per lane using common reviewed
source code. This is generic code without a mutable production asset registry. A later registry is a
separate governance design with delayed activation, code-hash pinning and per-lane caps.

### ERC-20 lane

- Accept deposits only through the named function.
- Measure balance before and after `transferFrom`; record the actual increase.
- Pin token runtime and any accepted implementation/governance semantics.
- Restore capacity only through an exact proof-gated refund or settled Minima return.

### Native ETH lane

- Accept ETH only through `depositNative(recipient, cancellationAuthority)` with
  `msg.value > 0`.
- Reject ordinary `receive` and payable fallback entrypoints.
- Maintain `accountedNativeWei`, increased only by accepted deposits and decreased only by completed
  refunds or redemptions.
- Never treat raw `address(this).balance` as attributable collateral. Ethereum permits forced ETH
  transfers that execute no vault code, so raw balance may exceed the internal ledger.
- Consume the refund or redemption record and update every counter before the external ETH call,
  under one global reentrancy lock. A failed call reverts the entire transition.
- No administrator sweep may remove either accounted ETH or forced surplus in version 1. Surplus
  recovery is a separate reviewed branch because an incorrect balance distinction can steal backing.

The native lane removes ERC-20 allowance, fee-on-transfer, blacklist and issuer-freeze risks. It adds
external-call payout risk, forced-balance pollution and native-gas operational requirements.

## 4. Minima lane topology

Every lane has:

1. one unique one-unit control token;
2. one positive reserve coin of exactly that lane's Minima token;
3. lane-local `F`, `R`, `I`, `P`, authenticated collateral and cap counters;
4. a lane-local deposit nullifier accumulator;
5. the active committee epoch/root or a globally committed root whose signatures bind `laneId`.

Every fund-moving branch co-spends control and reserve, recreates the reserve as fixed sibling output
1 and exact-pins the recipient or return output. No attestor, relayer, registry administrator or
asset issuer receives an unrestricted spend branch.

A shared attestor committee creates portfolio risk: the same five colluders could attack every lane.
Production security must therefore compare the minimum slashable quorum bond with aggregate exposure
across all lanes secured by that committee, not each lane cap separately. Comparing ETH and token
exposure requires a conservative valuation rule or isolated committees/bond pools. This is a P6
economic gate, not something the Minima covenant can infer.

## 5. Exact ETH representation on Minima

The proposed first native lane is:

```text
Ethereum asset: native ETH
source decimals: 18
Minima representation: provisional name ETHm
destination decimals: 18
conversion: 1 wei locked = 1 ETHm atom released
initial valueless exposure cap: below 2^64 wei
```

Pinned official Core source establishes:

- `MiniNumber` accepts up to 44 decimal places but bounds magnitude below `2^64`;
- token amounts exposed to KISS are scaled token units;
- `tokencreate` defaults to a maximum of 16 token decimals as a command safety check;
- the source labels that check non-consensus and exposes `uselimits:false`.

Therefore 18-decimal ETHm is technically representable in the inspected source, but it bypasses the
normal token-creation safety limit. Before token creation, a purpose-created valueless prototype must
prove that creation, wallet display, send construction, covenant arithmetic, indexing, backup and
restore all preserve 18 decimals exactly.

For a simple exact-wei KISS model, source atom counters remain unsigned 64-bit values. The maximum is:

```text
18,446,744,073,709,551,615 wei
= 18.446744073709551615 ETH
```

The first prototype cap should remain at or below 10 ETH equivalent with valueless assets. This is
not a monetary recommendation. It keeps every atomic counter and multiplication inside the observed
numeric bound. A larger production cap needs a proved two-limb integer design or another exact
encoding; silently switching to gwei would introduce rounding and is not accepted.

To bind a Minima output amount `D` to source wei `A`, the covenant can verify:

```text
D * 1000000000000000000 = A
```

under a cap that keeps the product below `2^64`. Exact KISS parsing and transaction execution remain
P7/P8 evidence gates.

## 6. Generic record and transition requirements

An inbound release accepts only when:

- the record's exact `laneId` and committed lane fields match the consumed control state;
- five unique active-epoch signatures bind the complete record;
- the source record and vault snapshot satisfy the P7 monotonicity rules;
- source and destination amounts satisfy the lane's exact conversion;
- the lane-local nullifier is empty;
- `0 < destinationAmount < R`;
- lane-local reserve conservation and collateral invariants hold;
- the lane exposure cap is not exceeded;
- output token ID, amount and recipient match the record exactly;
- no other lane's state or inventory changes.

Rejection must leave all lanes byte-identical. A valid quorum can still sign a false ETH or ERC-20
deposit; generic lanes do not change the threshold trust boundary.

## 7. Required ETH and cross-lane attacks

- call a native deposit with zero value;
- send ETH directly rather than calling the deposit function;
- force ETH into the vault and attempt to count it as collateral;
- replay an ETH deposit against an ERC-20 lane;
- use the ETH zero-address sentinel under ERC-20 kind or a token address under native kind;
- change either decimal count, quantum, token ID, covenant or lane epoch after signatures;
- deposit more than the lane capacity or `2^64 - 1` atoms;
- use an amount that is not exactly divisible by a coarser lane quantum;
- reenter refund from native payout;
- make the ETH receiver revert or consume excessive gas;
- complete a payout counter update without completing the ETH call;
- use forced surplus for a legitimate payout;
- exhaust ETHm reserve to zero;
- mutate the USDTm lane while releasing ETHm, and vice versa;
- count per-lane bonds twice even though one committee secures both lanes.

## 8. Current verdict

Native ETH bridging is not refuted. It is a plausible first generic lane and removes several ERC-20
risks. Exact wei parity is feasible only under a small single-limb cap in the current simple model,
and 18-decimal Minima token compatibility is an explicit unpassed gate.

The next offline rung now executes a complete synthetic native-lane TxPoW against pinned Core. Its
444-byte record, five throwaway TreeKey signatures, KISS script, state, outputs, script proof and two
32-level coin proofs serialize to at most 32,054 bytes after switching to command-native integer
supplies; the advancing and bounded equal-head control paths
use 539 and 553 instructions. The release path cannot advance payout acknowledgement counters. This is
strong size and VM feasibility evidence, but the UTXOs and token are hypothetical. No ETH, ETHm
token, node wallet, `txncheck`, post, mining or mainnet operation has occurred.

The exact `MULTISIG` candidate also exposes a production decision: the unique control coin prevents
replay of one signed transaction, while historical deposit non-reuse is maintained by the honest
quorum's independently reconstructed journals rather than a stock-KISS non-membership proof. That
boundary was explicitly accepted for the valueless prototype in `D-USDTM-020`.
