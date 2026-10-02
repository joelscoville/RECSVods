# Recording search

Search uses the [recording format](editing-services.md): each recording,
chapter, subchapter and timestamped point becomes a `SearchUnit`. Results are
grouped by recording and identify the named section containing a match. Point
notes support retrieval; viewers see the overall sermon description and the
chapter/subchapter outline, not a separate point list.

Exact search uses public metadata immediately; hidden BSB verse-text matching and
local meaning-based search enrich it independently. Transcripts, review markers,
confidence and source paths are not search fields.

## Artifacts and browser loading

| Artifact under `generated/` | Contents |
| --- | --- |
| `chapters.json` | `{schemaVersion:5, model:CHAPTER_VECTOR_CONFIG, vectors:{file,sha256}, units:SearchUnit[]}` |
| `vectors.<sha256>.bin` | Content-addressed compact int8 rows, in exactly the metadata array's order |
| `scripture.json` | Deduplicated public-domain BSB verse keys/text and reference mappings |

The builder applies the same publication rule to all artifacts: production includes
only published recordings; preview also includes labelled drafts. Vectors are built
from each unit's published text and cited BSB passages, cached by recipe and text in
`.local/search-vectors`. Changed input is embedded automatically during the build.
No transcripts or committed per-recording sidecars are used. See [artifact details](chapter-search-artifacts.md).

`site/lib/chapter-index.ts` exposes browser-safe helpers:

```ts
loadChapterMetadata(base, signal?); // validates schema and full CHAPTER_VECTOR_CONFIG
loadScriptureIndex(base, signal?);
enrichUnits(units, scripture); // copies, preserves array order
loadChapterVectors(base, metadata, signal?); // verifies checksum, header, dimension and row count
```

Loaders support optional gzip companions with ordinary-file fallback. Metadata
must validate before vectors are attached. The binary does not carry chapter IDs:
**never independently filter, sort or remove zero rows from its metadata array**.
SearchApp rejects a mixed production/preview artifact instead of shifting ordinals.
It fetches the content-addressed filename from that metadata and verifies the
decoded bytes' SHA-256 and row count before attaching vectors. A same-sized asset
from another generation is rejected; exact search remains available. Deploy the
generated directory together.

BSB enrichment happens only in browser memory. The UI neither renders `verseText`
nor serializes it per unit. Scripture links remain reference-only ESV links.

## Search APIs

```ts
import { search, prepareSearchIndex, type DecodedChapterVectors } from './search';

search(units, query); // {unit: SearchUnit, score, reasons}[]
search(units, query, { vectors, queryVector, semanticThreshold: 0.45, limit: 30 });

const prepared = prepareSearchIndex(units, vectors);
prepared.search(query);
prepared.search(query, { queryVector, limit: 30 });
```

`DecodedChapterVectors` is the codec's decoded `{dimension, rowCount, values:
Int8Array}` shape, not JSON floats or an ID-keyed map. Search validates dimension,
row count, byte-array length and quantized value range. Model/recipe validation is
performed by `loadChapterMetadata`/`parseChapterMetadata`, before pairing rows.
There is no browser-side document reconstruction or transcript embedding.

`search` reevaluates mutable inputs on each call and returns caller-owned unit
objects. `prepareSearchIndex` owns a frozen, explicitly allowlisted metadata
snapshot and a copy of the compact rows. It caches normalized fields/references and
compact lexical postings. Postings only skip impossible lexical candidates;
semantic scoring remains exhaustive before any result limit. Zero rows never
produce a semantic match, even at threshold zero.

Recreate a prepared index when the metadata/vector pair changes. Later caller
mutations do not affect the snapshot; each query returns fresh result/reason arrays.
Public title or summary changes change the vector input on the next build. The
content-addressed binary binds those rebuilt rows to the new metadata.

## Ranking

| Field | Weight |
| --- | ---: |
| Date | 16 |
| Scripture | 14 |
| Speaker | 14 |
| Browser-only BSB verse text | 2 |
| Topic | 7 |
| Unit title | 6 |
| Recording title, series name, summary | 4 each |
| Semantic cosine | 6 |
| Overlapping parsed scripture-reference bonus | 32 |

All weights are in `SEARCH_WEIGHTS`. Normalization uses NFKC, case folding and
Unicode token boundaries. Query scaffolding is removed with a general stop-word
list; negation and meaningful words such as `only` remain. Light English inflection
normalization applies to metadata and BSB, without synonyms or prefix matching.
Field contributions use inverse document frequency over metadata postings:
`1 + log((unitCount + 1) / (documentFrequency + 1))`, normalized by total query
weight. A whole-query phrase contributes one additional field weight.

Candidates normally need 60% term coverage. A sparse match needs at least two terms,
one third coverage, and a title/summary cue appearing in at most 5% of the
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
(BSB)`. Other reasons include `Scripture: <canonical reference>`,
`Similar in meaning`, or the specific contributing field.

Semantic cosine normalizes the int8 row itself using `cosineChapterVector`; no
float scale is needed. Positive similarities at or above 0.45 contribute by default.
The optional threshold is clamped to [0,1]. Missing/zero rows remain exact-searchable
and receive no semantic reason. Blank and stop-word-only queries return no results.
Ties sort by descending date, then ascending recording ID, start and unit ID.
Each query caches term/phrase membership for repeated normalized metadata and BSB
values. This avoids repeated long-text scans across parents/subsections while
preserving exhaustive row scoring, order and match reasons.

## Lazy self-hosted MiniLM

The query model is `Xenova/all-MiniLM-L6-v2`, revision
`751bff37182d3f1213fa05d7196b954e230abad9`, q8, 384 dimensions, mean pooling and
L2 normalization. `embedding-config.ts` pins query inference; `chapter-vectors.ts`
adds the source windowing/aggregation/quantization recipe. Search-unit vectors
use overlapping token windows and int8 quantization; query inference retains its
256-token limit. Model and ONNX assets stay self-hosted under the deployment base.

`createSemanticClient(base, onStatus)` remains lazy: the first nonempty `embed`
creates its module worker. Request IDs correlate replies; a generation guard in
SearchApp discards late query replies. Failures reject pending requests and allow a
fresh worker on retry. Requests have a 120-second deadline; dispose on unmount.
No query is sent to an external model service.

SearchApp memoizes preparation per metadata/enrichment/vector snapshot. Exact
results use server-provided units before any fetch completes. BSB and semantic
failures have independent recovery controls and leave metadata search usable.
Semantic arrival reranks without dropping exact matches. An all-zero vector file
reports unavailable meaning-based search; partial zero rows receive an explicit
availability note. Submitted history and playback progress remain local.

## Evaluation and verification

Unit fixtures use fictional metadata and compact vectors. Historical measurements
do not establish correctness, size or performance for this format.
`evaluation/search-cases.yaml` supplies real questions, acceptable recording IDs
and rank bounds. See [search evaluation](search-evaluation.md) for exact-query
companions and real-model acceptance.

```sh
scripts/devenv-run pnpm test:search
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm lint
```

`pnpm test:model` explicitly runs offline model-cache, tokenizer and real browser-worker
checks; `pnpm test:e2e:model` selects the real semantic browser acceptance cases.
Prepare local assets and Chromium first. Ordinary tests do not run inference.
See [testing contracts and parallel feedback](testing.md). Evaluation and benchmark consumers use
ordered unit rows, including zero rows. After a fresh preview build, use
`pnpm evaluate:core` for retrieval acceptance, `pnpm benchmark:search` for the
declared browser budgets, and `pnpm exec tsx scripts/archive.ts report` for current
raw and gzip artifact sizes.
