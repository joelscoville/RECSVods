# Static search measurement

## Status and scope

The main worker's saved **pre-change** report is
`.local/performance-before.json`, measured on 2026-09-26 against 688 preview rows.
Its status is **incomplete**: the 5,000-row scenario hit its unchanged 120-second
deadline. Completed scenarios contain measured latency failures:

| Scenario | Per-query exact p95 range | Per-query hybrid p95 range | Search JS heap |
| --- | ---: | ---: | ---: |
| Real preview, 688 rows | 326.8–414.0 ms | 417.9–477.0 ms | 14,267,604 bytes |
| Synthetic duplicated 2,000 rows | 906.9–1,098.3 ms | 1,257.8–1,350.1 ms | 29,691,324 bytes |
| Synthetic duplicated 5,000 rows | Not completed | Not completed | Not measured |

Completed size/model/cache checks passed. The report records an Intel Core
i9-9980HK host, Chromium 153.0.8010.12, 4× page CPU slowdown and the policy hash
`4851378f1cd014b7b6bbc2677489fc3bcf874389d8463616b807add0b6512d05`.
These are saved observations, not a new run or a completed overall pass.

The focused M4 change adds reusable normalized-field/reference/vector preparation
to `site/lib/search.ts` and uses that path in `SearchApp`, acceptance evaluation,
and this benchmark. The main worker subsequently verified 75 prepared-search
tests and typecheck, retained the general auxiliary/pronoun stop-word update,
and measured `.local/performance-after.json` against **1,645 eligible rows**.
That saved report completed with status **failed**:

- Real 1,645-row exact p95: **41.7–79.0 ms**; hybrid: **49.2–106.5 ms**. All real
  search checks passed, as did every 2,000-row synthetic check.
- Four 5,000-row synthetic latency checks failed: `Romans 13` exact **170.9 ms**,
  government-question exact **184.2 ms**, and `zxqvpl-no-match` exact **227.8 ms** /
  hybrid **274.6 ms**, against the unchanged 150/250 ms limits.
- The 5,000-row JS heap was **91,077,864 bytes**, below 128 MiB. All asset, cache,
  worker and external-request checks passed.

These saved measurements predate the candidate filter below. Both existing JSON
reports must be preserved. **Candidate-filter performance, heap usage, final
typecheck and corpus regressions remain pending the main worker's verification.**
The optimization worker ran only the focused fixture suite and scoped lint for
this follow-up: **82 prepared-search tests passed**, and ESLint passed on
`site/lib/search.ts` and `tests/prepared-search.test.ts`. No build, corpus regression
or benchmark was run by this worker.

The benchmark reads `dist/preview` and current shared search source. It does not
build indexes, prepare/download models, or edit archive data. Exhaustive browser
cosine similarity remains the implementation; there is no ANN, database, or
search API.

## Policy fixed before measurement

`performance/budgets.json` is the authoritative, versioned policy, defined before
running the benchmark. These are **declared development targets**, not product
promises or measured physical-phone limits. Each report includes the entire
policy and its SHA-256. Never increase a threshold automatically to make a result
pass. Review any future policy change separately from optimization evidence.

MiB means 1,048,576 bytes. Initial assets mean the actual **search entry route
without a query**, through hydration and archive fetch, not the entire website.

| Budget | Development target | Rationale |
| --- | ---: | --- |
| Initial fetched response bodies | ≤8 MiB raw; ≤2.5 MiB offline gzip-9 | Allows the present server-rendered corpus plus hydration/metadata while making excessive eager payload visible. |
| Initial model/runtime/worker requests | 0 | Exact-first discovery must not initialize the optional model. |
| Metadata / vectors | ≤8 MiB / ≤24 MiB raw | Separate limits expose metadata growth versus numeric/vector-document overhead. |
| Combined metadata + vectors | ≤8 MiB offline gzip-9 | A transfer planning target, not a claim that the local or deployed host serves gzip. |
| Hosted model / ONNX runtime files | ≤25 MiB / ≤34 MiB | Headroom around the already documented pinned q8 assets; counts all staged runtime variants, including unused ones. |
| Cold model + runtime + additional JS response bodies | ≤64 MiB | Covers one local model initialization and all additional application/worker chunks fetched in that phase, separately from index transfer. |
| Warm CacheStorage model response bodies | 0 | A return visit should reuse the model rather than redownload it; runtime and application HTTP requests remain allowed. |
| Largest hosted file | **<100 MiB** | Strict static-host file-size ceiling, inspected across the entire preview. |
| First worker request → query vector | ≤30 seconds cold; ≤15 seconds cache-warm | Bounded initialization targets for local self-hosting; no WAN-speed claim. |
| Already-initialized worker request → vector | p95 ≤2 seconds | Query inference/worker messaging, excluding the UI's 300 ms debounce. |
| Weight requests | Cold exactly 1; cache-warm 0 | Demonstrates a genuine first fetch followed by cache reuse. |
| CacheStorage | Exactly 1 weight entry; ≤25 MiB model response bodies | Observe the application's revision-scoped cache, rather than assuming browser cache success. |
| Exact search | Per-query p95 ≤150 ms | A deliberate main-thread interaction target under 4× slowdown. |
| Semantic reranking | Per-query p95 ≤250 ms | Full shared hybrid search, including exhaustive cosine and sorting, with an already-computed query vector. |
| Search JS heap | ≤128 MiB per real/synthetic scenario | A live-index JS-heap snapshot with headroom for parsing and temporary ranking allocations. |
| Cold model JS heap | ≤384 MiB page + worker | A separate isolate-aware snapshot after the first embedding, before warming queries. Not a total-memory budget. |
| External runtime requests | 0 | All page/worker resource attempts outside the current loopback origin are blocked and recorded. |

The same latency/JS-heap targets apply to real rows and synthetic 2k/5k rows.
Synthetic failures are labelled separately but still produce exit code 1; they
are evidence for planning, not evidence that the real current archive failed.
Transfer budgets apply only to actual artifacts. No compressed synthetic artifact
is produced, and duplicated rows cannot establish compression or accuracy gains.

## Exact commands, when the main agent is ready

Run from the repository root. Use the installed dependencies and Chromium; no
package installation is part of this task. `scripts/devenv-run` has a 900-second
default and terminates its process group on timeout. Keep the outer caller/tool
wait greater than that bound, rather than interrupting and orphaning a run.

```sh
# Run only after the content batch is finished. No opt-in inference is enabled here.
RECS_DEVENV_TIMEOUT_SECONDS=120 scripts/devenv-run pnpm exec vitest run tests/search.test.ts tests/prepared-search.test.ts tests/scripture.test.ts tests/performance.test.ts tests/evaluation.test.ts
RECS_DEVENV_TIMEOUT_SECONDS=120 scripts/devenv-run pnpm exec tsc --noEmit
RECS_DEVENV_TIMEOUT_SECONDS=120 scripts/devenv-run pnpm exec eslint site/lib/search.ts site/components/SearchApp.tsx tests/search.test.ts tests/prepared-search.test.ts scripts/benchmark-search.ts scripts/evaluate-core.ts

# Main worker only, after rebuilding and validating the candidate-filter preview.
# Preserve performance-before.json and performance-after.json as prior evidence.
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsx scripts/benchmark-search.ts --label candidates --output .local/performance-candidates.json
```

The same CLI also accepts `--output .local/performance-report.json`; omit
`--output` for stdout only. The default label is `current`. Flags do not override
budgets, corpus sizes, CPU rate, or sample counts. Reports must be direct
`.local/performance*.json` files: absolute paths, nested paths, traversal, public
output, symlinks, and multiply-linked target files are rejected. `.local/` is
already ignored. A named existing ordinary report is replaced; use distinct
before/after names to retain evidence. No report belongs in deployed output.

Exit codes:

- **0**: all measurements completed and all declared checks passed.
- **1**: at least one measured budget failed, including synthetic checks. The
  report retains actual values, operator, limit, scope, and units.
- **2**: incomplete/unsupported measurement or setup/argument failure, with no
  measured budget failure. Missing worker-memory evidence never becomes a pass.
- **124**: the outer `devenv-run` process-group deadline expired.

A report can be incomplete **and** contain measured failures; exit 1 takes
precedence. Read its `status`, `error`, checks, and unsupported reasons, rather
than using the exit code as a completeness claim. Startup failures before report
creation (such as invalid policy/path) print an error and return 2.

## What is measured

### Actual preview, self-hosted worker, and caches

The script verifies `dist/preview/build-mode.json`, honors its actual base path,
and serves that directory on an ephemeral loopback port using an in-process Node
HTTP server. Its responses have identity encoding and `Cache-Control: no-store`.
It inventories and hashes every hosted file, reports metadata/vector raw and
gzip-9 byte sizes, and checks the strict largest-file ceiling. It checks the
inventory again at the end to reject a concurrent rebuild.

A newly launched headless Playwright Chromium gets an isolated context with a
390×844 viewport, service workers blocked, HTTP cache explicitly disabled, and
4× **main-thread** CPU slowdown. The named network profile is
`loopback-identity-unshaped-v1`: no artificial bandwidth or RTT, no mobile-network
claim. Route interception blocks external page/worker requests. The report
records actual local response-body bytes by phase and URL; these exclude HTTP
headers/TCP/TLS overhead. Gzip sizes are computed offline at level 9, never
presented as observed wire compression.

The real built `/search/` loads without a query first. All successful fetched
responses through network-idle/hydration/archive readiness contribute to initial
assets, including HTML-embedded data and separately fetched metadata. The script
then changes the query through the application's existing history/popstate path.
An in-memory observer wraps the native `Worker` constructor and message method
to timestamp the **actual emitted worker's** requests, ready status and vectors;
it does not replace search, model, or worker implementation.

- **Cold:** fresh context, no model cache; worker request to first result includes
  worker module loading, model/runtime downloads, initialization and inference.
  Ready latency and query-to-vector latency (including UI debounce) are separate
  diagnostics. Long tasks on the main thread are recorded when supported.
- **Warm inference:** the same initialized worker embeds the remaining fixed
  queries. Request-to-vector samples exclude debounce, index download, and rank.
- **Warm cache:** reload the actual route with the original first query in the
  same context, creating a new worker. CacheStorage survives; application/runtime
  HTTP cache is disabled. The same request-to-vector interval is budgeted.
  Navigation-to-vector time is separately reported. Zero weight/model network
  bytes and the cache's actual keys/body sizes demonstrate reuse. This is **not**
  an offline-site guarantee: the script still serves JS, HTML and WASM locally.

Model and runtime files are the existing prepared copies shipped in the preview,
originally staged from `site/public/models` and `site/public/onnx`. A missing or
incompatible model causes a reported failure; the toolkit never downloads a
replacement or calls a remote model API. Worker inference is **not claimed to be
CPU-throttled**: the reproducible 4× profile specifically covers page-thread
search/reranking. A mobile viewport does not emulate a phone's hardware.

### Exact and semantic result latency

An in-process Vite server serves a blank, in-memory harness and the preview's
existing artifacts. Like the real-browser integration in `tests/search.test.ts`,
the harness performs native browser dynamic imports of the **current**
`site/lib/search.ts` and embedding contract through Vite. Relative source imports
and Bible JSON are transformed by Vite; Playwright never tries to import Node
JSON/schema modules directly. The report hashes the relevant source files and
the built artifacts. Ensure the preview was built from the intended source;
source timings and an old emitted bundle are distinct evidence, not an asserted
bundle-equivalence check.

The browser validates the vector-index schema version, compatible model metadata,
passage digest, unique IDs, every normalized vector and current embedding
document before timing. It then calls the same `prepareSearchIndex(passages,
vectors)` factory used by the product and retains that snapshot across queries.
Each scenario uses a fresh context. For each fixed query
there is one discarded warmup and five measured runs, alternating exact/hybrid
order and yielding between calls. Timers surround only:

```ts
prepared.search(query);
prepared.search(query, { queryVector, limit: 30 });
```

The latter is full **prepared hybrid result latency**, including lexical matching,
query-vector validation, all eligible cosine comparisons and sorting, not a
subtraction pretending to isolate the cosine loop. Normalized passage fields,
parsed references, exact embedding-document checks and passage-vector validation
are prepared once, as in the product. Query vectors come from the actual browser
worker earlier in the run. Fetching, parsing, importing, snapshot preparation and
query inference are outside the per-query timers.
Exact search is unbounded as in the current UI; semantic results use its limit
of 30. These timings exclude React rendering and input event dispatch, and must
not be called complete keypress-to-paint latency. Initialization is reported
separately: `initMs` includes fetch/parse/index validation/scaling and preparation
after module import; `prepareMs` is the factory-call subset of `initMs`, including
the owned passage/vector copies. Preparation is reported, not assigned a new or
relaxed budget. The saved pre-change report timed the original pure `search()`;
the saved after report timed the normalized-string prepared path. The next report
will time that same product API with the candidate filter. No candidate-filter
latency or heap improvement is claimed before the main worker measures it.

### Bounded prepared-only lexical candidate filter

Preparation now also builds snapshot-local token postings: one map for raw
normalized fields and one for folded BSB verse-text fields. Each token maps to
a sorted, unique `Uint32Array` of row ordinals. Construction deduplicates by the
last appended ordinal; no per-document word Sets are retained. Temporary number
lists are compacted and cleared. Postings belong to the owned immutable snapshot,
not a global passage-ID cache, and are rebuilt through the existing factory when
source passages or vectors change.

Each query allocates one `Uint32Array` of coverage counts. For each distinct
meaningful query term, its raw posting list and its verse-stem list are merged as
a union, incrementing each matching row once. Unknown terms remain in the full
query denominator. Distinct terms sharing a verse stem still count separately,
matching the existing scorer. The full query remains available for phrase checks;
there is no truncation, query alias, or stop-word change in this optimization.

This is a **safe lexical superset**, not a replacement scorer:

- Every literal field match appears in one of those posting lists. A row below
  the existing 60% term coverage cannot retain any lexical score, so its detailed
  field/phrase checks can be skipped.
- Structured scripture overlaps always enter detailed scoring, even when a
  query chapter or verse does not occur literally in the indexed range endpoints.
  Nonoverlapping scripture can cause harmless extra candidates; the original
  field scorer still decides their actual scores and reasons.
- Full-date queries bypass the coverage filter and retain the existing exact
  date constraint before either lexical or semantic work.
- Every eligible compatible vector is still scored, including rows with zero
  lexical coverage. Cosine arithmetic, score accumulation order, thresholds,
  reasons, final sorting and limit application are unchanged.

The 82-test fixture suite compares complete ordered results, exact Float64 scores
and reasons against the current pure `search()` oracle. Additional cases cover
unknown terms, mixed-field coverage at 60%, raw/verse deduplication, plural-stem
collisions, Unicode and phrase boundaries, range overlaps, semantic-only rows,
mutable vectors, hard dates, retained negation/title words, and queries with 300
distinct terms. Both saved benchmark reports and all budgets, synthetic sizes,
sample counts and deadlines are unchanged. Preparation overhead and live posting
storage remain part of the existing initialization/heap measurement; neither is
claimed free or within budget until measured.

All raw samples and result counts are retained. P95 uses nearest rank **for each
query**, so cheap queries cannot hide one slow query; with five samples it is
the maximum. This is a small repeatable regression workload, not a statistical
device-population study. Cold starts have one observation each, not a claimed p95.

Synthetic 2,000/5,000-row scenarios cycle through the real preview in its existing
order, deep-clone rows and vectors, and assign unique synthetic passage IDs.
They are never written to an index, application source, or public asset. Repeated
text, tied scores, and possible engine string deduplication make them unsuitable
for accuracy, real-corpus compression, or precise real-growth memory forecasts.

### Memory and hardware limitations

Reports record host OS/release/architecture, CPU model/logical cores, host RAM,
Node and actual Chromium versions, viewport, CPU multiplier and network profile.
Host RAM is descriptive hardware metadata, not measured browser consumption.

Memory is the precise Chromium DevTools `Runtime.getHeapUsage().usedSize` value:

- Search: page-isolate heap after the scenario, retaining raw passages/vectors,
  query vectors **and the prepared snapshot**, so the extra owned copies count.
- Cold model: page heap **plus the semantic worker's own isolate heap** immediately
  after the first vector. A browser-level CDP session discovers the one semantic
  worker in this newly launched browser and queries that target; it never scans
  or terminates other browser/user processes.

The worker is kept alive for that snapshot. If worker discovery, attachment, or
heap measurement is unavailable, `model.coldJsHeapBytes` is explicitly
`unsupported`, making the report incomplete rather than passing with only the
page's heap. No RSS, WASM-linear-memory, native ONNX allocation, physical-phone
memory, GC-adjusted live-byte or peak-memory claim is made. V8 heap can include
uncollected garbage. No forced GC is used. The precise-memory launch flag is
enabled, but no unsupported `performance.memory` estimate is fabricated.

## Dependencies, bounds, and next action

The repository already declares Node ≥22, `tsx`, `vitest`, `zod`, and
`@playwright/test`. The installed Playwright package read during implementation
is 1.63.0; Chromium was used in the saved baseline and is not reprobed by the
optimization worker. Vite is resolved through the installed Vitest package,
as in the existing browser integration; no new dependency or package script is
needed. Keep `PLAYWRIGHT_BROWSERS_PATH` consistent with the existing installation
if it uses an isolated cache. Rebuild and validate the post-batch preview before
measuring the optimized path.

Page/navigation/embedding waits and harness scenarios are bounded at 120 seconds,
worker-heap protocol waits at 10 seconds, browser launch at 30 seconds, and the
whole run at 780 seconds inside the caller's 900-second process-group bound.
SIGINT/SIGTERM and normal/error paths close the owned Chromium and both servers;
late browser/Vite startup is also closed. Servers are direct in-process Node/Vite
instances, with no `pnpm` preview subprocess to orphan. Vite may create its
optimizer cache only under ignored `.local/performance-vite`; no application or
public asset is generated. Reports may contain preview filenames and local
runtime URLs and are intentionally local-only.

Retain the saved before report, the batch-end after report and the next candidate
report with policy hash, hardware, browser, source/build provenance and profile.
The post-batch real corpus differs from the 688-row baseline; record its actual row count and hashes
rather than claiming an isolated same-corpus speedup. Synthetic scenarios retain
the original 2,000/5,000 counts, queries, samples and deadlines. The main worker
will profile any evidenced remaining failures after merging; this handoff does
not start an open-ended optimization cycle. Duplicated synthetic content remains
neither relevance nor compression evidence.
