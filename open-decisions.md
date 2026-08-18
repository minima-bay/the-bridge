# Open founder decisions

Date: 2026-08-18

No choice below is inferred by the research package.

1. Minima protocol posture

   Approve discussion with Minima Core for a native bounded verifier, require current KISS only, or
   stop the Ethereum-to-Minima trustless route. Current evidence refutes the tested KISS-only path.

2. Proof-system promotion

   Benchmark both the compact pairing-based and native hash-based tracks, then choose only from
   executed Core results. Groth16 is the first recommended feasibility target, not a final selection.

3. Verification-key governance

   Immutable activated key, or narrowly versioned and delayed consensus registry. A mutable remote
   gateway adds a trusted governance role.

4. Ethereum bootstrap governance

   Select the authority and maximum age for the weak-subjectivity checkpoint, fork schedule and
   offline refresh. Refresh may not reset nullifiers, liability or reserve state.

5. Token policy

   Fresh six-decimal fixed-supply token, fresh eight-decimal token with exact scale rules, or a
   separately approved legacy mxUSDT migration. Existing mxUSDT is not silently included.

6. Backing claim

   Lock collateral for all fixed supply upfront, or claim backing only for covenant-released,
   issued-not-returned liability. These are materially different statements.

7. Vault governance and issuer risk

   Version 1 specifies an immutable vault. Any later delayed upgrade role is a separate founder
   decision and schema. The accepted response to USDT freeze, blacklist, deprecation or
   balance-semantics changes also remains open.

8. Minima probabilistic finality

   Choose the cumulative-work threshold, settlement delay and bridge value cap for Minima-to-Ethereum
   redemptions. No proof can establish that a heavier unseen PoW branch does not exist.

9. Research authorization boundary

   This package authorizes no Core fork, deployment, token creation, transaction signature, testnet
   post or funds. Each next rung needs explicit authorization.
