# The Bridge rehome record

## Decision

On 2026-08-20 the founder designated this programme as The Bridge, a Bay-level peer of The Pool,
The Land and The Springboard. Decision `D-USDTM-027` makes `minima-bay/the-bridge` the canonical
public source and permits only a read-only pointer at the former Pool path.

## History preservation

The repository was created from a Git subtree split of
`Pool/1_working_files/working-files/zk-light-client-research`. The preserved history base is commit
`0531f31609298d1342a37ad69a67c8a204b429ab`, with its preceding bridge commit retained. Current
working material is layered on that history in the dedicated repository.

The pre-move inventory is recorded in `migration/bridge-rehome-preflight.json` with its SHA-256
sidecar. It records the source parent commit, committed and uncommitted public path counts,
destination identity and exclusion policy.

## Publication records

- Canonical repository: https://github.com/minima-bay/the-bridge
- Bridge rehome draft review: https://github.com/minima-bay/the-bridge/pull/1
- Bay website and About page draft review: https://github.com/minima-bay/minima-bay.github.io/pull/2
- Current rehome snapshot commit: `a28cf799a4b985971ce1c8530a1f458fd7a98d03`
- Bay website commit: `815cfbc`
- Local Bay-parent pointer and submodule commit: `944a120`

The Bay-parent commit remains local because that parent branch already contains unrelated,
unpublished history. The dedicated Bridge and website changes are published independently through
the two scoped draft reviews above.

## Publication boundary

Published:

- source, specifications, validators, fixtures and redacted evidence;
- repository workflows and project documentation;
- public, valueless test identifiers already present in the research record.

Never published by this migration:

- wallet seeds, passwords, private keys or environment-secret files;
- Minima node databases, restored clones or backups;
- live WOTS guard journals or signing-authority state;
- dependency caches, generated build output or local upstream source checkouts.

The former Pool location is a pointer only. Historical evidence can retain its original path text
because rewriting audit records would damage provenance.

## Security status

Moving the repository does not promote any bridge phase. `P9` remains the active gate, production
is prohibited, the P8 signing domain remains retired, and no node start, signature, transaction,
deployment or real-funds operation is authorized by this rehome.
