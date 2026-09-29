# Fast feedback and full validation

Run commands inside the development environment (`scripts/devenv-run <command>`),
or with Node 22.12+, pnpm 10.17.1 and Python available. Install dependencies with
`pnpm install --frozen-lockfile`; browser checks also need `pnpm exec playwright install chromium`.

## Daily commands

| Command | What runs |
| --- | --- |
| `pnpm test:search` | Reference/ranking contracts, prepared-index equivalence, real scorer-to-renderer integration; no build, browser or model required |
| `pnpm test:watch` | Vitest watch mode; reruns tests affected by source changes |
| `pnpm test:watch search-contract` | Watch just that contract file while fixing a failure |
| `pnpm test` | All ordinary Vitest tests plus Python, in independent bounded processes |
| `pnpm check` | Unit, Python, lint, types, archive and fresh-build browser validation |
| `pnpm check lint types` | Only these independent groups |
| `pnpm check browser` | Production + preview builds, built-artifact tests, Pages checks, browser tests and exact-search acceptance |
| `pnpm test:e2e` | Browser tests against already-built `/replay-check/` output |
| `pnpm test:e2e --last-failed` | Rerun failed browser cases against the same build |
| `pnpm test:model` | Three explicit offline Node/tokenizer/browser-model integration checks; prepare assets first with `pnpm model:prepare` |
| `pnpm test:e2e:model` | The real semantic browser acceptance cases, once on desktop |
| `pnpm test:performance` | Isolated thumbnail timing assertion; run on an otherwise idle machine |

The model, built-artifact and performance suites have separate configurations. Missing
prerequisites fail an explicitly selected suite, rather than silently skipping it.
`pnpm test:built` needs a fresh `pnpm build:test`; it is automatically included in
the browser validation group. The old `RECS_TEST_*EMBEDDINGS`,
`RECS_TEST_CHAPTER_MODEL` and `RECS_TEST_PREVIEW_CORRECTIONS` opt-in flags are replaced
by these explicit commands.

## Work on a failure while other checks continue

`pnpm check` streams labelled output from each group and prints a result and rerun
command as soon as that group finishes. A failure does **not** cancel independent
groups. The overall exit status is nonzero if any group fails, times out or is cancelled.
Ctrl+C terminates owned process groups, including their servers/subprocesses.

For example, when search fails, rerun `pnpm test:search` or use its watch command
while unrelated checks finish. Every check report records the starting Git revision
and a fingerprint of tracked edits and untracked source. If source changes during a
run, that run still finishes collecting results but exits nonzero: rerun affected
groups against the final source before treating the revision as validated.

Timing/status reports are written under `.local/testing/` with unique filenames.
They contain group results and rerun commands, not captured test logs or archive data.

## Resource limits and isolation

Defaults are conservative: at most four scheduler slots (capped by available CPUs),
two isolated Vitest file workers, and two Playwright workers. Python runs sequential
test cases in a separate interpreter alongside Vitest. It uses process-global mocks,
signals and file descriptors, so do not parallelize its cases with threads.

```sh
RECS_TEST_JOBS=2 pnpm test              # total scheduler budget
RECS_TEST_WORKERS=1 pnpm test:unit      # reproduce a file-parallelism issue
RECS_E2E_WORKERS=1 pnpm test:e2e        # reproduce a browser concurrency issue
RECS_TEST_PORT=4273 pnpm check browser # use 4273 + 4274 in another worktree
```

The scheduler counts nested runner workers against its budget. It also serializes
`astro check` and the browser-build group, because both write `.astro/`.
Production and preview builds are sequential: they share `site/public/generated/`.
Run one build/browser-validation invocation per worktree; use separate worktrees,
port pairs and output roots for simultaneous independent invocations. Never reuse
an arbitrary server already listening on the selected ports.

Vitest retains file isolation and sequential cases within a file. Editorial tests
register approval, merge/history and guard groups in separate entry files, each
with its own environment and disposable Git repositories. All mutating fixtures
must own their temporary roots. Model and timing suites run separately from the
ordinary concurrent pool.

## Browser coverage policy

Every ordinary test runs on desktop. Mark tests `@responsive` when they assert
responsive composition, keyboard/touch operation, overflow or accessibility: those
also run in portrait and landscape. All existing axe routes retain three-view coverage.
Viewport-independent publication, reference and controller contracts run once.

Mark actual inference tests `@model`; the explicit model project selects those with
one worker. Ordinary tests block model/worker requests by default. The explicit
model command sets `RECS_E2E_NO_MODEL=0`. Deterministic player adapters still test
controller behavior rather than actual YouTube availability.

Test pages, storage, routes and outputs are per-test. Use `testInfo.outputPath()`
for attachments and observable readiness/polling instead of fixed sleeps. Built
fixture responses may change in a test; shared archive files must not.

## Catch bug classes, not only reported examples

`tests/search-contract.test.ts` uses a hand-authored identity oracle, independent
of the production parser. It covers full/abbreviated/multiword book names, Arabic
and Roman numerals, permitted lowercase names, citation separators, separate metadata
fields, invalid references and evidence provenance. Both search APIs must satisfy
expected inclusion **and exclusion**; agreement between them alone is insufficient.

The generated section makes 300 bounded range cases per run. An enumerated set of
verse numbers supplies expected overlap and coverage, rather than reusing production
interval math. Inputs are small, seeded, and printed on failure:

```sh
RECS_TEST_SEED=42 pnpm test:search
```

There is no unbounded random search. Keep a fixed default seed and turn any newly
found failure into a named table case. The production alias table is also tested
for vocabulary coverage, but is not used to invent expected identities in the
independent contracts.

The historical truth-table replay detected the failures in `4d13049`, `3b4d806`
and `2068a58`, and passed on `38e0ebf`. Ordinary tests do not need Git history.
Fixtures must also make the wrong alternative genuinely competitive: the old
two-verse negation fixture gave every shared term zero IDF, so it passed even
without the negation guard. Its expanded corpus and the presentation contract now
explicitly reject the wrong passage when no correct alternative is cited.

`tests/search-presentation.test.ts` exercises validation/enrichment → prepared
search → recording grouping → the real verse selector → rendered links. It checks
negation attachment, query-local caches, explicit-reference priority, deduplication,
label alignment and hidden-text exclusion. The focused browser contract suite checks
actual hydration and delayed Bible data against the current query.

The prose scanner has an intentional ambiguity policy: lowercase everyday words
such as `mark` or `acts` alone are not treated as book names. Exact-reference queries
and structured citations remain case-insensitive. General natural-language
understanding is not the contract of the lexical verse selector.

## CI and deployment

Code quality, unit/Python tests, archive/build/browser validation and editorial
guard start as independent jobs. Code tests do not wait for Chromium installation.
The existing required `validate` check aggregates **all** jobs with `if: always()`;
failure, cancellation or an unexpected skip blocks it. Deployment still depends
on `validate` and `editorial-guard`, and only production output is uploaded.

## Measurement checkpoint

On the development machine, based on PR #3 at `38e0ebf`:

- Original `pnpm test`: **88.2s**, 534 ordinary Vitest tests plus 98 Python tests.
- Parallel runner after splitting editorial groups: **52.6s**, with more than 100
  additional contract/runner tests and the same 98 Python tests (about **40% faster**).
- Original browser scheduling/project policy against the same build: **3.6m**,
  79 passed and 8 expected skips.
- New browser policy: **2.0m**, 70 passed, including three new search contracts
  (about **44% faster**). Reduced count comes from viewport-independent duplicates
  and explicit model selection, not removing responsive/accessibility assertions.

These are local wall-clock observations, not a statistical benchmark or a promise
about GitHub runner timings. CI speedup must be measured after the workflow runs
on the pushed revision. Keep the reports and compare like-for-like hardware, cache
state and source; do not run performance measurements under unrelated heavy load.
