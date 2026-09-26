# Chapter search artifacts

The build consumes chapter-only `service.yaml` records and committed chapter-vector
sidecars. It does not read ASR, `passages.internal.yaml`, external transcript files,
or the embedding cache, and does not infer embeddings. The separate vector processor
owns transcript processing and sidecar generation.

## Public files

Every `buildIndex(root, mode)` invocation removes `site/public/generated` **before
validation**, then writes exactly these four compact artifacts and their `.gz`
companions. Failed input validation leaves no stale preview index.

| File | Contract |
| --- | --- |
| `chapters.json` | `{schemaVersion: 2, model: CHAPTER_VECTOR_CONFIG, chapters: SearchChapter[]}` |
| `vectors.bin` | `RECSCH01` header and ordered 384-dimensional int8 rows; row `i` belongs to `chapters[i]` |
| `scripture.json` | `{schemaVersion: 1, references: {[canonicalReference]: verseKeys[]}, verses: {[verseKey]: BSBText}}` |
| `legacy-chapters.json` | Plain `{[oldPassageId]: eligibleChapterId}` map, without a wrapper or content |

Metadata has a strict field allowlist. `verseText` is browser-only: the serialized
chapter DTO never contains it. Questions, confidence, review notes, source paths,
transcripts, passage objects, raw evidence, and provenance hashes are not public
metadata. Scripture references and ordinary prose containing the English word
“passage” are not prohibited.

BSB references are canonicalized, and overlapping references share the same verse
entries. Official blank verses are retained as blank strings. The builder verifies
the pinned `bible/bsb.txt` source through `loadBible()` before using it. This text is
for hidden BSB search enrichment; never render or label it as ESV.

Production eligibility comes from `flattenChapters(services, 'production')`:
reviewed services and playable videos only. Preview uses the same media gate and
includes `needs_review` chapters with `preview: true`. This filter is applied before
selecting binary rows and compatibility entries. Excluded services need no vector
sidecars for that build. An included service's complete committed sidecar is
validated against its current chapter IDs, order, videos, bounds, pinned recipe,
binary checksum, and zero-row/text flags; selected rows are copied without
requantization. Zero rows remain honest zero rows and must be skipped by semantic
scoring.

Source compatibility maps live beside each `service.yaml` as
`legacy-chapters.json`. A shared `services/legacy-chapters.json` map is also
supported; conflicting entries and unknown target chapter IDs fail validation.
No new UI link should use a legacy ID. Only handling an incoming old link should
load the public compatibility map.

The full build additionally calls model `prepare(root)` when metadata is nonempty,
ensuring pinned self-hosted query weights/runtime assets exist. It never calls
chapter inference. Empty archives still get a valid 16-byte vector header.

## Frontend interface

Import these browser-safe helpers from `site/lib/chapter-index.ts`. The `base`
argument is the **site base**, such as `/`, `/replay/`, or an absolute site-base URL;
do not append `generated` yourself.

```ts
loadChapterMetadata(base: string, signal?: AbortSignal): Promise<ChapterMetadata>
loadScriptureIndex(base: string, signal?: AbortSignal): Promise<ScriptureIndex>
enrichChapters(chapters: readonly SearchChapter[], scripture: ScriptureIndex): SearchChapter[]
loadChapterVectors(base: string, signal?: AbortSignal): Promise<ChapterVectors>
resolveLegacyChapter(base: string, legacyId: string, signal?: AbortSignal): Promise<string | undefined>
```

Types exported from that module:

- `ChapterMetadata`: the schema-version-2 envelope above, **not** a bare array.
- `ScriptureIndex`: the deduplicated schema-version-1 BSB envelope.
- `ChapterVectors`: the codec's `{dimension, rowCount, values: Int8Array}` result.
- `LegacyChapterMap`: `Record<string, string>`.

`SearchChapter` remains owned/exported by the core archive/type layer.

Recommended loading sequence:

1. Await `loadChapterMetadata(base, signal)` and use `.chapters` immediately for
   title, summary, keyword, topic, speaker, series, date, and scripture-reference
   matches. No BSB request or model load is made by this helper.
2. Independently load `loadScriptureIndex`, then call `enrichChapters`. This returns
   new chapter objects with deduplicated hidden `verseText`; it does not mutate the
   metadata or persist enriched objects.
3. Independently load `loadChapterVectors` and the query model. Before semantic
   search, check `vectors.rowCount === metadata.chapters.length`. Keep the metadata
   array's original order as the row binding; sorting results must not reorder the
   semantic index. Skip zero rows.
4. For an incoming `?id=...` only, call `resolveLegacyChapter`. A missing key returns
   `undefined`; a network or validation failure rejects. Replace a resolved URL
   with `/watch/?chapter=<id>`. Do not generate old-ID links.

All loaders accept cancellation. No shared promise cache can accidentally bind one
caller's abort signal to another caller. With `DecompressionStream`, loaders prefer
`.gz`, inspect gzip magic bytes, and decompress only genuinely compressed bodies.
This handles static hosts that already decode `Content-Encoding: gzip`, including
headers that remain after decoding. Missing/corrupt compressed responses fall back
to the raw file. Browsers without `DecompressionStream` fetch raw files directly.
Raw companions are required on the host. Serve all artifacts from one build
together; the format checks and row-count check do not provide cross-deployment
content-addressed cache invalidation.

## Output verification

`verifyOutput(root, output, mode, {deepTranscriptScan?: boolean})` checks:

- Strict metadata/BSB/compatibility DTOs and exact publication-filtered source data.
- BSB text and mappings against the **pinned source**, not a blanket Bible-text
  exemption for arbitrary user-supplied strings.
- Exact ordered committed vector bytes, row count, and binary format.
- Every gzip companion reconstructs the corresponding raw bytes; JSON is compact.
- No stale/extra generated files, old passage or JSON-vector files, private source
  files, symlinks, private structured fields, or raw provenance hashes.
- No legacy IDs in chapter search metadata and no current HTML legacy watch links.
- Static-host files remain below 100 MiB.

The optional deep scan defaults on. It reads preserved `passages.internal.yaml`
files, when present, **only during verification**, extracting transcript strings
and local transcript-file references. It never searches external ASR directories.
Private text is compared to public text using normalized, contiguous **12-word
shingles of at least 64 characters**. Case, punctuation, HTML markup/entities and
common JSON/JavaScript escapes do not provide a bypass. Short keywords are allowed.
This detects meaningful verbatim spans, not paraphrases or shorter quotations.
Content exceptions are the exact verified BSB file, exact ID-only compatibility
map, and upstream hash-pinned model files (a tokenizer vocabulary legitimately has
keys such as `questions`). Altered model bytes fail verification. BSB duplicated
into HTML/metadata is not exempt. In the generated semantic worker only, the known
computed diarization `confidence: score/(end-start)` property shape is recognized
as executable library code; literal confidence fields still fail, and the entire
worker remains subject to transcript/hash scans and all other private-field checks.

When no internal transcripts exist, strict DTO, source equality, binary, gzip,
private-file, and HTML-link checks still run. No claim of transcript comparison is
made: the verifier reports the actual shingle count. Internal hash preservation is
the separate core migration/preservation check.

## Measurement and integration commands

Run these **after** core migration and committed vectors are ready; do not run
builds against incomplete concurrent edits:

```sh
pnpm exec vitest run tests/chapter-index.test.ts tests/output-privacy.test.ts
pnpm build:preview
pnpm exec tsx scripts/archive.ts report
pnpm build
pnpm exec tsx scripts/verify-output.ts production
```

`archive.ts report` is read-only and measures the artifacts currently in
`site/public/generated`. It reports real raw and on-disk gzip bytes for all four
files, search totals excluding the optional compatibility download and model,
eligible service/chapter counts, and per-service compact public metadata sizes.
The exported `chapterArtifactReport(directory)` can instead measure
`dist/preview/generated` or `dist/production/generated` after both builds.

`metadataOutputSize(chapters)` returns `{chapters, bytes, gzipBytes}` for that
chapter array's compact public metadata. Per-service byte counts are measured
independently, so gzip sizes are not additive. They measure generated metadata,
not source YAML/editorial prose, vector-processing cost, or agent token usage.
`scripts/chapter-report.ts` reports source YAML/vector/manifest output separately
and calculates qualified 700-service scenarios at 8/10/12/15 chapters per new
service, retaining existing dense boundaries. It scales observed metadata/vector
compression, includes every BSB verse once plus projected reference mappings, and
also reports raw-vector transfer sensitivity. Estimates are not measured future data.

Fixture tests cover no-ASR/no-internals builds, review/media filtering before
binary/map publication, stale-output removal, vector binding failures, BSB
deduplication, browser loading/abort/fallback behavior, transcript injection under
innocent metadata keys, private files, invalid DTOs, Bible tampering, old links,
binary mismatches, and corrupt gzip companions. Test execution and real-corpus
measurements are coordinated by the integration owner.
