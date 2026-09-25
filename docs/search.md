# Passage search and embeddings

RECS Replay searches the generated, publication-filtered passage index entirely in the browser. Exact search is synchronous and works without a model. Optional semantic inference runs in a dedicated module worker using self-hosted assets. No model API key or runtime model CDN is used.

## Pinned model contract

The authoritative [Hugging Face model API metadata](https://huggingface.co/api/models/Xenova/all-MiniLM-L6-v2?blobs=true), retrieved on 2026-09-25, reported:

| Property | Value |
| --- | --- |
| Model | `Xenova/all-MiniLM-L6-v2` |
| Exact revision | `751bff37182d3f1213fa05d7196b954e230abad9` |
| License | Apache-2.0 (upstream model metadata) |
| Weights | `onnx/model_quantized.onnx`, Transformers.js `dtype: q8` |
| Weight SHA-256, published in upstream LFS metadata | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |
| Vector | 384 floating-point components; mean pooling; L2 normalized |
| Transformers.js | `3.8.1` |
| Browser ONNX runtime | `1.22.0-dev.20250409-89f8206ba4` |
| Token limit | 256 tokens, including special tokens; longer inputs truncate |
| Shared preprocessing | Unicode NFKC, collapse whitespace, trim; no document/query prefixes |

`site/lib/embedding-config.ts` is the single source of these values. The pinned tokenizer lowercases text internally. FeatureExtractionPipeline always tokenizes with truncation; version 3.8.1 does **not** honor a `max_length` pipeline-call option. Both Node and worker therefore explicitly set `tokenizer.model_max_length = 256`.

`buildEmbeddingDocument(passage)` concatenates title, summary, questions, topic display names, canonical scripture references, and transcript in that order, then applies the same preprocessing as a query. It preserves the separate original display fields. Service title, speaker, date, and type remain exact-search fields. No verse text is added in this milestone. Scripture aliases and licensed/public-domain verse-text integration belong to the later Bible-data work.

### Download and cache verification

`prepare` fetches only these five model files, using the exact revision in every URL:

| File | Exact bytes |
| --- | ---: |
| `config.json` | 650 |
| `tokenizer.json` | 711,661 |
| `tokenizer_config.json` | 366 |
| `special_tokens_map.json` | 125 |
| `onnx/model_quantized.onnx` | 22,972,370 |
| **Model total** | **23,685,172** |

Weights are verified against the upstream SHA-256 and byte count. The API publishes Git blob SHA-1 IDs, rather than SHA-256, for the small JSON files; preparation verifies those authoritative IDs using the Git blob header and exact byte count. Every file additionally receives a computed SHA-256 in the generated manifest. Cache reuse repeats source checks; matching size alone is insufficient. Corrupt files are replaced only after a verified download. Downloads have a 120-second abort bound, and writes use temporary files followed by atomic rename.

The browser runtime is copied from the installed, version-checked `onnxruntime-web` dependency, whose package archive integrity is managed by the pnpm lockfile. Cached copies are compared by SHA-256 to those installed source bytes. These runtime files total **32,794,766 bytes**:

| File | Exact bytes |
| --- | ---: |
| `ort-wasm-simd-threaded.mjs` | 20,856 |
| `ort-wasm-simd-threaded.wasm` | 11,133,407 |
| `ort-wasm-simd-threaded.jsep.mjs` | 44,484 |
| `ort-wasm-simd-threaded.jsep.wasm` | 21,596,019 |

Prepared model plus runtime assets total **56,479,938 bytes**, excluding the small manifest. Both plain and JSEP runtime pairs are staged; a browser loads the pair selected by its runtime, not both pairs. Every individual file is below 100 MB. The worker uses WASM with one thread and no nested proxy worker, so it does not require cross-origin-isolation headers.

Generated paths:

```text
site/public/models/Xenova/all-MiniLM-L6-v2/{JSON files,onnx/model_quantized.onnx}
site/public/models/manifest.json
site/public/onnx/{runtime mjs/wasm files}
site/public/generated/passages.json
site/public/generated/vectors.json
```

The deterministic manifest contains model metadata, relative paths, exact byte counts, SHA-256 values, source URLs, and upstream hashes where supplied. It has no timestamp or machine-specific path. These are ignored generated deployment assets, not source-controlled model caches. Deploy both model/runtime directories along with the generated indexes. Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`.

Both inference paths disable remote model loading and require local files. The worker overrides the runtime's default WASM CDN path with the same-origin deployment base. A missing asset causes an error and leaves exact search usable. Browser model caching is best-effort and uses a revision/dtype-specific cache so an upgrade cannot reuse weights from an older revision. If Cache Storage is unavailable, the worker still fetches same-origin assets. An offline return visit still needs the site application and WASM resources available through the browser/host cache. This is not a service-worker offline-app guarantee.

## Build integration

Run from the repository root, through the bounded wrapper:

```sh
RECS_DEVENV_TIMEOUT_SECONDS=300 scripts/devenv-run pnpm exec tsx scripts/embeddings.ts prepare

# The archive build selects production or preview records before embeddings run.
RECS_DEVENV_TIMEOUT_SECONDS=120 scripts/devenv-run pnpm exec tsx scripts/archive.ts build-index
RECS_DEVENV_TIMEOUT_SECONDS=300 scripts/devenv-run pnpm exec tsx scripts/embeddings.ts index
```

For local editorial preview, use `scripts/archive.ts build-index --mode preview` before `embeddings.ts index`. Production and preview replace the same canonical files; run these builds sequentially. In the build orchestrator, order operations as archive index → embedding index → Astro build. `index` reads the current `generated/passages.json`; it does not choose editorial eligibility or interpret content.

For **zero passages**, `index` writes a valid empty vector index without loading or preparing the model. The orchestrator may explicitly call `prepare` even for empty archives if model assets should be present in the output. For nonempty passages, `index` verifies/prepares assets automatically. An absent/malformed passage file fails; an old vector index is removed before processing so failure cannot leave preview vectors as current production output.

The vector artifact shape is:

```ts
interface VectorIndex {
  schemaVersion: 1;
  model: typeof EMBEDDING_CONFIG;
  passagesSha256: string; // SHA-256 of exact source passages.json bytes
  vectors: Record<string, { document: string; vector: number[] }>;
}
```

Exact preprocessed documents are included to reject stale vectors for edited passages with the same ID. This adds text payload overhead but allows synchronous validation without importing a hashing library into search. Each entry must match its current document and have a finite, approximately unit-length 384-component vector. Full model metadata must match before any semantic contribution is used. No timestamps enter vector output. Numerical parity across Node CPU and browser WASM is checked with tolerance, not claimed to be bit-identical across all hardware.

Script exports for an orchestrator: `prepare(root?)`, `buildVectors(root?)`; `embedTexts(texts, root?)` performs local-only inference for verification. The script checks installed dependency versions instead of silently building incompatible vectors after a dependency upgrade.

## Search and client interfaces

```ts
import { search, type VectorIndex } from './search';
import { createSemanticClient } from './semantic';

search(passages, query); // Array<{ passage: SearchPassage; score: number; reasons: string[] }>
search(passages, query, { queryVector, vectors, limit: 30 });

const client = createSemanticClient(import.meta.env.BASE_URL, onStatus);
const queryVector = await client.embed(query);
client.dispose();
```

`vectors` is the **whole parsed `VectorIndex` artifact**, not its nested `vectors` property. The base must be a same-origin absolute path such as `/` or `/review/`, not an external URL. `onStatus` receives `{state: 'idle' | 'loading' | 'ready' | 'error', progress?: number}`. Progress is a fraction from 0 to 1. `loading` covers model download/cache reads and initialization; progress stays below 1 until the pipeline is ready. The percentage tracks model bytes, not WASM download bytes or estimated initialization time.

Client initialization is lazy: construction reports `idle`; the first nonempty `embed` creates the worker. Responses carry request IDs, allowing concurrent callers to receive their own vectors. A worker error rejects pending embeddings, terminates that worker, and reports `error`. The next `embed` attempts initialization with a new worker. Requests have a 120-second deadline. `dispose` terminates the worker and rejects pending calls; create a new client to use semantic search after disposal.

UI integration should render `search(passages, query)` immediately, fetch the vector artifact from the same deployment base, then optionally enrich those results after `embed`. Catch model/fetch errors and retain exact results. Use a query generation counter to discard late results when the input changes; request IDs correlate promises but do not decide which query the UI should display. Dispose the client on unmount. Do not label an exact-only result “semantic”; use the returned reasons.

### Scoring and deterministic order

All weights live in `SEARCH_WEIGHTS`:

| Field | Weight |
| --- | ---: |
| Date | 16 |
| Speaker, scripture | 14 each |
| Topic | 7 |
| Passage title | 6 |
| Service title, question | 4 each |
| Summary | 3 |
| Transcript, type | 2 each |
| Semantic cosine | 3 |

Lexical comparison uses NFKC, case folding, Unicode letter/number token boundaries, and a small English stop-word list. A field contributes its weight multiplied by the fraction of distinct meaningful query terms present. An exact whole-query phrase adds half that field's weight. Repetition does not inflate scores. A candidate must cover at least 60% of meaningful query terms across its fields to retain lexical contributions. Reasons name only fields that contributed; an exact-phrase qualifier is emitted only when that phrase is present. Partial field reasons can coexist for mixed queries such as speaker plus topic.

ISO dates and English long/short month forms are searchable. Canonical scripture reference tokens preserve verse-number boundaries (`1` does not substring-match `10`). Metadata weights prioritize speaker/date/scripture over incidental transcript mentions and the bounded semantic contribution. General aliases, verse-range intersection, stemming, and fuzzy spelling are not implemented.

Semantic scores are cosine similarity × 3, only at or above **0.45** by default. `semanticThreshold` optionally overrides that cutoff, clamped to [0, 1]. Below-cutoff vectors contribute neither score nor reason. This deliberately permits no results rather than always selecting the nearest vector. The cutoff is a conservative initial heuristic, not a relevance guarantee; tune it against human-reviewed archive queries. Blank and stop-word-only queries return no results even if a vector is supplied.

Sort order is descending score, descending date, then ascending service ID, video ID, start seconds, and passage ID, using code-point comparisons rather than locale-dependent sorting. `limit` truncates after sorting. Input arrays and passage objects are not modified.

## Verification and measured evidence

```sh
RECS_DEVENV_TIMEOUT_SECONDS=120 scripts/devenv-run pnpm test:search
RECS_DEVENV_TIMEOUT_SECONDS=120 scripts/devenv-run pnpm exec tsc --noEmit

# After prepare: real model, networking forbidden during cache reuse/Node inference.
RECS_DEVENV_TIMEOUT_SECONDS=120 RECS_TEST_EMBEDDINGS=1 \
  scripts/devenv-run pnpm test:search

# Optional real-browser verification; install Chromium into a local cache first.
RECS_DEVENV_TIMEOUT_SECONDS=300 scripts/devenv-run pnpm exec playwright install chromium --only-shell
RECS_DEVENV_TIMEOUT_SECONDS=180 RECS_TEST_EMBEDDINGS=1 RECS_TEST_BROWSER_EMBEDDINGS=1 \
  scripts/devenv-run pnpm test:search
```

Set `PLAYWRIGHT_BROWSERS_PATH` consistently on install and test commands when using an isolated temporary browser cache. The browser check starts and closes its own Vite server, runs the real worker under `/review/`, blocks external requests, verifies self-hosted q8/WASM requests, and compares its normalized vector to Node (cosine > 0.999). It creates no product UI or archive content.

Measured on the development machine on 2026-09-25, through `scripts/devenv-run`:

- First successful preparation: **5.984 seconds**, **23,685,172 bytes downloaded** from the pinned model revision; runtime files copied from installed dependencies.
- Subsequent preparation: **1.113 seconds**, **0 download bytes**, all **23,685,172 model bytes** reverified and reused.
- Current production index: **0 passages**, completed in **0.009 seconds**. No invented archive passages were added.
- Final focused suite with both real-model checks: **24 tests passed** in **9.019 seconds** test execution; the real Node check took **1.845 seconds**, and the browser integration check took **7.105 seconds**, including server/browser setup and inference.
- TypeScript `tsc --noEmit` and ESLint on all six owned TypeScript files passed. Tests cover document construction, preprocessing/config mismatch, dimensions/norms, exact and hybrid ranking, deterministic order, truthful reasons, empty results, stale-vector rejection, lazy worker lifecycle, retry/timeouts, zero-passage replacement, verified cache reuse, revision-scoped browser caching, and real browser/Node compatibility.

Preparation timings exclude devenv shell entry. Browser-test timing is not an isolated model download or latency benchmark. This verifies the search subsystem; the milestone's real-recording/editorial/playback gate remains separate.
