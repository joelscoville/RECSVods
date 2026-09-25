# RECS Replay archive and editorial core

Editable interpretation lives in `services/YYYY/<service-id>/service.yaml`. Each
file contains one logical service and all its ordered physical videos, major
sections, and searchable passages. Markdown transcripts can live next to that
file. `corpus/*.yaml` is an optional, separate identifier-only registration
catalogue; it is validated but never returned as interpreted content.

The schemas and Node loader are in `site/lib/archive.ts`. Browser code should
import **types only** from `site/lib/types.ts`; do not bundle the filesystem
loader into a browser island. `Service`, `ServiceSource`, `Video`, `Section`,
`Passage`, `Speaker`, `Topic`, and `IdentifierRecord` are inferred from Zod
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
sections:
  - id: example-section
    video_id: AAAAAAAAAAA
    start: 0
    end: 100
    type: address
    title: Fictional section
    confidence: 0.8
    speaker_id: example-speaker   # optional; inherited by passages
    review_notes: []
passages:
  - id: example-passage
    video_id: AAAAAAAAAAA
    section_id: example-section
    start: 10
    end: 60
    type: address
    title: Fictional passage
    summary: The fictional speaker discusses a test example.
    questions:
      - What does the test example show?
    topics: [example-topic]      # local topic IDs, resolved to names for search
    scripture: []               # normalized reference strings, never verse text
    transcript: |
      Fictional test transcript, not archive content.
    confidence: 0.7
    review_notes: []
```

### Fields and validation

- IDs use ASCII letters, digits, `_`, and `-`, beginning with a letter or digit.
  YouTube IDs are exactly 11 YouTube identifier characters. Service, video,
  section, and passage IDs are globally unique, including across entity kinds.
  Speaker/topic IDs are local to each service and unique within their arrays.
- The directory ID and year must agree with the service's `id` and ISO calendar
  `date`. Missing `services/` is valid. Unexpected YAML files under `services/`
  are errors, not silently ignored content.
- Video `channel_id` must equal the source channel above; this validates the
  supplied metadata, not remote ownership. Media tooling must verify ownership.
- Videos carry independent workflow and media axes. Every physical upload needs
  a positive finite duration and sequence. Duration is measured, never inferred
  from transcript length. `transcribed_span` has absolute recording seconds and
  must fit the video. Language is an optional language tag (`en`, `zh`, etc.).
- Sections/passages require finite nonnegative `start`, `end > start`, and an end
  within the referenced video. Every passage references a known section on that
  same video and fits its boundaries. Sections may cover the full recording;
  passages need not fill the section or meet an artificial word/time quota.
- `type` is an extensible stable identifier, such as `service`, `address`, or
  `prayer`; this core does not invent a theological taxonomy. A title, summary,
  transcript, and question string cannot be blank. Questions, topics, and
  scripture arrays are required on passages but may be empty.
- Optional service-level `sermon_title` preserves a trusted displayed sermon title
  independently of chapter descriptions. Home cards use it when supplied rather
  than mislabelling the first sermon chapter as the whole sermon.
- `confidence` is a required number from 0 to 1. Uncertainty goes in optional
  `review_notes` arrays, which default to `[]` and are not included in search
  output. Service `speakers` and `topics` likewise default to `[]`.
- Optional `speaker_id` references a speaker in the same service. A passage's
  speaker overrides its section's speaker. Unknown video, section, speaker, or
  topic references are errors.
- Scripture is reference-only: canonical book names from `BIBLE_BOOKS`, positive
  chapter/verse numbers, ASCII hyphens, and forward ranges, for example
  `Romans 13:1-7`, `John 3:16-4:2`, `Psalms 23`, or `Genesis 1-2`. Split disjoint
  ranges into separate strings. Aliases and verse text are rejected; this
  schema checks reference syntax/order, not every book's verse inventory.
- All objects are strict. Unknown keys, duplicate YAML keys, non-finite numbers,
  and archive symlinks are rejected. Errors identify the file and field. Markdown
  is source text for rendering as text or through a separately sanitized renderer;
  never inject it as trusted HTML.

### Markdown transcripts

Replace `transcript` with `transcript_file: transcripts/example-passage.md` to
reference a passage-sized Markdown file relative to the service directory.
Exactly one of the two fields is required. Paths must stay inside that service
directory, end in `.md`, and cannot traverse `..` or use symlinks. Referenced
files must exist and contain nonblank text. The loader materializes them into
`Passage.transcript` and removes `transcript_file` from the returned `Service`.
Leading/trailing whitespace is normalized; internal transcript content is
preserved. A single whole-recording transcript should not be referenced by every
passage: each passage needs its own relevant text. No fragment/line-range syntax
is supported.

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
metadata or referenced sections/passages.

`editorial_status` is service-level `needs_review` or `reviewed`. Identifier-only
records have no editorial status. Every interpretation edit must remain or return
to `needs_review`, removing `reviewed_by` and `reviewed_at`. A reviewed service
requires nonblank `reviewed_by` and an ISO datetime `reviewed_at` with timezone.
The human approval covers all videos, sections, passages, and transcript files.

`media_disposition` is per-video `unassessed`, `playable`, `failed`, or `rejected`.
Failed/rejected media requires nonblank `disposition_evidence`. Media and editorial
status are independent: reviewed failed media is valid data but is not published.
No API fetch or media inference occurs in these scripts.

## Integration API

```ts
loadArchive(root?: string): Service[]; // synchronous, default process.cwd()
publishedServices(services: readonly Service[], mode?: BuildMode): Service[];
flattenArchive(services: readonly Service[], mode?: BuildMode): SearchPassage[];
eligiblePassages = flattenArchive;
type BuildMode = 'production' | 'preview'; // default is always production

interface SearchPassage {
  id: string;
  serviceId: string;
  serviceTitle: string;
  videoId: string;              // original YouTube ID
  start: number;
  end: number;
  title: string;
  summary: string;
  transcript: string;
  questions: string[];
  topics: string[];             // resolved display names
  scripture: string[];          // normalized references, no ESV text
  speaker?: string;             // resolved display name
  date: string;                 // YYYY-MM-DD
  type: string;
  preview: boolean;             // true iff this passage is unreviewed
}
```

Production includes only reviewed services' playable videos. Preview additionally
includes needs-review services' playable videos, with `preview: true` on every
unreviewed passage. Unassessed/failed/rejected media is excluded in both modes.
Workflow completion is not approval. `publishedServices` also removes excluded
videos and their sections/passages from returned service copies, so navigation
must use it rather than exposing raw `loadArchive()` output. Its filtered video
sequences retain original upload positions. This is a display projection, not a
new editable service to save/revalidate. The source arrays are not mutated.

Services sort by descending date then ID. Flattened passages sort by descending
date, service ID, video sequence, start, then passage ID. The index includes no
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

Both index modes replace `site/public/generated/passages.json` with a plain JSON
`SearchPassage[]`, newline-terminated and deterministic. Production with zero
approved services writes `[]` successfully. There is one canonical index file so
a subsequent production build replaces preview data rather than leaving a second
preview index in the public tree. Every production build **must regenerate in
production mode before copying public assets**. Preview builds are local-review
artifacts and must never be deployed. The main build owns output-directory and
deployment isolation. No timestamps, embeddings, model calls, or remote requests
are added by this index builder.

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
