# Adaptive loading and local search

Originally implemented against `main` at `e2946c7`; the review follow-up integrates
PR #4 from `main` at `d1fbd1d`. The model and transcript-vector recipe are unchanged.

## Two independent automatic modes

| Data | Compute | Behavior |
| --- | --- | --- |
| Normal | Normal | Install semantic assets after essential readiness; initialize only on search |
| Save-data / unknown | Normal | No installation; use a verified complete cache on search |
| Any | Low-compute / unknown | Do not initialize or run the model |

There is no user mode switch. Only the two classifications are stored in the tab's
`sessionStorage` (`recs-performance:v1`); raw timing samples are never stored or sent
anywhere. Downgrades are sticky for the tab session. A new tab/session measures anew.
Blocked storage degrades to in-memory DOM state.

`site/lib/performance-mode.ts` contains the pure policy:

- Save-Data and slow-2g/2g/3g force data saving.
- Require at least 64 KiB of non-cached same-origin timing evidence. Zero-byte cache
  hits, tiny or invalid samples, and a `4g` label alone do not establish bandwidth.
- Estimate throughput over the **union** of response-body transfer intervals. This
  avoids adding overlapping rates or counting hydration/dependency gaps as transfer.
- Automatically install only if the full **45,325,675 raw bytes** are projected to
  take at most ten seconds and essential readiness was reached within 2.5 seconds.
  This is deliberately conservative: production compression is not assumed.
- Low compute: a task longer than 500 ms, more than 500 ms blocking time in a rolling
  two-second window, or over 1.5 seconds from document response end to DOM interactive.
  The initial 200 ms single-task proposal was too sensitive to one BSB preparation
  task on this desktop; the 500 ms cutoff avoids that false positive. These are
  heuristics, not hardware classifications or physical-phone guarantees.
- Cached navigations can reuse a previously measured normal session; they do not
  qualify an otherwise unknown session for a new download.

## Page lifecycle

`SiteLayout.astro` sets unknown modes in server HTML and restores a valid session
classification, then applies any switch forced on the hidden `/dev` page (kept in
`localStorage` under `recs-dev:performance`; a "Dev settings on" badge shows while one is
set). Switches change the modes in use, never the stored measurement. The small global coordinator has **no
Transformers import**. It waits for load, eager Astro island hydration, two frames,
a quiet interval and idle scheduling before considering installation. Input delays
the start; hidden pages and playback pause installation. Low-compute/data-saving
downgrades also pause it. Empty production archives do not install anything.

The coordinator has separate explicit page and installation phases. Page phases are
`loading`, `ready`, and `suspended`; installation phases distinguish `scheduled`,
`registering`, `installing`, `pausing`, `suspended`, `cached`, `unavailable`, and `idle`.
Registering is not treated as an installation request. Suspension invalidates the
attempt token; delayed registration/activation can complete but cannot start work
for a stale attempt. A visible resume reuses registration and can schedule a fresh
attempt. A late worker pause acknowledgement also reschedules eligible work.

On BFCache restoration, long-task observation reconnects with `buffered: false`.
The previous two-second sample window and counters are cleared, and entries starting
before restoration are rejected. Existing session classifications, including a
previously established low-compute mode, remain sticky. Long tasks count only while a
page loads and for two seconds after it is ready (and again after a restore), so one busy
moment later in a visit does not mark the device slow. The dev server does not measure at
all: unbundled modules and React's development build make every page look slow. Interrupted
essential hydration resumes separately from optional installation.

The modes govern only the search model: its download, the worker and meaning-based
search. Fonts and the procedural thumbnails always load; they cost little, and hiding them
made ordinary sessions look broken whenever a measurement misfired.

## Semantic asset cache

`site/pages/semantic-sw.js.ts` emits a static, base-scoped asset-only service worker.
`site/workers/semantic-cache.ts` contains its self-contained implementation.

- Only seven hash-pinned model/tokenizer/JSEP runtime files are eligible.
- The browser trace confirms this Transformers web build uses **JSEP**, even with
  `device: wasm`. The unused plain runtime pair is not installed.
- Cache identity includes deployment base, schema, model, revision, dtype,
  Transformers version and ONNX version.
- `scripts/embeddings.ts` verifies that installer hashes/sizes match actual prepared
  files. Updating dependencies requires deliberately updating this contract.
- Installation is sequential, deduplicated in the worker, and uses `waitUntil`.
  Each file is size- and SHA-256-verified before caching. Reconstructed cache
  responses contain decoded bytes and do not retain a misleading Content-Encoding.
- A 15-second installation deadline bounds a mistaken bandwidth classification.
  Failure/deadline suppresses further automatic attempts in this tab session.
- Completed files survive interruption. **Partial-file byte-range resume is not
  implemented**; the interrupted file must restart. Browsers may suspend service
  workers, so this is best-effort continuation, not a guarantee of background work.
- After successful installation, retain the current and one previous owned cache
  generation. Other applications' caches are untouched.
- No navigation, metadata, scripture, YouTube, or arbitrary URL is cached/intercepted.
  This does not create an offline application shell.
- CacheStorage/SW unavailability leaves exact search usable; the app does not fall
  back to repeatedly downloading the large model without persistent caching.

The search app only uses this cache when controlled by its own base-scoped worker.
Model misses reject in the inference worker. WASM/module requests carry a cache-only
generation marker; missing or mismatched entries return 503 instead of downloading.
Real-browser tests evict the WASM file after the readiness check to verify this race.

Existing legacy `recs-embeddings-*` caches are not treated as a complete installation:
they do not contain the runtime. They remain available to the explicit kernel/model
test tooling. Application/worker JavaScript still uses ordinary HTTP caching. Small
metadata and vector requests can occur on search intent even when semantic weights
are cached; data saver does not promise zero network traffic.

### Plain LAN HTTP

The confirmed product policy is **exact/lexical-only search on non-localhost HTTP**,
such as `http://192.168.x.x`. Browsers cannot provide the required service-worker
cache on these insecure origins. Meaning-based search is supported on HTTPS and
the browser's trusted localhost development origins. PR #4's Web Crypto fallback
continues to support artifact hashing, but does not bypass this semantic-cache
requirement. The site sends no automatic model/runtime requests on LAN HTTP.

`tests/e2e/lan-search.spec.ts` uses a real HTTP origin outside localhost, resolved
to a local test server, and checks the browser's actual secure-context APIs rather
than deleting them. Metadata/BSB lexical search remains usable there.

## Search responsiveness

`SearchApp` keeps server-provided metadata search available in every mode:

- Blank search no longer immediately fetches metadata and BSB.
- Normal data/compute sessions fetch enrichment on a nonempty query. Cached
  semantics can fetch the metadata/vector binding in data saver, without BSB.
- `prepareSearchIndex().withVectors()` shares lexical rows/postings and creates an
  immutable vector attachment. It does not renormalize text or reparse scripture.
  Validation uses the owned row count, even if callers subsequently grow or shrink
  the source chapter array.
- `prepare` initializes the inference pipeline without embedding a fake query.
- Committed queries have no intentional debounce; typing waits 175 ms.
- Cancellation removes obsolete pending client work. The worker keeps only the
  latest queued request. Active ONNX computation may finish; stale results are
  discarded. A low-compute downgrade terminates the worker entirely.
- Result rendering is initially bounded to 20 recordings, with Show more. Status/progress updates reuse memoized result elements.
- In reduced modes, intentionally deferred features do not show endless loading or
  nonfunctional retry controls.

Scoring, scripture matching, publication filtering and vector identity remain the
existing contracts. Rendering fewer results does not truncate the ranked corpus.

## Verification and measurements

Reproduce from a prepared checkout:

```sh
pnpm test:unit
pnpm lint
pnpm typecheck
pnpm build:test
RECS_E2E_NO_MODEL=0 pnpm test:e2e --workers=2
pnpm test:built
SITE_BASE_PATH=/replay-check/ pnpm verify:pages
pnpm test:python
pnpm test:archive
pnpm evaluate:core
pnpm benchmark:adaptive
pnpm benchmark:search --label adaptive --output .local/performance-adaptive.json
```

The adaptive browser suite uses deterministic **timing evidence**, not a production
mode override, for policy/state contracts. It covers saver/low-compute/unknown
behavior, actual same-origin installation, cached inference in data saver, no model
in low compute, full-page navigation, and cache eviction. Ordinary UI fixtures block
service workers to avoid downloading models in non-model CI checks.

`benchmark:adaptive` separately uses native browser timing and a server-global
bandwidth budget, including SW fetches. It tests 0.4/1.6/10/50/200 Mbps and 1×/4×/8×
page CPU profiles. Reports include actual bytes written, driver-to-paint and
input-event-to-two-frame latency, mode decisions and browser errors. Worker CPU is
not throttled; localhost gzip responses are a controlled experiment, not a claim
about the deployed host's headers.

Measured before/after initial blank-search payload (same offline gzip estimator):

| Metric | Before | After |
| --- | ---: | ---: |
| Raw response bodies | 922,624 B | 710,411 B |
| Gzip-equivalent bodies | 378,964 B | 163,744 B |
| Initial model/runtime requests | 0 | 0 |

This is approximately **57% less compressed initial data**. It does not shrink the
model; it avoids premature enrichment and font traffic.

Final native-timing adaptive trace (gzip server shaping, current 233-row corpus):

| Profile | Essential ready | Observed input-to-paint range | Final modes |
| --- | ---: | ---: | --- |
| 0.4 Mbps, 4× page CPU | 4.41 s | 33–265 ms | Save-data, low-compute |
| 1.6 Mbps, 4× page CPU | 1.71 s | 32–267 ms | Save-data, low-compute |
| 10 Mbps, 1× page CPU | 0.59 s | 17–49 ms | Save-data, normal compute |
| 50 Mbps, 1× page CPU | 0.43 s | 31–56 ms | Normal, normal |
| 200 Mbps, 1× page CPU | 0.38 s | 19–54 ms | Normal, normal |
| 50 Mbps, 8× page CPU | 2.20 s | 75–629 ms | Normal data, low-compute |

Essential body transfer was 165,039 B in each profile, with zero model/runtime
requests before readiness and no browser runtime errors. Five queries per profile
are a diagnostic range, not a statistical p95. Fast profiles started background
installation; the deterministic browser tests separately wait for completion and
exercise the real cached model. Low-compute behavior reduces work but cannot make
all existing result rendering instant on an 8× throttled main thread.

Functional verification: 657 unit passes; 82 browser passes (including five real-model cases),
followed by 10/10 targeted adaptive browser checks after threshold calibration;
110/110 corpus/retrieval acceptance checks with actual local query inference,
98 Python passes, built-output/Pages checks, archive/outline validation, all 234
source vector bindings, and preserved-source verification. Desktop/mobile saver
screenshots were inspected; mechanical UI detector found no issues.

### Unresolved scaling evidence

The original kernel benchmark remains useful for isolation. Its model phase now
explicitly drives the emitted worker; it no longer conflates an adaptive UI decision
not to run a model with slow inference. It must not be called input-to-paint evidence.

The latest recorded stress run was **50/53**, not an overall pass. All real 233-row
and 2,000-row checks passed. At 5,000 duplicated rows under 4× page slowdown:

- `Yong`: exact p95 292 ms (150 ms budget), hybrid p95 347 ms (250 ms budget).
- `living sacrifice`: exact p95 256.2 ms (150 ms budget).

Earlier runs also showed substantial timing variability. Thresholds were not raised.
These synthetic rows are performance stress, not relevance evidence. Large-corpus
ranking/index preparation and slow-device paint remain follow-up work; this change
does not establish that a 600-recording archive is instant on every device.

Local reports: `.local/performance-adaptive-before.json`,
`.local/performance-adaptive-after.json`, `.local/performance-adaptive-final.json`,
and `.local/performance-adaptive-browser.json`.

### Review regression coverage

Before applying the review fixes, new tests reproduced all three reported bugs:
hidden-during-registration installation never resumed, BFCache restore no longer
observed long tasks, and caller-array mutation rejected valid vector attachments.
The snapshot test covers both append and removal. Coordinator tests additionally
cover visibility returning before registration resolves, late pause acknowledgement,
registration failure/retry, suspended registration continuations, pre-readiness
restoration, a fresh observation window, and sticky low-compute classification.

The PR #4 conflict resolution preserves quirk badges and shared date formatting
alongside performance-aware artwork. Historical performance results above are not
relabelled as an overall budget pass: the 5,000-row scaling failures remain open.

Combined-source verification after integration: 757 unit tests and 89 browser tests
passed, including PR #4's recording-title/playback/quirk cases, real semantic
installation/inference, and the new insecure-origin LAN test. Both static builds,
lint and typecheck passed. Additional activation-wait regression coverage was added
and checked separately after that full run (96 focused tests passed). Actual-model
retrieval acceptance remained 110/110; Pages, built-output and archive checks passed.
The combined Python suite ran 105 tests successfully, with one optional skip.

## Operations

Keep `SITE_BASE_PATH` as the only deployment prefix. The worker must remain at that
base's root; Pages cannot broaden an `_astro/` worker's scope via custom headers.
Removing only the registration script does not retire an already registered worker.
A rollback that removes the cache worker should first publish an inert replacement
at the same URL. Normal browser site-data clearing removes both caches and registration.
