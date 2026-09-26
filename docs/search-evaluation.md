# Search evaluation and full-date queries

## Status and ownership

The M3 evaluator and regression tests are implemented and verified: **74/74
actual-model acceptance checks passed** against the completed M3 preview. The final
browser/state evidence is recorded in `docs/milestone3-ui-checks.md` and the run log.
Historical measurements in [`milestone2-checks.md`](milestone2-checks.md) describe
the previous M2 checkpoint separately.

The human-readable acceptance set is
[`evaluation/search-cases.yaml`](../evaluation/search-cases.yaml). Ranking always
uses the product's shared `search()` and centralized `SEARCH_WEIGHTS`.

## General calendar-date behavior

A whole query is recognized as a date only when it is a valid calendar date in
one of these forms:

- ISO `YYYY-MM-DD`, e.g. `2026-07-05`.
- English day–month–year, e.g. `5 July 2026`, `05 Jul. 2026`.
- English month–day–year, e.g. `July 5 2026`, `Jul. 5, 2026`.

Full month names and the common three-letter abbreviations work, as does `Sept`.
Case and whitespace normalize consistently with other search input. Parsing uses
explicit month/day bounds and Gregorian leap-year rules, not locale-dependent
`Date.parse` or rollover. Supported years are `0001`–`9999`.

Once recognized, the date **constrains `passage.date` exactly before lexical or
semantic scoring**. Neither an incidental transcript date nor a highly similar
embedding can admit another date. Multiple eligible services on the same date
remain searchable. Valid dates with no eligible content return no results.

Years alone (`2026`), partial dates (`July 2026`, `5 July`), mixed questions
(`5 July 2026 prayer`), unsupported formats and invalid dates remain ordinary text
queries. Invalid input is never silently converted to another calendar day. This
does not promise that invalid input has no ordinary text matches.

Existing scripture parsing/reference bonuses, BSB verse-text weighting, topic and
speaker weights, semantic cutoff and deterministic tie ordering are unchanged.
The date constraint is general; there are no July-specific search aliases or
recording IDs in product ranking code.

## Evaluator modes and publication

Run `scripts/evaluate-core.ts` through the existing bounded devenv wrapper:

| Option | Behavior |
| --- | --- |
| Default / `--milestone 3` | All eligible preview passages; M2 and M3 acceptance cases. |
| `--milestone 2` | Core-service ranking subset and M2 cases, usable before M3 curation finishes. |
| `--implementation` | Additional temporary implementation-run gate: every interpreted service must remain `needs_review` and production must be empty. |

Both milestone modes validate **the entire current source and both generated
projections**, even when query ranking is scoped to M2. Additional services and
physical uploads are allowed. The five stable core service IDs remain required,
with their original ordered physical-ID lists: exactly eight uploads **inside
that core scope**, never eight across the whole archive.

Normal evaluation compares:

```text
preview    == enrichPassages(flattenArchive(currentSource, 'preview'))
production == enrichPassages(flattenArchive(currentSource, 'production'))
```

This admits future human-approved, playable material in production and verifies
its BSB enrichment too. Preview flags follow source editorial status; a preview
build can contain both reviewed and unreviewed passages. CI using the normal
command must not assume every source remains `needs_review` or production stays
empty forever. Use `--implementation` only for the ongoing agent run. The
evaluator performs no editorial approval or source mutation.

## Case contract and reports

Each case declares a stable `id`, `milestone`, `kind`, `query`, and explanatory
`note`. Supported kinds:

- **`rank`**: acceptable passage, service and/or video IDs plus positive integer
  `maxRank`. Lists are alternatives within a field; all supplied fields must match.
  Optional `speaker` and match-reason prefix constrain acceptance further.
- **`date`**: rank expectations plus `expectedDate`. The query must parse to that
  date. The complete result set must contain **all and only** eligible passages
  dated that day, not merely a correct first result.
- **`excluded-media`**: no result may reference a currently excluded source video.
  Full-index and navigation checks also run independently of query recall.
- **`empty`**: zero results in each mode. `zxqvpl-no-match` is deliberately
  out-of-vocabulary. Empty search is a retrieval outcome, not a theological claim.

`sourceDates` declares expected dates by physical video ID. The evaluator resolves
the current owning service and checks both source and indexed dates. It does not
infer dates from directory names or a misleading recording title.

The schema rejects unknown keys, duplicate IDs/YAML keys, empty case/target lists,
invalid dates and nonpositive/noninteger rank thresholds. Missing required cases,
missing metadata cases and absent eligible targets fail rather than skip. Stable
required coverage IDs are guarded in the script; query text, acceptable targets,
dates and thresholds are authored in the YAML.

Each case runs twice: exact search and hybrid search using **actual `embedTexts`
query embeddings** from the pinned prepared local model. The evaluator never
downloads models or invokes remote inference. Unit-test vectors only test report
plumbing; they do not count as real-corpus acceptance.

JSON output includes corpus and scoped counts, source exclusions, checks, and a
row per query/mode with pass/fail, accepted rank (`null` if absent or not applicable),
threshold, result count, accepted IDs, failure detail, and the top three actual
results. Each top result includes passage/service/video IDs, date, timestamps,
score to six decimals and match reasons. `top[0]` is the top result; an honest empty
case has `top: []`. Failures set CLI exit code 1.

As before, input artifacts prefer
`dist/preview/generated/{passages,vectors}.json`, falling back to the canonical
`site/public/generated/` pair only if the preview passage artifact is absent.
The built production passage index is required. Strict source validation, exact
enriched projection equality, vector digest/config/ID/document/norm checks and
prepared/built model hashes must pass before hybrid inference. Missing/stale
artifacts or embedding failures cannot earn a hybrid pass through lexical fallback,
including for an empty-result case. At least one real semantic contribution must
be observed. Importing the script for Vitest does not invoke its CLI.

## July identity, unresolved sources and Tripping handoff

- **`OrsN83j3qxE` is July 5, 2026.** ISO, day-first, month-first and abbreviated
  date cases require its results and exclude other dates throughout the result set.
- **`D-FyolbxJgk` is July 12, 2026**, despite its July 5 source title. Evaluation
  uses the physical ID and expected date. Full curation replaced the temporary
  uncommitted `2026-07-05-d-fyolbxjgk` ID with `2026-07-12`; the date retrieval case
  now checks its eligible passages without tying identity to a misleading title.
- These are **distinct programmes**, not an enforced one-service July pair.
  Nothing in evaluation prescribes whether short **`MZr169xBwrU`** shares a July 12
  service or is independently retained, or what its disposition must become.
- Exclusions are re-derived from current source for **every `failed`, `rejected`
  and `unassessed` upload**, and checked against both indexes and sanitized
  service/video/section/passage navigation projections. Identifier-only corpus
  records are also considered; once interpreted, the service's video disposition
  supersedes the earlier discovery receipt. A candidate becoming playable stops
  being treated as permanently excluded. No rejected/unassessed source is invented
  merely to populate a real-corpus category; synthetic tests exercise all three.
- Tripping's stumble question requires evidence-backed passage IDs from
  `docs/tripping-review.md`, not merely any result from service `2020-07-19`.
  Luke 17:1-9 and Matthew 18:5-7 require scripture-reference match reasons. The
  final M3 run returned the relevant rights/stumbling passage first in both modes.

## Reproducing verification

Run only after the active media worker has released the environment. Use sequential
commands; production and preview share intermediate generated files.

```sh
scripts/devenv-run pnpm exec vitest run tests/search.test.ts tests/scripture.test.ts tests/evaluation.test.ts
scripts/devenv-run pnpm exec eslint site/lib/search.ts scripts/evaluate-core.ts tests/search.test.ts tests/evaluation.test.ts tests/e2e/milestone2.spec.ts
scripts/devenv-run pnpm typecheck

SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build:preview
scripts/devenv-run pnpm evaluate:core -- --milestone 2 --implementation

# After all M3 curation, source-date reconciliation and Tripping target review:
# Refresh both builds again if content changed, then run all-corpus acceptance.
scripts/devenv-run pnpm evaluate:core -- --milestone 3 --implementation
# Normal long-term/CI mode permits human approvals:
scripts/devenv-run pnpm evaluate:core
```

The wrapper's default finite timeout is 900 seconds. Preserve JSON reports as
actual execution evidence; do not replace failed thresholds with invented ranks.
Review relevance before changing targets or weights.

Final M3 evaluation passed **74/74 checks** over **688 preview / zero production
passages**. The latest baseline question met its top-three threshold at rank two;
all date-format cases returned only their exact event date. The no-results and
disposition-exclusion cases passed in both exact and actual-model hybrid modes.

Browser publication assertions derive the featured badge and production-home state
from current source eligibility, so later human approval does not itself break CI.
Empty and approved/unapproved featured states are independently covered by fictional
render fixtures in `tests/publication-ui.test.ts`; these never enter archive data.
The full M3 browser/axe evidence is recorded in `docs/milestone3-ui-checks.md`.
