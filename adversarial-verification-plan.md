# Adversarial verification plan

Date: 2026-08-18  
Status: required test plan, no funds

## Safety claims to attack

1. Inbound release requires five unique active-epoch attestations over one exact canonical record.
2. Attestations authorize only their exact chain, deployment, direction, amount, recipient and vault
   snapshot, while the covenant independently pins the complete reserve transition.
3. An inbound release accepts an equal authenticated vault snapshot or exactly the next snapshot;
   stale, skipped or internally inconsistent snapshots reject.
4. One source message changes the reserve and liability at most once.
5. The reserve transition conserves every token atom.
6. Minima cannot issue plus reserve pending-redemption liability above the proof-bound finalized
   attributable vault balance.
7. Invalid work is bounded for nodes and cannot create a cheap consensus denial of service.
8. Unknown forks, code states and verifier versions halt before value moves.

These are covenant and quorum-mechanics claims. They do not claim a quorum-signed Ethereum fact is
true. The deliberate five-signer false-claim counterexample must remain accepted in the semantic
model so the conditional trust boundary cannot be hidden.

Every claim is lane-local under `D-USDTM-018`. A source asset, destination token, reserve, nullifier
or cap from one lane must never satisfy another lane.

## Threshold-attestation attacks

| Attack | Expected result |
|---|---|
| four valid active signatures | reject safely |
| duplicate signer counted twice | reject, not reduced quorum |
| outsider or inactive signer | reject |
| one signature reused after any record-field mutation | reject exact digest mismatch |
| stale or future committee epoch | reject |
| wrong committee root, chain, network, vault, token or covenant | reject |
| stale vault-state version | reject |
| vault-state version skips the exact next version | reject |
| equal version changes balance, payout cursor, cumulative paid amount or block | reject |
| advancing version rolls back block, payout cursor or cumulative paid amount | reject |
| five active signers attest a fabricated but well-formed deposit | accept in the threshold-only model and record the conditional-safety breach |
| signer-controlled unrestricted output or fee | reject exact outputs; no such branch exists |
| seven keys under one controller claimed as decentralized | reject production evidence |
| quorum exits before fraud challenge ends | reject committee policy |
| minimum slashable five-signer bond below exposure cap | reject production configuration |
| signature-only size fits but complete TxPoW exceeds 64 KiB | fail P7 |
| WOTS leaf reused after crash or restored-node rollback | fail P7/P9 before signing resumes |

## Generic lane and native ETH attacks

| Attack | Expected result |
|---|---|
| ETH record replayed against ERC-20 lane | reject lane ID and asset-kind mismatch |
| same deposit identifier exists in two valid lanes | independent lane-domain nullifiers, no collision |
| native kind carries nonzero source token address | reject configuration |
| ERC-20 kind carries native zero-address sentinel | reject configuration |
| decimal, quantum, destination token or lane epoch changes after signing | reject exact digest mismatch |
| ETH sent without the named deposit function | not an accepted deposit record |
| ETH forced into the vault without executing code | raw balance may increase; attributable collateral remains unchanged |
| native payout attempts to consume forced surplus | reject against internal accounted balance |
| native receiver reenters refund or redemption | shared global lock rejects nested effect |
| native receiver rejects the call | full payout and counters revert |
| ERC-20 requested amount exceeds measured received amount | record and capacity use measured increase only |
| exact-wei amount exceeds `2^64 - 1` | reject the single-limb lane |
| 18-decimal token displays, sends or compares with lost precision | fail P8 compatibility gate |
| ETH action changes USDT reserve, nullifier or counters | reject and require byte-identical other lane |
| one committee bond is counted once per lane | reject production economics; aggregate shared-quorum exposure |

## Deterministic Core vectors

| Attack | Expected result | Evidence required |
|---|---|---|
| one-bit proof mutation | reject | two implementations, exact vector hash |
| one-bit public-value mutation | reject | exact public hash and verdict |
| proof valid under different VK | reject | pinned expected VK hash |
| valid proof under wrong program | reject | pinned expected program hash |
| non-canonical field or point | reject | parser-level vector and bounded cost |
| invalid subgroup or infinity case | reject | cross-implementation agreement |
| truncated or length-confused proof | reject before expensive verification | CPU and allocation trace |
| duplicate witness index | exact selected witness only | transaction verdict |
| unknown system or verifier version | reject | pre and post activation vectors |
| maximum invalid proof | bounded | time and memory below consensus budget |
| repeated `VERIFYZK` call | cached identical result | verifier-call count |
| architecture/JVM variation | identical verdict | independent node logs |

## Ethereum-client attacks

| Attack | Expected result |
|---|---|
| stale or poisoned bootstrap checkpoint | reject or remain halted |
| update not extending stored state | reject |
| same-period conflicting update | deterministic one-state transition, no parallel history |
| old update replay | reject |
| wrong current or next committee | reject |
| low sync-committee participation | reject under configured finality rule |
| invalid BLS aggregate | reject |
| wrong fork domain or schedule | reject |
| unsupported Ethereum fork | halt |
| bad SSZ execution branch | reject |
| transaction included but receipt failed | reject |
| malformed typed or legacy receipt | reject |
| malformed RLP or MPT branch | reject |
| client advances past an unconsumed older vault record | record remains provable under current finalized state root |
| vault record is deleted or reused | impossible under pinned runtime; otherwise reject code/state |
| vault record becomes refundable without a finalized matching Minima cancellation | reject |
| direct USDT transfer without vault commitment | reject |
| right event from wrong vault or token | reject |
| proof-system ID or verifier version differs | reject |
| vault runtime, implementation or admin-state hash differs | reject |
| token runtime or token-semantics hash differs | reject |
| historical event already refunded | reject |
| vault runtime, proxy or admin state changed | reject or invoke explicit version transition |
| USDT runtime or deprecation semantics changed | halt before release |
| proved attributable balance below issued plus pending liability | reject inside consensus |

## Covenant attacks

| Attack | Expected result |
|---|---|
| same message submitted twice | first canonical transition only |
| release and cancellation race on one pending deposit | exactly one terminal Minima nullifier state wins |
| Ethereum refund without finalized Minima cancellation | reject |
| release proof submitted after Ethereum refund | reject authenticated vault record state |
| cancellation proof submitted after Minima release | reject terminal released state |
| repeated deposit, cancellation and proof-gated refund | restore reserved source capacity exactly once per never-released deposit |
| cancellation signature changes action, chain, deployment, record, token, amount, scale, recipient, authority or epoch | reject every changed field |
| valid cancellation signature paired with a different finalized `PENDING` record | reject exact record mismatch |
| cancellation proof field changed after authority signs | reject exact record equality and signature verification inside the cancellation transition |
| cancellation mines but its proof is withheld | funds and capacity remain locked; any prover may later relay the public proof |
| refund token transfer fails | entire `PENDING -> REFUNDED`, capacity and transfer transaction reverts |
| refund token callback reenters refund or payout | shared guard prevents every nested transfer and counter effect; outer call may succeed once |
| redemption callback reenters refund or payout | same shared guard prevents every nested transfer and counter effect |
| lookalike state coin with copied ports | reject wrong one-unit control-token ID |
| client-update action carries nonzero message or changes accounting | reject |
| second deposit from the same finalized block | accept under identical stored Ethereum state and a new nullifier |
| same-slot proof changes Ethereum client state | reject |
| equal-head release after the configured reuse window | reject against `@BLOCK` and state port 17 |
| advancing-head successor commits a future Minima construction height | reject `STATE(17) <= @BLOCK` |
| advancing-head successor rolls port 17 below its prior accepted height | reject `STATE(17) >= PREVSTATE(17)` |
| advancing-head successor trails current Minima height by one more than the fixed posting-lag bound | reject independently even when port 17 remains monotonic |
| advancing-head successor is at lag zero, lag one or the exact posting-lag boundary | accept when every other field is valid; ordinary mempool delay must not invalidate it |
| stale head reused after a later issuer code or balance-semantics change | reject after the reuse window; residual risk inside the window remains disclosed |
| old Ethereum heads advanced one historical slot at a time | reject authenticated execution timestamp outside the source-age bound |
| Ethereum execution timestamp leads Minima consensus time beyond the skew bound | reject |
| alternate `Mx` text encoding for the same recipient | never enters consensus; only exact raw 32 bytes are accepted |
| simultaneous submissions | one state spend wins, loser reconciles and then rejects |
| changed recipient or amount | reject |
| decimal overflow, rounding or dust | reject |
| reserve coin without client-state coin | reject |
| client-state coin without reserve coin on release | reject |
| short reserve output causing burn | reject exact conservation |
| extra payout output | reject exact output shape |
| state port changed outside allowed transition | reject |
| client update is raw, carries nonzero message amount, repeats an equal head, skips the authenticated head or changes proof-bound balance/counters | reject before mutation |
| signer or admin drain | no such branch exists |
| donation coin added to address balance | never changes canonical `R`, `I` or capacity |
| equal-amount reserve lookalike replaces the previously observed reserve coin | at most one release under the unique state-control coin; old coin is quarantined surplus and cannot increase `R` or `I` |
| two equal-amount reserve inputs accompany one control coin | reject exact input count |
| displaced reserve later equals current `R` again | may substitute only with the current control coin and exact branch; cannot add a transition |
| constructor picks newest, first or last covenant coin as canonical | reject design; select from the confirmed successor or an explicit exact-amount candidate |
| release amount equals current reserve | reject; version 1 retains one positive reserve atom |
| source deposits would consume the one-atom reserve floor | reject source capacity before accepting funds |
| client updates and cancellations advance control repeatedly | each co-spends and recreates the reserve at sibling output 1 |
| clean restore loses reserve proof amid address pollution | reconstruct current output-1 sibling from the authenticated current control coin's creating transaction, or fail the P9/P12 gate |
| malformed earlier record | reject without blocking unrelated accumulator leaves |
| inbound uses balance reserved for pending redemption | reject `newI + P <= L` |
| payout acknowledgement repeated or exceeds pending amount | reject |
| source capacity restoration names no proved Minima return | reject fake redemption ID and leave capacity unchanged |
| source redemption payout replays or mismatches amount or recipient | reject exact settled return proof and one-time consumption |
| two or more payouts share one finalized Ethereum block | accept one cumulative batch covering the full proved delta |
| payout batch omits a record inside its cursor range | reject against cumulative vault accounting |
| outbound return supplies an arbitrary sparse-tree root | root must remain unchanged; UTXO and vault consumed-ID rules provide uniqueness |
| outbound return omits its amount-bearing input or changes its coin ID, token ID, amount, recipient or derived redemption ID | reject before any control, reserve, returned coin or accounting mutation |
| any rejected proof or covenant transition advances a client version or mutates a UTXO, cursor or accounting field | reject and leave the complete state byte-identical |
| outbound return omits or changes redemption publication ports 19 through 22 | reject exact output-0 state |
| reserve exhaustion | reject before source funds become irrecoverably trapped |
| verifier/key rotation replay | reject by version and epoch domain |
| post timeout and retry | reconcile mined state before retry |
| restored WOTS seed with rolled-back key-use depth | refuse signing before any leaf can be reused |
| two restored nodes share one WOTS seed and state | refuse concurrent activation; no signature is produced |

## Cross-chain timing and finality attacks

- Ethereum update is only at `latest`, not finalized.
- Ethereum stops finalizing after source deposit.
- Minima slows, stalls or reorganizes during redemption.
- A heavier Minima branch appears inside the settlement delay.
- A heavier Minima branch appears after Ethereum payout.
- A heavier Minima branch removes `CANCELLED` after Ethereum refund and contains `RELEASED`; record
  the double-settlement counterexample as a settlement-finality assumption breach, never a safe pass.
- Proof generation is delayed across a fork or verifier epoch.
- An inbound proof and one or more legitimate payout acknowledgements interleave in every ordering.
- Multiple deposits occur in the same finalized Ethereum block.
- Multiple payouts occur in the same finalized Ethereum block at full collateral utilization.
- All configured provers disappear and a new prover reconstructs from public state.
- Release, cancellation and proof-gated Ethereum refund race in every ordering.
- Minima permanently stops before a pending deposit can be released or cancelled.
- Minima cancellation finalizes but Ethereum stops before refund.
- Ethereum refund finalizes while a stale `PENDING` release proof remains available.

Each run records what actually happened. A safe but permanently stuck transfer is a liveness failure,
not a safety pass. A Minima late-fork loss that cannot be eliminated must be quantified and bounded by
settlement delay and value cap.

## Evidence ladder

1. schema validation only;
2. proof generated and locally verified;
3. independent verifier agreement;
4. native Minima verifier accepts or rejects the vector;
5. complete valueless transaction passes `txnbasics` and `txncheck`;
6. complete signed valueless transaction mines;
7. clean node independently observes the exact successor coins;
8. adversarial two-way valueless run;
9. independent reviewers attempt refutation;
10. audited, capped monetary decision.

Claims must remain at the observed rung. The fixture validator supplied with this package reaches
rung 1 only.

## Stop conditions

- any altered domain field remains accepted;
- any arbitrary relayer root can authorize a proof;
- client state can roll back or fork into two accepted histories;
- message uniqueness depends only on an off-chain database;
- exact token conservation cannot be enforced;
- liability plus pending payout is not compared to the exact attested vault balance and exposure cap in consensus;
- malformed proofs create unbounded or block-stalling work;
- worst-case fully signed TxPoW does not mine;
- any administrator can redirect reserve funds;
- a quorum has an unrestricted reserve-spend path rather than only exact record-bound transitions;
- threshold settlement is marketed as proof-verified or trustless;
- source refund and destination claim can both succeed;
- an accepted deposit can refund without a finalized mutually exclusive cancellation state;
- an unsupported fork, token implementation or verifier version fails open.
