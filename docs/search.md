# Chapter search

The [concise service outline](concise-outlines.md) adds primary groups and selective
subsections. Results may target either; child hits show their parent and service
context. Per-unit synopses remain retrieval-only, never rendered. Service/watch
display projections strip those synopses entirely and show one sermon description.

Chapters are the public search and playback unit. Exact search uses public chapter
metadata immediately; hidden BSB verse-text matching and local meaning-based
search enrich it independently. No transcript, question, confidence, review note,
or source path is a public search field. The operator decision is
[2026-09-26-chapter-search.md](implementation-prompts/decisions/2026-09-26-chapter-search.md).

## Artifacts and browser loading

| Artifact under `generated/` | Contents |
| --- | --- |
| `chapters.json` | `{schemaVersion:2, model:CHAPTER_VECTOR_CONFIG, chapters:SearchChapter[]}` |
| `vectors.bin` | Versioned compact int8 rows, in exactly the metadata array's order |
| `scripture.json` | Deduplicated public-domain BSB verse keys/text and reference mappings |
| `legacy-chapters.json` | Old ID → eligible chapter ID compatibility mapping only |

The builder applies the same publication rule to all artifacts. Production excludes
unreviewed services and nonplayable uploads. No inference or internal text is needed
to build an index: the builder selects committed chapter vector rows.

`site/lib/chapter-index.ts` exposes browser-safe helpers:

```ts
loadChapterMetadata(base, signal?); // validates schema and full CHAPTER_VECTOR_CONFIG
loadScriptureIndex(base, signal?);
enrichChapters(chapters, scripture); // copies, preserves array order
loadChapterVectors(base, signal?); // decodes binary header, dimension, rows
resolveLegacyChapter(base, oldId, signal?); // only for old ?id= links
```

Loaders support optional gzip companions with ordinary-file fallback. Metadata
must validate before vectors are attached. The binary does not carry chapter IDs:
**never independently filter, sort or remove zero rows from its metadata array**.
SearchApp rejects a mixed production/preview artifact instead of shifting ordinals.
It verifies vector row count against the validated metadata. Artifact pairs must
come from the same build; deploy the generated directory together.

BSB enrichment happens only in browser memory. The UI neither renders `verseText`
nor serializes it per chapter. Scripture links remain reference-only ESV links.

## Search APIs

```ts
import { search, prepareSearchIndex, type DecodedChapterVectors } from './search';

search(chapters, query); // {chapter: SearchChapter, score, reasons}[]
search(chapters, query, { vectors, queryVector, semanticThreshold: 0.45, limit: 30 });

const prepared = prepareSearchIndex(chapters, vectors);
prepared.search(query);
prepared.search(query, { queryVector, limit: 30 });
```

`DecodedChapterVectors` is the codec's decoded `{dimension, rowCount, values:
Int8Array}` shape, not JSON floats or an ID-keyed map. Search validates dimension,
row count, byte-array length and quantized value range. Model/recipe validation is
performed by `loadChapterMetadata`/`parseChapterMetadata`, before pairing rows.
The old `VectorIndex`, `buildEmbeddingDocument`, and result `.passage` APIs are
removed. There is no browser-side document reconstruction or transcript embedding.

`search` reevaluates mutable inputs on each call and returns caller-owned chapter
objects. `prepareSearchIndex` owns a frozen, explicitly allowlisted metadata
snapshot and a copy of the compact rows. It caches normalized fields/references and
compact lexical postings. Postings only skip impossible lexical candidates;
semantic scoring remains exhaustive before any result limit. Zero rows never
produce a semantic match, even at threshold zero.

Recreate a prepared index when the metadata/vector pair changes. Later caller
mutations do not affect the snapshot; each query returns fresh result/reason arrays.
Public title or summary changes do not fabricate or regenerate transcript-derived
vectors. Source-side binding and freshness checks belong to sidecar generation and
the builder, not a public text comparison.

## Ranking

| Field | Weight |
| --- | ---: |
| Date | 16 |
| Speaker, scripture | 14 each |
| Browser-only BSB verse text | 2 |
| Keyword, topic | 7 each |
| Chapter title | 6 |
| Service title, series name | 4 each |
| Summary | 3 |
| Type | 2 |
| Semantic cosine | 6 |
| Overlapping parsed scripture-reference bonus | 32 |

All weights are in `SEARCH_WEIGHTS`. Normalization uses NFKC, case folding and
Unicode token boundaries. Query scaffolding is removed with a general stop-word
list; negation and meaningful words such as `only` remain. Light English inflection
normalization applies to metadata and BSB, without synonyms or prefix matching.
Field contributions use inverse document frequency over metadata postings:
`1 + log((chapterCount + 1) / (documentFrequency + 1))`, normalized by total query
weight. A whole-query phrase contributes one additional field weight.

Candidates normally need 60% term coverage. A sparse match needs at least two terms,
one third coverage, and a title/keyword/summary cue appearing in at most 5% of the
corpus; it cannot drop a query's negation/`only`. Unknown terms remain in the
denominator. Phrase matches cannot cross array values. These rules address short
chapter metadata generally; no service IDs, special query aliases or corpus answers
are encoded in ranking. BSB's lower weight prevents incidental common verse words
from overwhelming chapter descriptions.

Whole-query valid ISO/English dates constrain both lexical and semantic results.
Scripture aliases and range intersections are parsed; verse 1 does not match 10.
The parsed-reference bonus scales by the fraction of requested verses covered,
merging duplicate/overlapping ranges so repeated citations cannot inflate it.
BSB matching uses the same inflection normalization and the reason `Verse-text match
(BSB)`. Other reasons are `Scripture: <canonical reference>`, `Keyword`,
`Similar in meaning`, or the specific contributing field.

Semantic cosine normalizes the int8 row itself using `cosineChapterVector`; no
float scale is needed. Positive similarities at or above 0.45 contribute by default.
The optional threshold is clamped to [0,1]. Missing/zero rows remain exact-searchable
and receive no semantic reason. Blank and stop-word-only queries return no results.
Ties sort by descending date, then ascending service ID, video ID, start, chapter ID.
Each query caches term/phrase membership for repeated normalized metadata and BSB
values. This avoids repeated long-text scans across parents/subsections while
preserving exhaustive row scoring, order and match reasons.

## Lazy self-hosted MiniLM

The unchanged query model is `Xenova/all-MiniLM-L6-v2`, revision
`751bff37182d3f1213fa05d7196b954e230abad9`, q8, 384 dimensions, mean pooling and
L2 normalization. `embedding-config.ts` pins query inference; `chapter-vectors.ts`
adds the source windowing/aggregation/quantization recipe. Source chapter vectors
use overlapping token windows and int8 quantization; query inference retains its
256-token limit. Model and ONNX assets stay self-hosted under the deployment base.

`createSemanticClient(base, onStatus)` remains lazy: the first nonempty `embed`
creates its module worker. Request IDs correlate replies; a generation guard in
SearchApp discards late query replies. Failures reject pending requests and allow a
fresh worker on retry. Requests have a 120-second deadline; dispose on unmount.
No query is sent to an external model service.

SearchApp memoizes preparation per metadata/enrichment/vector snapshot. Exact
results use server-provided chapters before any fetch completes. BSB and semantic
failures have independent recovery controls and leave metadata search usable.
Semantic arrival reranks without dropping exact matches. An all-zero vector file
reports unavailable meaning-based search; partial zero rows receive an explicit
availability note. Submitted history and playback progress remain local.

## Evaluation and verification

The chapter migration's unit fixtures use fictional metadata and compact vectors.
Previous passage-era measurements do not establish chapter correctness or download
size. Fresh evidence is recorded in `docs/run-log.md`.

`evaluation/search-cases.yaml` keeps original natural-language questions and rank
bounds for actual pinned-model hybrid evaluation. Four cases additionally declare
`exactQuery` keyword companions: concise metadata need not repeat question wording.
Reports show the actual query for each mode; companion-query success is never a
claim of exact recall for the longer question. Existing targets map to their
containing chapters; September 13 also accepts `s0913-knowledge`, whose preserved
`p0913-two-movements` explicitly gives the substantive meditation/prayer/praise answer.

After integration is ready:

```sh
scripts/devenv-run pnpm exec vitest run tests/search.test.ts tests/prepared-search.test.ts
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm lint
```

The search suite retains opt-in offline model-cache and real browser-worker checks
through `RECS_TEST_EMBEDDINGS=1` and `RECS_TEST_BROWSER_EMBEDDINGS=1`. Prepare local
assets and Chromium before enabling those. Evaluation and benchmark consumers use
ordered chapter rows, including zero rows. Use `pnpm evaluate:core -- --implementation`
for this all-needs-review implementation checkpoint, `pnpm benchmark:search` for
the declared browser budgets, and `pnpm exec tsx scripts/chapter-report.ts` for
current sizes and explicitly qualified 700-service projections.
