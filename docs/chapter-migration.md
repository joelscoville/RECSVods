# Chapter contract migration

**Current amendment:** the [concise-outline migration](concise-outlines.md) follows
this initial lossless split. Public chapters are regrouped; all 582 originals now
also live in immutable `chapters.internal.yaml` files. The existing `--verify`
command validates both stages against the same frozen baseline. The first-stage
commands and interfaces below remain historical context where the newer contract differs.

Authority: [operator decision](implementation-prompts/decisions/2026-09-26-chapter-search.md).
The frozen preservation baseline is Git **540abab**: **22 services, 582 sections,
1,646 passages, 2,148,986 source bytes**. The reviewed hash/count manifest is
[`migrations/chapter-search-baseline.json`](migrations/chapter-search-baseline.json).
It contains hashes and counts, not passage or transcript text. Git blobs, rather
than the working tree or a cached local report, are the source of truth.

## Interfaces

`site/lib/archive.ts` exports:

- `ChapterSourceSchema`, `ServiceSourceSchema` (also `ServiceSchema`), `Chapter`,
  `Service`, `ServiceSource`, `SearchChapter`, and the existing metadata schemas.
- `archiveFromFiles(files)` and `loadArchive(root?)`: strict chapter-only source
  loading. `service.yaml` must contain `chapters`, not `sections` or `passages`.
  Quarantined `*.internal.yaml`, Markdown evidence and vector JSON are not read or
  parsed by the filesystem loader. Unknown non-quarantined YAML source locations
  still fail validation. Missing internal files or private ASR do not prevent loading.
- `publishedServices(services, mode = 'production')`: the existing editorial/media
  eligibility gate, now filtering chapters. This returns **source records**, not
  a public serialization allowlist.
- `flattenChapters(services, mode = 'production')`: the public allowlist. Its
  `SearchChapter[]` contains `id`, `serviceId`, `serviceTitle`, `videoId`, `start`,
  `end`, `type`, `title`, `summary`, `keywords`, topic **labels**, canonical
  `scripture`, optional aligned `scriptureDisplay`, optional `speaker`, `date`,
  optional `{id,name}` series, and `preview`. No transcripts, questions, confidence,
  review notes, source paths, or provenance are projected. Optional `verseText` is
  browser-only enrichment and is never emitted by this function.

`site/lib/types.ts` is the browser-safe type-only entry point. There is no public
passage model or legacy loader fallback. Source chapter `confidence` is optional
private legacy metadata. `review_notes` is likewise private; existing values and
original text whitespace are retained. Keywords are limited to ten.

`site/lib/legacy-schema.ts` is used only by history/preservation tooling. It
validates old service schemas, references, bounds and external transcript paths.
`site/lib/internal-validation.ts` compares original raw parsed values without
schema transforms or defaults and enforces internal immutability.

## Main/operator execution

Run through the pinned development environment:

```sh
# Metadata-only: writes the baseline manifest; does not migrate services.
scripts/devenv-run pnpm exec tsx scripts/migrate-chapters.ts --baseline 540abab --record-baseline

# Main runs this only after the coordinated code checkpoint is ready.
scripts/devenv-run pnpm exec tsx scripts/migrate-chapters.ts --baseline 540abab --prepare

# Separate preservation verification; no writes, audio, inference or vector work.
scripts/devenv-run pnpm exec tsx scripts/migrate-chapters.ts --baseline 540abab --verify
```

Programmatic API: `migrateChapters(root, { baseline, mode, privateDirectory? })`,
where `mode` is `record-baseline`, `prepare`, or `verify`. It returns the baseline
manifest. `readMigrationBaseline`, `deriveChapters`, `preservePassageBlock`, and
`spokenKeywordCandidates` support focused checks without real-content mutations.

The CLI's private transcript default is `~/RECS-colab/transcripts`; override with
`--private-transcripts <directory>`. Only exact `<video-id>.json` files are used,
with numeric `segments[].start/end` and string `segments[].text`. Intersecting
segments supply working spoken-word evidence. Missing files fall back to original
legacy transcripts; malformed present files stop preparation. Verification uses
only Git originals and repository preservation files, never private Colab input.

### Prepare outputs

For each baseline service:

1. `passages.internal.yaml` stores **every original passage field**, including
   questions, confidence, review notes, and exact parsed transcript bytes. The
   literal source sequence is copied where possible; lossless YAML serialization
   is used only if the isolated literal block cannot represent the original values
   (for example cross-record aliases). Existing external transcript files are not
   rewritten or moved and must still match their baseline bytes.
2. `service.yaml` replaces original sections with chapters. Every original section
   field, ID, boundary, speaker, title and review note is unchanged. Scripture is
   canonicalized and de-duplicated; topic IDs are unioned and de-duplicated. The
   first existing passage summary is only an initial seed. Keyword candidates come
   from passage titles/topic labels intersected with spoken words, excluding
   bracketed editorial annotations. At most ten are initially selected.
3. Service metadata, workflow/media status and provenance remain unchanged; one
   fixed migration note is appended to the existing service review notes. Only
   `needs_review` inputs can migrate. No approval is performed.
4. `legacy-chapters.json` is a flat `{ "old-passage-id": "chapter-id" }` map, with
   no text, summaries, timestamps or legacy objects. The public builder must filter
   this map to eligible chapters and load it only for old-link compatibility.
5. `.local/chapter-review/<service-id>.json` holds metadata-only review inputs:
   chapter identity/bounds, passage titles and summaries, summary seed, normalized
   scripture/topics, spoken keyword candidates and evidence kind. Explicit
   `summary_needs_review` and `keywords_need_review` markers identify unfinished
   curation. **No raw ASR or legacy transcript copy is written here.** Main assigns
   the short summary/keyword passes before final review.

All services are preflighted before writes. Original internal material is published
atomically with an exclusive create, then compatibility/review sidecars are
written, then public source is atomically replaced after a byte recheck. Conflicting
internal values or compatibility mappings abort. Changed unmigrated public sources
abort rather than being overwritten. Reruns preserve already-migrated source bytes
(including later summary/keyword edits), existing internal bytes, and existing
local review files. An interruption after internal creation can safely be rerun.
Approved input files, taxonomy, audio, vectors and run logs are never rewritten by
this script. It makes no commits.

## Editorial history and backfill

`scripts/editorial.ts guard <BASE> <HEAD>` validates old legacy trees and new
chapter trees, including mixed history and every merge parent. Migration must
preserve original metadata, section fields, all internal passage values and
external transcript bytes. Once quarantined, internal YAML and its referenced
transcript files are byte-immutable, including on unreviewed services.

Existing human-only approval rules still apply. Changed associated `.bin` or
`.json` sidecars on a reviewed service require resetting `editorial_status` to
`needs_review` and clearing `reviewed_by`/`reviewed_at`; a mechanical-change trailer
cannot bypass this. The approval command itself accepts only current chapter
sources. Legacy parsing is for history/preservation, not new approval.

Backfill reports count chapters and check chapter gaps/overlaps, original low
boundary confidence, review notes and unusually short/long chapters. They no
longer inspect tiny passage durations or compare transcript text. Manifest and
approved-input immutability checks remain in place.

## Focused checks

```sh
scripts/devenv-run pnpm exec vitest run tests/archive.test.ts tests/editorial.test.ts tests/backfill.test.ts tests/migration.test.ts
scripts/devenv-run pnpm exec eslint site/lib/archive.ts site/lib/types.ts site/lib/legacy-schema.ts site/lib/internal-validation.ts site/lib/backfill.ts scripts/migrate-chapters.ts scripts/editorial.ts tests/archive.test.ts tests/editorial.test.ts tests/backfill.test.ts tests/migration.test.ts
scripts/devenv-run pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --types node site/lib/archive.ts site/lib/types.ts site/lib/legacy-schema.ts site/lib/internal-validation.ts site/lib/backfill.ts scripts/migrate-chapters.ts scripts/editorial.ts tests/archive.test.ts tests/editorial.test.ts tests/backfill.test.ts tests/migration.test.ts
```

The real-baseline test performs an **in-memory** migration of all 22 Git records,
checks every old passage field and transcript byte, verifies all section fields
and service metadata, and compares the persisted hash/count manifest. Filesystem
mutation, recovery, conflicts and approval tests use disposable fictional Git
repositories only. Project-wide builds and tests belong to main's coordinated
integration pass after the other agents finish and the real migration is executed.

## Deliberate review limits

Summary seeds are not final short chapter summaries. Keyword intersection proves
only that a word/phrase appears in the selected speech evidence; it does not prove
distinctiveness or ASR accuracy. Empty keyword lists are honest where no candidate
is supported. Migration preserves all 582 existing sections rather than changing
boundaries to force the future 8–15-chapter target. Vector generation and public
output privacy checks are separate integration responsibilities.
