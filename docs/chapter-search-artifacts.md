# Search artifacts

The build reads `services/<id>.yaml`, topics and series, and the pinned BSB text.
It derives search units from recordings, named chapters/subchapters and timestamped points, then
embeds their published text with `scripts/search-vectors.ts`. It never uses
transcripts or review markers as embedding input. See [the recording format](editing-services.md).

## Public files

Every `buildIndex(root, mode)` invocation removes `site/public/generated` **before
validation**, then writes these three compact artifacts and their `.gz` companions.
Failed input validation leaves no stale preview index.

| File | Contract |
| --- | --- |
| `chapters.json` | `{schemaVersion: 6, model: CHAPTER_VECTOR_CONFIG, vectors: {file, sha256}, units: SearchUnit[]}` |
| `vectors.<sha256>.bin` | `RECSCH01` header and ordered 384-dimensional int8 rows; row `i` belongs to `units[i]` |
| `scripture.json` | `{schemaVersion: 1, references: {[canonicalReference]: verseKeys[]}, verses: {[verseKey]: BSBText}}` |

`SearchUnit` is defined in `site/lib/display.ts`. Metadata has a strict field
allowlist: no markers, transcripts, review notes, source paths or provenance.
`verseText` is browser-only and is never serialized into `chapters.json`.

Production includes only `status: published` recordings; preview also includes
drafts, marked `preview: true`. The publication filter runs before deriving units
and generating rows. An unavailable upload remains part of the recording clock;
it does not silently remove the recording from search.

BSB references are canonicalized, and overlapping references share verse entries.
Official blank verses remain blank. The builder verifies the pinned `bible/bsb.txt`
source before using it. This is hidden BSB search enrichment, never ESV text.

## Vector generation and caching

`unitText` combines a unit's title, text, topics, references and the BSB text of
those references. The recording unit carries the sermon description and citations;
point units carry their note text and their owner's title. A point has only a start
time; `entryId` connects it to its named chapter/subchapter. The public outline
contains only named sections, not points. The processor uses overlapping token
windows, averages normalized window vectors, normalizes the result and quantizes
to int8. Zero rows remain zero and are skipped by semantic scoring.

Rows are cached under `.local/search-vectors/`, keyed by the complete vector recipe
and input text. A changed title, summary, topic, citation or cited BSB text therefore
gets a new row automatically. There are no committed per-recording vector sidecars
or separate regeneration commands. A cold nonempty build runs the pinned local
embedding model; unchanged cached rows need no inference. Empty archives get a
valid 16-byte vector header without loading the model.

The full build also prepares self-hosted browser query-model/runtime assets when
the index is nonempty. Neither generated assets nor the local row cache is committed.

## Frontend interface

Import these browser-safe helpers from `site/lib/chapter-index.ts`. `base` is the
**site base**, such as `/` or `/replay/`; do not append `generated` yourself.

```ts
loadChapterMetadata(base: string, signal?: AbortSignal): Promise<ChapterMetadata>
loadScriptureIndex(base: string, signal?: AbortSignal): Promise<ScriptureIndex>
enrichUnits(units: readonly SearchUnit[], scripture: ScriptureIndex): SearchUnit[]
loadChapterVectors(base: string, metadata: ChapterMetadata, signal?: AbortSignal): Promise<ChapterVectors>
```

1. Load metadata and use `.units` immediately for exact search. This does not load
   BSB, vectors or the model.
2. Load scripture independently and call `enrichUnits` to get copies with hidden
   `verseText`. Do not persist or render those enriched fields.
3. Load vectors using the validated metadata. The loader checks the content-addressed
   filename, SHA-256, binary format and row count before returning rows.

Keep the metadata's original order as the row binding: sorting results must not
reorder the semantic index. A same-sized binary from another generation is rejected.

All loaders accept cancellation. With `DecompressionStream`, they prefer `.gz`,
inspect gzip magic bytes, and decompress only genuinely compressed bodies. This
also handles hosts that already decode `Content-Encoding: gzip`. Missing/corrupt
compressed responses fall back to raw files; older browsers fetch raw directly.
Deploy the raw and compressed artifacts together.

## Output verification

`verifyOutput(root, output, mode, {deepTranscriptScan?: boolean})` checks:

- Strict metadata and BSB schemas against publication-filtered source data.
- BSB mappings/text against the pinned source.
- Exact vector bytes rebuilt or retrieved from the text/recipe cache, row count
  and binary format.
- Every gzip companion against its raw bytes, and compact JSON.
- No extra generated files, source YAML, transcripts, private structured fields,
  media or symlinks, and no retired `/watch/?id=` links in HTML.
- Static-host files stay below 100 MiB.

The deep scan defaults on. It reads retained `transcripts/<id>.yaml` files **only
during verification**, extracting `transcript` strings. It does not search external
ASR directories. Public text is compared using normalized contiguous **12-word
shingles of at least 64 characters**. Case, punctuation, HTML entities/markup and
common JSON/JavaScript escapes do not bypass it. Short keywords are allowed; this
detects meaningful verbatim spans, not paraphrases or shorter quotations.

Content exceptions are the exact verified BSB index and hash-pinned model files.
The semantic worker's known computed diarization `confidence` property is allowed
as executable library code; literal archive confidence fields still fail. The
rest of the worker remains subject to transcript and private-field scans.

If no retained transcripts exist, all other checks still run. The verifier reports
the actual shingle count rather than claiming a transcript comparison occurred.

## Commands and measurements

```sh
scripts/devenv-run pnpm exec vitest run tests/search-index.test.ts tests/search-vectors.test.ts tests/output-privacy.test.ts
scripts/devenv-run pnpm build:preview
scripts/devenv-run pnpm exec tsx scripts/archive.ts report
scripts/devenv-run pnpm build
scripts/devenv-run pnpm exec tsx scripts/verify-output.ts production
```

`archive.ts report` measures actual raw/gzip bytes in `site/public/generated`,
recording/unit counts and per-recording metadata sizes. The exported
`chapterArtifactReport(directory)` also accepts either built `generated/` directory.
`metadataOutputSize(units)` returns `{units, bytes, gzipBytes}` for a compact array.
Per-recording gzip sizes are measured independently and are not additive.
