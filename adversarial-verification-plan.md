# Adversarial verification plan

Date: 2026-08-18  
Status: required test plan, no funds

## Safety claims to attack

1. Only a proof under the exact activated verifier, program and key can pass.
2. A proof authorizes only its exact chain, deployment, direction, amount and recipient.
3. An inbound release extends the one authenticated Ethereum client state.
4. One source message changes the reserve and liability at most once.
5. The reserve transition conserves every token atom.
6. Minima cannot issue plus reserve pending-redemption liability above the proof-bound finalized
   attributable vault balance.
7. Invalid work is bounded for nodes and cannot create a cheap consensus denial of service.
8. Unknown forks, code states and verifier versions halt before value moves.

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
| vault record is deleted, reused or changed to refundable | impossible under pinned runtime; otherwise reject code/state |
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
| lookalike state coin with copied ports | reject wrong one-unit control-token ID |
| client-update action carries nonzero message or changes accounting | reject |
| second deposit from the same finalized block | accept under identical stored Ethereum state and a new nullifier |
| same-slot proof changes Ethereum client state | reject |
| equal-head release after the configured reuse window | reject against `@BLOCK` and state port 17 |
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
| signer or admin drain | no such branch exists |
| donation coin counted as reserve | reject from canonical accounting |
| malformed earlier record | reject without blocking unrelated accumulator leaves |
| inbound uses balance reserved for pending redemption | reject `newI + P <= L` |
| payout acknowledgement repeated or exceeds pending amount | reject |
| two or more payouts share one finalized Ethereum block | accept one cumulative batch covering the full proved delta |
| payout batch omits a record inside its cursor range | reject against cumulative vault accounting |
| outbound return supplies an arbitrary sparse-tree root | root must remain unchanged; UTXO and vault consumed-ID rules provide uniqueness |
| outbound return omits or changes redemption publication ports 19 through 22 | reject exact output-0 state |
| reserve exhaustion | reject before source funds become irrecoverably trapped |
| verifier/key rotation replay | reject by version and epoch domain |
| post timeout and retry | reconcile mined state before retry |

## Cross-chain timing and finality attacks

- Ethereum update is only at `latest`, not finalized.
- Ethereum stops finalizing after source deposit.
- Minima slows, stalls or reorganizes during redemption.
- A heavier Minima branch appears inside the settlement delay.
- A heavier Minima branch appears after Ethereum payout.
- Proof generation is delayed across a fork or verifier epoch.
- An inbound proof and one or more legitimate payout acknowledgements interleave in every ordering.
- Multiple deposits occur in the same finalized Ethereum block.
- Multiple payouts occur in the same finalized Ethereum block at full collateral utilization.
- All configured provers disappear and a new prover reconstructs from public state.

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
- proof-bound liability is not compared to proof-bound vault balance in consensus;
- malformed proofs create unbounded or block-stalling work;
- worst-case fully signed TxPoW does not mine;
- any administrator can redirect reserve funds;
- source refund and destination claim can both succeed;
- an unsupported fork, token implementation or verifier version fails open.
