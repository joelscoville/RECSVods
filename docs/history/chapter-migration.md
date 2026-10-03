# Chapter migration and permanent preservation

The one-time passage-to-chapter and concise-outline migrations are complete.
Their rewriting scripts have been retired. New curation follows
[concise outlines](concise-outlines.md) and [weekly operation](weekly-operation.md).

Original evidence remains in 44 immutable files: `chapters.internal.yaml` and
`passages.internal.yaml` for each of 22 services. They preserve the 582 original
sections and 1,646 passages. Before sealing, the completed migration was verified
against the frozen historical commit `540abab`. Historical counts/hashes remain in
[the migration record](migrations/chapter-search-baseline.json) and
[verification report](migrations/chapter-search-verification.md).

Current verification uses `services/preserved-files.json`, a self-contained list
of file paths and byte-level SHA-256 hashes:

```sh
scripts/devenv-run pnpm verify:preserved
scripts/devenv-run pnpm verify:tracked
```

The first command works in a shallow clone or source export with no Git history.
The second also inspects Git's tracked/nonignored file inventory. Neither needs
the historical baseline object. The editorial guard forbids changes or removal
of an existing seal and preserves immutable evidence across commits and merges.

Legacy schema readers remain only for validating the PR's historical commits.
Current source loading and public builds use chapters exclusively. Public output
contains neither internal originals nor transcript evidence; legacy links use
an eligible ID-only redirect map.
