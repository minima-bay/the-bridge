# Open founder decisions

Date: 2026-08-18

Current authority: `USDTM-ZK-PROTOTYPE.md`. This file is a supporting index and must not revive a
choice already decided in that control document.

## Authorized research direction

The founder originally approved the following research direction in conversation on 2026-08-18:

- prepare, but do not yet externally send, a Core-facing native-verifier proposal;
- benchmark compact pairing-based and hash-based tracks, with Groth16 first;
- classify the product as research infrastructure until both directions pass;
- make the next engineering slice the independent Minima verifier fixture package;
- preserve the no-funds and snapshot-isolation boundary.

This authorization produced the proposal and first read-only mainnet RPC fixture. On 2026-08-19 the
founder superseded its external-contact branch: the project will not depend on Minima-team priorities,
a Minima Core change or a private Core fork. The public-chain target must run on stock Minima mainnet.
The founder then selected the recommended hybrid research architecture: Ethereum-to-Minima uses a
decentralized bonded threshold-attestation design, benchmarked first at 5-of-7, while
Minima-to-Ethereum retains proof verification on Ethereum. The stock-KISS proof-verifier search
continues as a non-blocking research lane.

The founder then generalized the protocol beyond one token and prioritized native ETH feasibility.
Each asset now has an isolated lane. `ETHm` is a provisional research name, not a decided production
token identity.

## Decisions still open

No remaining choice below is inferred by the research package.

1. Final proof-system promotion

   Choose only from candidates that can execute with the current KISS registry, witness format,
   1,024-operation limit and 64 KiB TxPoW limit. A candidate requiring a Core change is rejected.

2. Verification-key governance

   Immutable activated key, or narrowly versioned and delayed consensus registry. A mutable remote
   gateway adds a trusted governance role.

3. Ethereum bootstrap governance

   Select the authority and maximum age for the weak-subjectivity checkpoint, fork schedule and
   offline refresh. Refresh may not reset nullifiers, liability or reserve state.

4. Production lane decimals

   A fresh USDTm token is decided and mxUSDT is outside scope. Six decimals remain the recommendation
   for exact USDT atom parity. Native ETH targets 18 decimals for wei parity, but this exceeds the
   standard Minima token-creation safety default and must pass the compatibility gate. Every other
   lane requires exact conversion, divisibility and dust rules.

5. Backing claim

   Lock collateral for all fixed supply upfront, or claim backing only for covenant-released,
   issued-not-returned liability. These are materially different statements.

6. Vault governance and issuer risk

   Version 1 specifies an immutable vault. Any later delayed upgrade role is a separate founder
   decision and schema. The accepted response to USDT freeze, blacklist, deprecation or
   balance-semantics changes also remains open.

7. Minima probabilistic finality

   Choose the cumulative-work threshold, settlement delay and bridge value cap for Minima-to-Ethereum
   redemptions. No proof can establish that a heavier unseen PoW branch does not exist.

8. Production attestor committee

   Select the final quorum, admission policy, independent-control evidence, jurisdiction and
   infrastructure diversity, epoch length, rotation delay and exit delay. Five-of-seven is the
   valueless benchmark, not a production-final decision. Seven keys controlled by this project are
   one operator, not seven independent operators.

9. Attestor bonds and adjudication

   Select the per-operator bond, bridge exposure cap, slashable faults, fraud-proof mechanism,
   challenge period and recovery distribution. The minimum slashable bond of any valid quorum
   should cover the chosen cap. Slashing can deter or compensate fraud but cannot prevent a quorum
   from signing a lie.

10. Multi-asset exposure accounting

   Choose isolated committee/bond pools or one conservative common valuation rule. One committee's
   bond cannot be counted independently against every lane cap because the same quorum can attack
   all lanes.

11. Production authorization boundary

   The current chain-writing authorization is restricted to the purpose-created valueless USDTm and
   ETHm mainnet ceremony under `D-USDTM-021`. It does not authorize a Core fork, private network,
   testnet, real collateral, production token, production vault or production bridge exposure.

12. Replacement v2 valueless mainnet ceremony

   Candidate v2 passed its offline hostile rereview, but the old authorization was consumed by the
   immutable v1 ceremony. Decide whether to authorize a new one-use issuer, fresh valueless USDTm-v2
   and ETHm-v2 plus control tokens, exact regenerated token-bound covenant addresses, genesis,
   five-signature release and return of all remaining Minima. No real collateral or production
   authority would be included.

## Decisions closed on 2026-08-19

External Minima Core contact: do not send the prepared issue or make bridge feasibility depend on
the Minima team. Use stock Minima mainnet only. A locally modified Core would create a different
consensus network and cannot prove deployability on Minima mainnet.

Hybrid trust model: use threshold attestations for Ethereum-to-Minima and a stateful Minima proof on
Ethereum for Minima-to-Ethereum. Continue stock-KISS native-proof research without making it block
the hybrid prototype. The inbound direction is explicitly conditional on fewer than a quorum of
attestors colluding and must not be marketed as trustless or proof-verified.

Generic asset architecture: use isolated per-asset lanes rather than a shared multi-token reserve.
Native ETH is the first additional feasibility target. USDTm remains one candidate ERC-20 lane.

Valueless Minima token issuer wallet: the founder selected one new dedicated Minima node wallet named
`USDTmIssuer`. The local node root did not contain that name when selected. It must use a fresh seed,
run as the only active copy of that seed, receive only the exact Minima needed for creation and fees,
pin its funding and return addresses before signing, transfer the entire fixed valueless supply into
the bridge genesis reserve transaction, and then be marked `NEVER-REUSE`. It must not reuse the
founder's daily wallet, a Pool operational wallet, `SandIssuer`, or any restored seed. The wallet
choice was decided before `D-USDTM-021`. The one-use node completed both valueless token and lane
genesis ceremonies, returned every remaining Minima atom to the pinned original funding-input
address, now has no sendable coin, and is retired `NEVER-REUSE`.

Historical deposit replay boundary: the founder accepted independently reconstructed operator
journals inside the existing fewer-than-five-collude assumption. This closes `O-USDTM-016` for the
prototype. It does not turn threshold attestations into proofs and does not claim on-chain historical
non-membership.

Valueless dual-lane mainnet ceremony: the founder authorized `USDTmIssuer` for both `USDTm` and
`ETHm`. The ceremony-only parameters are the values already exercised by the settled P7 benchmark:
USDTm uses 6 decimals, 1,000,001 fixed supply and 999,999.999999 cap; ETHm uses 18 decimals, 11 fixed
supply and a 10 ETH-equivalent cap. These command-native integer supplies supersede the synthetic
one-atom margins because stock Core 1.1.2.6 `tokencreate` floors token count before applying decimals.
Neither token has a token-level restriction beyond the default `RETURN TRUE`. The full supplies must
move into their isolated genesis reserve transactions, remaining
Minima returned to the pinned funding address, and the empty issuer is now `NEVER-REUSE`. Both
stateful control coins and both stateless full-supply reserve coins are mined at their isolated
covenants. No real collateral or production action is authorized; the next gate is a real 5-of-7
signed covenant transition, which proves mechanics but not decentralization while one fixture node
controls all seven test keys.

Live P7 correction boundary: the authorized v1 USDTm release was dropped after its exact
`STATE(17) == @BLOCK` check became stale. Both inputs remain unspent, but the immutable v1 script is
not operationally acceptable and the first five test keys each consumed one WOTS use. Candidate v2
uses a monotonic nonfuture construction height within the fixed posting-lag bound and passes its
offline regression. The strengthened hostile rereview now passes 70 assertions and 66 hostile
checks per lane, with each posting-height guard exercised independently and the five failed WOTS
uses surviving one normal restart. No replacement token creation, funding or mainnet genesis is
authorized by `D-USDTM-021`; `O-USDTM-017` requires a fresh founder authorization first.

P8 all-branch valueless mainnet ceremony: the founder authorized `D-USDTM-023` with a fresh one-use
`USDTmIssuerP8` wallet and fresh USDTm-P8, ETHm-P8 and control IDs. The authorization covers exact
token-bound genesis and mining CLIENT_UPDATE, RELEASE, CANCEL, RETURN and PAYOUT_ACK for both lanes,
then returning all residual Minima to the exact funding-input address and retiring the empty issuer
as `NEVER-REUSE`. It does not authorize real collateral, production deployment or changes to the
concurrent Pool Test V8 work.
