# Evidence status

The RFC schema and validator changed during hostile review. Older `rfc-fixture-validation` artifacts
remain preserved as historical run records, but they do not evidence later source revisions.

`research-manifest.json` identifies `currentFixtureEvidence` only when an evidence artifact reports:

- `passed: true`;
- the exact current fixture SHA-256; and
- the exact current validator SHA-256.

If `currentFixtureEvidence` is null, the current schema has no matching executed fixture evidence.
Sidecars authenticate an evidence file itself; they do not make stale evidence current.
