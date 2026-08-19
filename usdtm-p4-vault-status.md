# Generic bridge P4 valueless Ethereum vault status

Status: local implementation gate passed, independent hostile review open.

The local source contains a six-decimal valueless mock token, a mock Minima-proof interface, one
immutable ERC-20 lane vault and one immutable native ETH lane vault. The ERC-20 vault measures the token balance delta, stores only
`ABSENT`, `PENDING` and `REFUNDED` Ethereum deposit states, reserves capacity from the measured
amount, consumes redemption IDs before transfer, shares one reentrancy lock, supports false and
no-return token behavior, and exposes no owner withdrawal, sweep, delegatecall or self-destruct path.

The native lane accepts value only through the named deposit function, records exact `msg.value`,
rejects normal direct transfers and maintains an explicit `accountedNativeAtoms` ledger. Forced ETH
can increase raw contract balance but cannot increase attributable collateral or capacity. Refunds
and redemptions decrement the ledger before the external call under the same global lock; receiver
failure or callback reentry reverts every effect. Version 1 has no native withdrawal or
forced-surplus sweep.

The native constructor also limits configured capacity to the current unsigned 64-bit Minima
single-limb maximum. The 10 ETH valueless fixture stays below that boundary; a deployment configured
above 18.446744073709551615 ETH equivalent rejects before runtime identity is established.

`validate-usdtm-p4-vault-model.mjs` checks the reviewed source for these boundaries and executes a
separate JavaScript semantic model for fee-on-transfer receipt, malformed recipient, capacity floor,
exact proof fields, failed transfer rollback, replay and both shared-lock callback directions.

The project-local Hardhat 3.13.0 toolchain compiles with the exact Solidity
`0.8.24+commit.e11b9ed9` build, Shanghai EVM target and optimizer runs set to 200. Twenty-two Mocha tests
execute the real bytecode locally, including forced native balance, exact `msg.value`, receiver
failure and native callback reentry, plus fee-on-transfer receipt, false, reverting and no-return
token behavior, capacity rollback, proof mismatch, replay, failed payout rollback, both
cross-entrypoint callback directions, mixed-lifecycle accounting and an exact deployed-runtime match
after masking only compiler-declared immutable ranges. `package-lock.json` pins the complete graph.

The corrected vault also stores an append-only sequential payout record for every redemption and
requires each mock verifier result to bind the exact vault runtime identity. This supplies the
persistent cursor and cumulative paid values required by the P2 payout-batch schema and rejects
cross-deployment proof reuse at the vault boundary.

The local P4 implementation gate is satisfied, but Bay law 14 keeps the phase gate open until an
independent hostile review returns with no unresolved critical or high defect. A persistent public
deployment is not required for this local mock phase and remains unauthorized. The mock verifier
proves only the interface and must never be described as Minima proof authenticity; P5 and P7 own
that later evidence.
