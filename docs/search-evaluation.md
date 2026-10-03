# Search evaluation

The acceptance set is [`evaluation/search-cases.yaml`](../evaluation/search-cases.yaml).
The evaluator uses the product's ranking and weights on `dist/preview/generated`
(falling back to `site/public/generated` when no preview exists). Build a fresh
preview before evaluating; build/privacy checks validate publication separately.

```sh
scripts/devenv-run pnpm build:preview
# Exact metadata/reference/BSB matching, without query-model inference.
scripts/devenv-run pnpm evaluate:core -- --exact-only
# Exact plus hybrid matching with actual pinned-model query embeddings.
scripts/devenv-run pnpm evaluate:core
```

Default coverage is milestone 4 (all current cases). `--milestone 2` or
`--milestone 3` selects cases and source-date checks up to that milestone; it does
not remove other recordings from the index. `--implementation` is no longer an option.

Metadata schema 5 binds the binary filename/checksum to the ordered `SearchUnit[]`.
BSB remains separate, deduplicated retrieval text. Search results are ranked as
recordings, matching the UI: a recording's own row, chapter, subchapter or point can
satisfy an `acceptableServiceIds` target. Some cases supply an `exactQuery`
companion; passing that query does not establish exact recall for the longer
natural-language question used in hybrid mode.

Cases cover rank thresholds, full calendar dates, match reasons and honest empty
results. Full ISO/English dates constrain every result to that date. Source-date
checks verify the date of each upload still present in the archive; deliberately
omitted uploads are reported as left out. No recording-specific query aliases
occur in the ranking algorithm.

JSON reports include the artifact path and metadata hash, unit count, source-date
checks, actual query for each mode, accepted recording rank and top three results.
Failures set exit code 1. Missing or invalid query embeddings block hybrid
acceptance; fixture embeddings do not count as real-model evidence.

`tests/evaluation.test.ts` checks reporting with fictional fixtures. Earlier
real-corpus results are retained in the [historical run log](history/run-log.md),
not evidence for the current format. Measure current performance separately with
`pnpm benchmark:search` against the checked-in budgets.
