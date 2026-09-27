# RECS Replay archive and editorial core

The current [concise-outline contract](concise-outlines.md) adds one service-level
sermon description, neutral peer groups and selective nested cues. It supersedes
the earlier 8–15-chapter guidance below; original boundaries are preserved internally,
while public grouping follows the sermon’s argument. Chapter synopses are retrieval-
only and never displayed. All public chapter/subsection titles use Title Case.

Editable interpretation lives in `services/YYYY/<service-id>/service.yaml`. Each
file contains one logical service and all its ordered physical videos and searchable
chapters. Existing passages are unchanged internal preservation material, isolated
in `passages.internal.yaml`; new transcripts stay outside the repository.
`corpus/*.yaml` is an optional, separate identifier-only registration
catalogue; it is validated but never returned as interpreted content.

The schemas and Node loader are in `site/lib/archive.ts`. Browser code should
import **types only** from `site/lib/types.ts`; do not bundle the filesystem
loader into a browser island. `Service`, `ServiceSource`, `Video`, `Chapter`,
`Speaker`, `Topic`, and `IdentifierRecord` are inferred from Zod
schemas, rather than parallel handwritten data models.

## Editable format

The following is a **fictional schema example**, not a recording interpretation
or a template to populate with guessed real content:

```yaml
# services/2026/example-service/service.yaml
id: example-service
date: '2026-01-04'
title: Fictional schema example
type: service
workflow_status: complete
editorial_status: needs_review
review_notes:
  - Fictional fixture only; not real archive content.
speakers:
  - id: example-speaker
    name: Fictional speaker
    role: Speaker                 # optional
topics:
  - id: example-topic
    name: Fictional topic
    description: Test metadata   # optional
videos:                          # array order is service playback order
  - id: AAAAAAAAAAA              # physical YouTube ID, not a local video alias
    channel_id: UCLjwcZaIkiFEed1VgQYSsrw
    duration: 120                # positive seconds, fractions permitted
    sequence: 1                  # contiguous 1, 2, ... in array order
    workflow_status: complete
    media_disposition: playable
    transcription_language: en   # original spoken language, no silent translation
    transcribed_span:            # optional; requires transcription_language
      start: 0
      end: 100
chapters:
  - id: example-chapter
    video_id: AAAAAAAAAAA
    start: 0
    end: 100
    type: address
    title: Fictional chapter
    speaker_id: example-speaker   # optional; omit when unknown
    summary: The fictional speaker discusses a test example.
    keywords: [test example]     # at most ten distinctive spoken words/phrases
    topics: [example-topic]      # local topic IDs, resolved to names for search
    scripture: []               # normalized reference strings, never verse text
    review_notes: []
```

### Fields and validation

- IDs use ASCII letters, digits, `_`, and `-`, beginning with a letter or digit.
  YouTube IDs are exactly 11 YouTube identifier characters. Service, video,
  and chapter IDs are globally unique, including across entity kinds.
  Speaker/topic IDs are local to each service and unique within their arrays.
- The directory ID and year must agree with the service's `id` and ISO calendar
  `date`. Missing `services/` is valid. Unexpected YAML files under `services/`
  are errors, not silently ignored content. The explicit `*.internal.yaml`
  quarantine is excluded from runtime source loading.
- Video `channel_id` must equal the source channel above; this validates the
  supplied metadata, not remote ownership. Media tooling must verify ownership.
- Optional video `transcription_provenance` stores the importer's safe
  `archive_provenance` projection for operator-approved batch evidence: exact engine,
  settings, hashes, source/transcript durations, timing and verification state. Raw
  receipts and transcripts stay external; display projections omit provenance. See
  [transcript import](transcript-import.md) for the approved recipe and validation.
- New weekly videos record `transcript_engine` (`whisper.cpp`, `faster-whisper`, or
  `youtube-auto-captions`) with scoped language/timing. Original-English captions use
  `caption_provenance` from the safe receipt: gate version, dictionary identity/hashes,
  source/evidence hashes and consistent quality metrics. It must match that exact
  video and scope and cannot conflict with ASR provenance. Existing legacy records
  are not relabelled. All engine/provenance fields stay out of public projections.
  See [weekly operation](weekly-operation.md).
- Videos carry independent workflow and media axes. Every physical upload needs
  a positive finite duration and sequence. Duration is measured, never inferred
  from transcript length. `transcribed_span` has absolute recording seconds and
  must fit the video. Language is an optional language tag (`en`, `zh`, etc.).
- Chapters require finite nonnegative `start`, `end > start`, and an end within
  the referenced physical video. Aim for roughly 8–15 meaningful chapters per new
  full service; preserve complete thoughts and uncertainty over a quota. All 582
  pre-amendment boundaries are preserved, not resegmented to force that target.
- `type` is an extensible stable identifier, such as `service`, `address`, or
  `prayer`; this core does not invent a theological taxonomy. Title and summary
  cannot be blank. Summary is one or two attributed sentences. Keywords, topics
  and scripture arrays may be empty. No transcript or questions are source fields.
- Optional service-level `sermon_title` preserves a trusted displayed sermon title
  independently of chapter descriptions. Home cards use it when supplied rather
  than mislabelling the first sermon chapter as the whole sermon.
- Optional service-level `series: { id, name }` records a factual series only when
  supported by source metadata. `id` uses the stable identifier rules above and
  `name` must be nonblank. Both fields are required when present; extra keys
  (including provenance) are rejected. Repeated series IDs across services must
  have the same name; conflicting names fail archive validation deterministically.
  Omit `series` when unknown; do not infer a series from topics or sermon titles.
- `confidence` is optional private legacy metadata retained by migration, not a
  new curation requirement or public field. Uncertainty goes in optional
  `review_notes` arrays, which default to `[]` and are not included in search
  output. Service `speakers` and `topics` likewise default to `[]`.
- Optional `speaker_id` references a speaker in the same service. Unknown video, speaker, or
  topic references are errors.
- Scripture is reference-only: canonical book names from `BIBLE_BOOKS`, positive
  chapter/verse numbers, ASCII hyphens, and forward ranges, for example
  `Romans 13:1-7`, `John 3:16-4:2`, `Psalms 23`, or `Genesis 1-2`. Split disjoint
  ranges into separate strings. Source aliases are accepted and normalized, with
  original strings retained in the display projection. Bounds are validated against
  sourced BSB verse counts. Authored verse-text fields are rejected; only the
  deduplicated `scripture.json` receives BSB text, for browser-only enrichment.
  See `docs/bible.md` and `docs/chapter-search-artifacts.md`.
- All objects are strict. Unknown keys, duplicate YAML keys, non-finite numbers,
  and archive symlinks are rejected. Errors identify the file and field. Markdown
  is source text for rendering as text or through a separately sanitized renderer;
  never inject it as trusted HTML.

### Private evidence, vectors and preservation

New ASR/caption transcripts are external working evidence only. Processing creates
`chapter-vectors.bin` and `chapter-vectors.json` beside the service YAML. The manifest
records the pinned model/windowing recipe, ordered chapter identity/bounds, input
hashes and binary checksum, never transcript text or private paths. The static build
copies committed int8 rows and does not need evidence. See `docs/chapter-vectors.md`.

Legacy passage arrays and any referenced Markdown are preserved unchanged internally.
The application loader never materializes them. Migration verification compares
every original value and transcript byte to Git `540abab`; later editorial checks
enforce byte immutability. No new passage/transcript files are authored. Only the
minimal `legacy-chapters.json` ID map may be published for old-link compatibility.
See `docs/chapter-migration.md` for the historical schema and lossless migration.

### Identifier-only corpus

The existing registration format is accepted directly:

```yaml
youtube_id: ZTDYIJUDb0M
date: '2026-09-06'
workflow_status: registered
media_disposition: unassessed
```

Optional trusted metadata: `channel_id`, `source_title`, and `duration`. Optional
axis evidence: `blocked_reason` and `disposition_evidence`. No interpretive title,
transcript, summaries, passages, editorial status, or `published` field is
allowed. `discovered`, `registered`, `in_progress`, and `blocked` are accepted;
`complete` requires an interpreted service. A corpus record may coexist with
its service video as registration provenance; it is not a second physical video.
Its date must match that service. Corpus IDs must be unique within the catalogue.
Corpus status does not override the service video or grant publication eligibility.

## Independent axes

`workflow_status` is exactly:

```text
discovered  -> registered | blocked
registered  -> in_progress | blocked
in_progress -> complete | blocked | registered
complete    -> in_progress
blocked     -> registered | in_progress
```

`canTransitionWorkflow(from, to)` and `assertWorkflowTransition(from, to)` model
edges, so a same-state pair is not a transition. The Git guard allows unchanged
status and checks actual changes against these edges. Blocked records require
nonblank objective `blocked_reason`; clearing a blocker requires removing that
field. Completed media becoming unavailable changes media disposition, not
`complete -> blocked`. When abandoning never-completed interpretation, discard
it and retain only registration metadata. Interpreted services cannot use
`discovered` or `registered`; videos in either state cannot carry transcription
metadata or referenced chapters.

`editorial_status` is service-level `needs_review` or `reviewed`. Identifier-only
records have no editorial status. Every interpretation edit must remain or return
to `needs_review`, removing `reviewed_by` and `reviewed_at`. A reviewed service
requires nonblank `reviewed_by` and an ISO datetime `reviewed_at` with timezone.
The human approval covers all videos, chapters and associated vector artifacts;
preserved internal files remain immutable independently of approval.

`media_disposition` is per-video `unassessed`, `playable`, `failed`, or `rejected`.
Failed/rejected media requires nonblank `disposition_evidence`. Media and editorial
status are independent: reviewed failed media is valid data but is not published.
No API fetch or media inference occurs in these scripts.

## Integration API

```ts
loadArchive(root?: string): Service[]; // synchronous, default process.cwd()
publishedServices(services: readonly Service[], mode?: BuildMode): Service[];
flattenChapters(services: readonly Service[], mode?: BuildMode): SearchChapter[];
type BuildMode = 'production' | 'preview'; // default is always production

interface SearchChapter {
  id: string;
  serviceId: string;
  serviceTitle: string;
  series?: { id: string; name: string }; // factual service metadata, omitted when absent
  videoId: string;              // original YouTube ID
  start: number;
  end: number;
  title: string;
  summary: string;
  keywords: string[];
  topics: string[];             // resolved display names
  scripture: string[];          // normalized references, no ESV text
  speaker?: string;             // resolved display name
  date: string;                 // YYYY-MM-DD
  type: string;
  preview: boolean;             // true iff this chapter is unreviewed
}
```

Production includes only reviewed services' playable videos. Preview additionally
includes needs-review services' playable videos, with `preview: true` on every
unreviewed chapter. Unassessed/failed/rejected media is excluded in both modes.
Workflow completion is not approval. `publishedServices` also removes excluded
videos and their chapters from returned service copies, so navigation
must use it rather than exposing raw `loadArchive()` output. Its filtered video
sequences retain original upload positions. This is a display projection, not a
new editable service to save/revalidate. It still contains private source fields:
**only `flattenChapters` is a public serialization allowlist**. Source arrays are not mutated.

Services sort by descending date then ID. Flattened chapters sort by descending
date, service ID, video sequence, start, then chapter ID. The index includes no
reviewer metadata or private review notes. Render an explicit unreviewed preview
label whenever `preview` is true; show an honest empty state for `[]`.

Additional exported APIs: `archiveFromFiles(ReadonlyMap<string, string>)` for
immutable repository-relative file snapshots, `parseYaml`, `parseWithPath`, the
named `*Schema` exports, `SOURCE_CHANNEL_ID`, and `WORKFLOW_TRANSITIONS`.

## Commands to wire in the main package

The main scaffold supplies `zod`, `yaml`, `tsx`, and `vitest`. This core adds no
dependency installation or package configuration. Suggested script mappings:

```json
{
  "validate:archive": "tsx scripts/archive.ts validate",
  "build:index": "tsx scripts/archive.ts build-index",
  "build:index:preview": "tsx scripts/archive.ts build-index --mode preview",
  "editorial:approve": "tsx scripts/editorial.ts approve",
  "editorial:guard": "tsx scripts/editorial.ts guard"
}
```

Run through the project's bounded environment wrapper when available:

```sh
scripts/devenv-run pnpm exec vitest run tests/archive.test.ts tests/editorial.test.ts
scripts/devenv-run pnpm exec tsx scripts/archive.ts validate
scripts/devenv-run pnpm exec tsx scripts/archive.ts build-index --mode production
scripts/devenv-run pnpm exec tsx scripts/archive.ts build-index --mode preview
scripts/devenv-run pnpm exec tsx scripts/editorial.ts guard BASE HEAD
```

Both modes clear `site/public/generated/` before validation, removing old or stale
preview artifacts even on failure. They emit compact `chapters.json`, `vectors.bin`,
deduplicated `scripture.json`, and the minimal `legacy-chapters.json`, with gzip
companions. Zero eligible chapters produce valid empty envelopes and a header-only
binary. Production **must regenerate before copying assets**; never deploy preview.
The index builder validates committed vector bindings/checksums but never runs
inference. `verify-output.ts` separately checks publication, exact row correspondence,
private fields, hashes and meaningful transcript shingles throughout build output.

## Human editorial approval

A human reviews the whole service in the local preview, edits or removes anything
to withhold, commits any interpretation corrections as `needs_review`, and runs:

```sh
pnpm editorial:approve -- <service-id> --reviewer 'Human Name'
```

`approveService(root, serviceId, reviewer, now?)` is the exported command function.
It refuses dirty repositories (staged, modified, or untracked files), requires an
existing tracked needs-review service, validates the archive, and changes exactly
three semantic fields: `editorial_status`, `reviewed_by`, and `reviewed_at`. It
preserves YAML comments through the YAML document API, stages only that service
file, and makes one commit with `Editorial-Approval: <service-id>`. It returns the
commit hash and checks that new commit with the same guard. Git hooks run normally;
a rejected commit leaves the change available for human inspection, not an
automatic reset or amendment. Agent/AI reviewer names are refused as an additional
accidental-use safeguard. Agents must never invoke this against the live archive.
The automated tests invoke the real function only in disposable fictional Git
repositories with test identities.

`guardEditorial(root, base, head = 'HEAD'): { commits: number }` validates immutable
Git trees for **every** commit reachable from head but not base. Base must be an
ancestor. Every merge parent is checked conservatively; keep approvals in linear,
dedicated commits and pass the actual PR head, not a hosting provider's synthetic
merge commit. Fetch enough history for the entire range in CI. The guard checks:

- Every reviewed transition is on an existing service, changes exactly the three
  approval fields, and touches no other file. New already-reviewed records fail.
- Exactly one matching, properly parsed `Editorial-Approval` Git trailer exists.
  A trailer in ordinary message prose is insufficient. Spurious approval trailers
  fail too.
- Approval commits cannot carry `Curated-by: agent` or recognized AI/bot
  `Co-Authored-By` attribution. Ordinary human coauthors are allowed.
- Reviewed metadata is required; retaining reviewed while rewriting that metadata
  is rejected. Interpretation changes, including referenced Markdown changes,
  must reset the service to needs_review in the same commit.
- A parsed-content-equivalent change retaining reviewed requires the trailer
  `Mechanical-Change: formatting` or `Mechanical-Change: schema-migration`.
  These trailers never exempt semantic changes. Only migrations that normalize
  to identical validated interpretation qualify; no general migration bypass
  exists.
- Changed workflow values follow the exact graph independently of approval and
  media status. Invalid intermediate commits fail even if later commits undo them.

This is a **process safeguard, not a security boundary**. Deterministic checks
cannot prove a person read the recording or reliably identify arbitrary disguised
AI attribution. An agent using an operator's credentials could bypass the process.
Separate bot credentials without bypass rights are an optional operator decision.
