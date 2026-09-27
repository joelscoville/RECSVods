# Chapter vectors

Current concise outlines store primary groups and selective subsections in the same
ordered source array; both receive vectors for their actual spans. Group fallback
uses private `source_chapters` lineage to concatenate unchanged internal passages.
The processor rejects fallback passages outside the new span or on another video.
Manifests still contain only identity/bounds and hashes, not lineage or synopsis text.

Chapter vectors are **source artifacts generated once during service processing**.
The static build reads and validates committed sidecars, selects eligible rows, and
copies those int8 bytes. It never reads transcripts, initializes a model, or
recomputes vectors. Run processing only after chapter metadata is ready.

## Integration API

Browser-safe exports from `site/lib/chapter-vectors.ts`:

```ts
CHAPTER_VECTOR_CONFIG
packChapterVectors(rows: Int8Array[]): Uint8Array
decodeChapterVectors(bytes: ArrayBuffer | ArrayBufferView): {
  dimension: number;
  rowCount: number;
  values: Int8Array;
}
cosineChapterVector(file: ChapterVectorFile, rowIndex: number,
  queryVector: ArrayLike<number>): number
```

`decodeChapterVectors` validates magic, version, dimension, exact byte length and
the [-127,127] range. It returns a view of the supplied bytes, respecting Buffer
and typed-array offsets. Treat that view as immutable. Empty files with zero rows
are valid; a row containing all zeros is also valid.

`cosineChapterVector` normalizes the int8 row and the query in the cosine formula;
the omitted quantization scale cancels. It returns 0 for zero rows/queries, throws
for an invalid row, incompatible dimensions, or nonfinite query components, and
clamps rounding error to [-1,1]. **Skip zero rows in semantic candidate selection**;
do not present them as semantic matches. Keyword/metadata search still works.

Node-side exports from `scripts/chapter-vectors.ts`:

```ts
interface ChapterVectorChapter {
  id: string;
  video_id: string;
  start: number;
  end: number;
}
interface ChapterVectorBinding extends ChapterVectorChapter {
  windows: number;
  has_text: boolean;
  input_sha256: string;
  source_kind: 'raw_colab_json' | 'canonical_evidence_json'
    | 'legacy_passages' | 'none';
}

createChapterVectorManifest(bytes: Uint8Array,
  bindings: readonly ChapterVectorBinding[]): ChapterVectorManifest
validateChapterVectorManifest(manifest: unknown, bytes: Uint8Array,
  chapters: readonly ChapterVectorChapter[]): LoadedServiceChapterVectors
loadServiceChapterVectors(sourcePath: string): LoadedServiceChapterVectors
loadServiceChapterVectors(root: string, sourcePath: string): LoadedServiceChapterVectors
// LoadedServiceChapterVectors = {dimension, rowCount, values, manifest}

processChapterVectors(options: ChapterVectorProcessOptions): Promise<ChapterVectorReport>
chapterVectorsCli(args?: string[]): Promise<ChapterVectorReport | VerificationReport>
```

The loader is synchronous for static-builder integration. `sourcePath` can be a
service directory or its `service.yaml`; the two-argument form resolves it against
the repository root. It reads exactly the service metadata, `chapter-vectors.bin`,
and `chapter-vectors.json`. It verifies the complete recipe, binary SHA-256, row
count, unique and ordered chapter IDs, exact video IDs and time boundaries, field
allowlists, hash syntax, window counts, and consistency of `has_text` with zero
rows. Missing, corrupt or stale source artifacts fail closed. Metadata-only
changes such as titles/summaries do not invalidate transcript-derived vectors.

Builder example (copy rows; do not dequantize/requantize):

```ts
const file = loadServiceChapterVectors(root, sourcePath);
const rows = eligibleChapterIds.map((id) => {
  const index = file.manifest.bindings.findIndex((binding) => binding.id === id);
  if (index < 0) throw new Error('Missing chapter vector');
  return file.values.slice(index * file.dimension, (index + 1) * file.dimension);
});
const publicBinary = packChapterVectors(rows);
```

Other pure processor exports are `parseChapterEvidence`, `clipChapterEvidence`,
`stripEditorialAnnotations`, `chapterTokenWindows`, `averageChapterWindows`, and
`quantizeChapterVector`. These are fixture seams, not build dependencies on text.

## Binary and manifest format

Each service has two sibling source files:

| Offset | Bytes | Meaning |
| --- | ---: | --- |
| 0 | 8 | ASCII `RECSCH01` |
| 8 | 2 | uint16 little-endian dimension = 384 |
| 10 | 2 | uint16 little-endian binary version = 1 |
| 12 | 4 | uint32 little-endian row count = N |
| 16 | N × 384 | Ordered signed int8 rows; each component in [-127,127] |

There is no row padding, scale field, trailing data, or JSON vector payload. Size
is exactly `16 + N * 384` bytes. The source row order is `service.yaml.chapters`.

The exact manifest envelope is:

```ts
{
  schemaVersion: 1,
  model: CHAPTER_VECTOR_CONFIG,
  binary_sha256: '<64 lowercase hex characters>',
  bindings: [
    { id, video_id, start, end, windows, has_text, input_sha256, source_kind }
  ]
}
```

`model` is the entire shared recipe object, including the existing flat embedding
configuration plus `windowing`, `aggregation`, `quantization`, `clipping`,
`fallbackPreprocessing`, `usableText`, and `binary`. Consumers should import the
constant rather than reconstruct it. The manifest contains no timestamp, machine
path, transcript, summary, ASR payload, or audio metadata. Both files are stable
across repeated runs with identical inputs/recipe. Timing data belongs in the CLI
report, not the manifest.

## Pinned model and algorithm

- Model: `Xenova/all-MiniLM-L6-v2`.
- Revision: `751bff37182d3f1213fa05d7196b954e230abad9`.
- Existing q8 ONNX weights and tokenizer, 384 dimensions, mean pooling, normalized
  output, the same NFKC/whitespace preprocessing as browser queries, no task prefix.
- Existing pinned Transformers/runtime versions and upstream file checksums remain
  authoritative in `site/lib/embedding-config.ts`. Model changes invalidate the
  full manifest recipe and private cache identity.
- Tokenize the entire working chapter text without truncation or special tokens.
  Slice **254 content token IDs**, with **64 content-token overlap**, stride 190.
  Stop when a window reaches the final token; do not add a redundant overlap-only
  tail. Append the verified MiniLM `[CLS]=101` and `[SEP]=102` IDs to each window:
  total input length is at most **256 including specials**.
- Pass those exact IDs to the same extractor model, with all-one attention mask
  and all-zero token types. Use the pipeline's `mean_pooling` and L2 normalization.
  Do not decode/re-tokenize slices: a window can start in the middle of a WordPiece.
- Arithmetic mean of normalized window vectors, equal weight per window, then L2
  normalize the chapter mean. Symmetric max-absolute quantization maps its largest
  absolute component to 127. Round halves away from zero. Values never use -128.
- Empty or annotation/punctuation-only working input has a zero row,
  `has_text:false`, `windows:0`, and an explicit `skippedSemantic` report count.
  No chapter title, summary, scripture, keywords, or other metadata is substituted.
  A pathological nonempty mean cancelling exactly to zero is an error, not silently
  classified as missing transcript.

`scripts/embeddings.ts` exports `createEmbeddingSession(root)` with
`tokenize(text)`, `embedTokenIds(ids)`, `embedText(text)` and `dispose()` methods.
It verifies local pinned assets, disallows remote inference, and reuses one
extractor across all selected services/windows. `embedText` retains the existing
query/text pipeline. `prepare` and `embedTexts` support model assets and query
evaluation; passage indexing/verification has been removed. Preparation is the only possible
network phase: it reuses verified cached assets and downloads only missing or
invalid pinned files. Generation initializes the session lazily; all-reused or
entirely no-text runs do not prepare/load a model.

## Private input selection and clipping

An operator supplies `--transcripts-dir`. For each **exact** chapter video ID,
probe in this order, without recursive or fuzzy filename discovery:

1. `<transcripts-dir>/<video-id>.json` (existing raw Colab bundle).
2. `<transcripts-dir>/<video-id>/evidence.json` (canonical private evidence).
3. `<transcripts-dir>/<video-id>.evidence.json` (flat normalized evidence).

The JSON must identify that exact video via `video_id` or `youtube_id`; if both
exist, both must agree. Invalid supplied files are errors, not permission to hide
the error behind fallback input. A raw file wins over canonical evidence, and any
valid selected evidence wins over legacy text, including chapters where it has
no usable content. This is not a new ASR authorization/quality assessment.

Supported canonical shape (seconds, absolute video timeline):

```json
{
  "schema_version": 1,
  "youtube_id": "abcdefghijk",
  "segments": [
    { "start": 1, "end": 3, "text": "Fixture words",
      "words": [
        { "start": 1, "end": 2, "word": "Fixture" },
        { "start": 2, "end": 3, "word": "words" }
      ] }
  ]
}
```

This accepts primary-whisper canonical segments and future caption-normalized
segments without invoking transcription. Words may use `text` instead of `word`;
words are optional. Segment timestamps/text are required. Timings must be finite,
nonnegative and non-reversed. Extra private ASR fields are ignored and never
serialized into a manifest/cache.

For each segment with complete word timings, include each word when its midpoint
is `>= chapter.start` and `< chapter.end`. Do not prefilter by segment boundaries:
word alignment can extend outside them. If the word list is absent, empty, or has
missing timestamps, use the entire segment text iff its segment midpoint lies in
that same half-open interval. Invalid supplied timestamps still fail. Sort
segments stably by start then end; retain word order. Join selected fragments with
spaces and apply the shared preprocessing. The clipping algorithm is recorded in
the recipe.

Only if no evidence file exists for that video, read the **unchanged** sibling
`passages.internal.yaml` (bare passage array or `{passages: [...]}`). Select by
`section_id === chapter.id`, verify `video_id`, and concatenate transcripts in
stable timestamp order. Legacy passages have no word alignment, so their chapter
membership is authoritative; do not fabricate time slicing within their text.
Remove square-bracket editorial spans from the working copy, including omission,
uncertainty and reference-only annotations. Original YAML and parsed transcript
strings are never edited. Missing evidence fails before any writes. Present evidence
with no usable speech may produce a zero row, but replacing a previously text-bearing
row requires the explicit named `--allow-empty <chapter-id,...>` override. That same
override can deliberately authorize a row with unavailable evidence; it must never
be added automatically to get a failed run through.

`input_sha256` hashes the ordered tuple of recipe, chapter identity/bounds,
source kind, source-content hash, and normalized working text. Raw/canonical source
content hashes cover the original JSON bytes; fallback hashes cover the selected
original passage transcript strings and their section/video/time metadata. This
detects boundary and input changes on explicit processing. Build validation checks
the recorded hash format but deliberately cannot revalidate private input hashes
without reading evidence.

## Private cache and generation behavior

Cache location is fixed beneath ignored `.local/chapter-vector-cache/<recipe-hash>/`.
Directory creation rejects symlink redirection. Cache filenames hash the recipe
and content-token hash. Entries contain only `recipe_sha256`, `input_sha256`,
`vector_sha256` and a normalized numeric `vector`; no text, token IDs, source paths,
service IDs, chapter IDs or raw evidence. Vector checksums include the recipe and
input hashes. Malformed/corrupt cache contents are recomputed. An in-memory
hash→vector map shares repeated windows across services.

Explicit generation validates existing sidecars against current metadata and
private input hashes first. Identical services are reused byte-for-byte without
initializing the model. Changed services are rebuilt, reusing cached window
vectors. The static build **only** uses the source loader above. A build never
repairs stale artifacts implicitly.

Writes use temporary files and atomic per-file replacements. Metadata is checked
again before replacement. The pair is not a filesystem transaction: interruption
between binary/manifest replacements produces a checksum mismatch that the loader
rejects. Restore a coherent binary/manifest pair from the last known-good checkpoint
before rerunning explicit processing; corrupt prior sidecars fail preflight rather
than discarding their prior text-bearing status. Processing/builds should be
sequential. Existing raw/fallback input is read-only throughout.

## CLI (main/operator runs after metadata is ready)

From the repository root:

```sh
# One service, by stable directory ID (or its directory/service.yaml path):
pnpm exec tsx scripts/chapter-vectors.ts generate --service <service-id> --transcripts-dir /absolute/private/transcripts

# All services, sharing one extractor:
pnpm exec tsx scripts/chapter-vectors.ts generate --all --transcripts-dir /absolute/private/transcripts

# Legacy-only processing when no raw evidence directory is supplied:
pnpm exec tsx scripts/chapter-vectors.ts generate --all

# Source artifact verification only: no evidence, model, generation, or network:
pnpm exec tsx scripts/chapter-vectors.ts verify --all
pnpm exec tsx scripts/chapter-vectors.ts verify --service <service-id>
```

Generation returns counts for services, chapters, windows, embedded/cache-hit
windows, reused/written services, skipped semantic rows, and binary bytes. It also
reports total/model/inference timings and per-service counts/timings. Verification
returns service/chapter/skipped-semantic counts. Reports contain no transcript text.

Programmatic processing accepts `{root?, service?, all?, transcriptsDir?, allowEmpty?}`. Select
exactly one service or `all:true`. Tests may supply `fixtureRoot` plus a fake
`createSession` factory; injecting an encoder without `fixtureRoot` is rejected.
There is no fixture/encoder CLI override. Merely importing these modules performs
no filesystem writes or model work.

## Prepared checks — not executed during concurrent model edits

Fixture tests cover binary header/range errors, offset views, quantization cosine
accuracy, query/row normalization, zero rows, manifest recipe/checksum/bindings,
token-window boundaries and overlap, midpoint clipping, raw preference, canonical
inputs, no-text reporting, deterministic regeneration/cache behavior, one extractor
across services, and exact fallback/source preservation.

Main can run these when the concurrent code changes are ready:

```sh
pnpm exec vitest run tests/chapter-vectors.test.ts
pnpm exec eslint site/lib/chapter-vectors.ts scripts/chapter-vectors.ts scripts/embeddings.ts tests/chapter-vectors.test.ts

# Optional cached-model integration check; never downloads model files:
RECS_TEST_CHAPTER_MODEL=1 pnpm exec vitest run tests/chapter-vectors.test.ts

# Coordinated project type check after all caller/schema cutovers:
pnpm exec tsc --noEmit
```

The optional model check compares exact token-ID inference with the existing short
query pipeline and exercises long-input real-tokenizer windows. No tests or model
commands were run as part of the initial concurrent implementation handoff.
