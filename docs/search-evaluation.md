# Search evaluation

The acceptance set is [`evaluation/search-cases.yaml`](../evaluation/search-cases.yaml).
The evaluator uses the same chapter ranking and weights as the browser, checks
both publication-filtered builds, and reports actual top results and failures.
Run production and preview builds sequentially before evaluating.

```sh
# CI-safe: exact metadata/reference/BSB matching, no model inference.
scripts/devenv-run pnpm evaluate:core -- --exact-only

# Local: exact plus hybrid matching with actual pinned-model query embeddings.
scripts/devenv-run pnpm evaluate:core
```

Default coverage is milestone 4 (all current cases). `--milestone 2` scopes ranking
to the five core services; `--milestone 3` includes the later M3 cases. All modes
validate the current archive and built artifacts. `--implementation` additionally
requires every interpreted service to remain needs_review and production to be
empty; this is an implementation-run gate, not a permanent publication policy.

Metadata schema 3 binds the binary filename/checksum to the ordered chapter array.
BSB remains separate, deduplicated retrieval text. Public results never render
transcripts or per-chapter synopses. Invalid artifacts block hybrid acceptance;
fixture embeddings never count as real-model acceptance.

Cases cover rank thresholds, full calendar dates, excluded media and honest empty
results. Valid whole-query dates (ISO or English day/month forms) constrain all
results to that exact date before ranking. Invalid/partial dates remain ordinary
queries; no recording-specific aliases occur in the ranking algorithm.

JSON reports include corpus counts, artifact checks, each query/mode's pass status,
accepted rank and actual top three results. Failures set exit code 1. Tests of the
reporting contract use fictional fixtures; current real-corpus results belong in
the [run log](run-log.md). Performance is measured separately by `benchmark:search`
against the checked-in budgets, with preparation and query time reported separately.
