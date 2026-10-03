# Concise service outlines

Authority: the operator's [concise-outline brief](implementation-prompts/decisions/2026-09-26-sermon-outline.md)
and subsequent request for subsections integrated as an expandable tree inside a
chapter, rather than a separate dropdown below it.

## Authoring and review

Start by understanding the whole service and the sermon’s argument. Write one
holistic, attributed `sermon_description`, normally one concise paragraph, following
that argument’s natural progression and application. Do not concatenate chapter
summaries or use Thesis/Points labels. Omit it when no sermon is evidenced.

Use a few meaningful sermon movements, often 3–6, rather than splitting every
illustration, quotation or speaker turn. Group routine material into neutral peer
chapters such as Opening, Worship and Scripture, and Response and Closing. Follow
the actual recording’s order. A substantial independent address or Q&A remains a
peer on its own merits. All public chapter and subsection titles use Title Case.

Only retain a subsection where its precision helps explain or find a meaningful
supporting point. Do not nest the entire old inventory or create searchable entries
for incidental notices. Source-supported keywords, scripture and topics remain
available for retrieval. Per-unit `summary` is retrieval/review metadata only: it
must not be rendered in outlines, watch navigation, browse rows or result cards.
The static search metadata still carries retrieval synopses for exact matching;
these are not confidential content. Raw transcript evidence remains excluded.

## Source and publication model

- `service.sermon_description`: the single public sermon paragraph, beneath the
  video and in service context. All agent-authored descriptions remain needs_review.
- `chapters`: both primary groups and selected subsections. A subsection has
  `parent_id`, pointing to a primary chapter on the same physical upload, with
  completely contained bounds. Nested parents/cycles are rejected.
- `source_chapters`: private migration lineage. It associates a new span with
  preserved old chapter IDs and supports legacy-transcript vector fallback. It
  never enters a public DTO or vector manifest.
- Public retrieval records carry `parentId` and `parentTitle` for truthful search
  context. Metadata validation checks the parent’s identity, service/video and bounds.
- Display projections deliberately omit each chapter’s synopsis and BSB text.
  Primary rows show title/time and sparse metadata. Result cards show service/parent
  context, at most two scripture links and concise truthful match reasons.
- `OutlineRows` is shared by service/watch pages. Each parent has an integrated
  expand button when it has children. Its nested list uses smaller title/time rows
  and connecting tree lines inside the same chapter block. The native button has
  `aria-expanded`/`aria-controls`; Enter/Space toggles it without seeking or navigation.
  Hidden branches leave the keyboard sequence. Selecting a child uses its own
  exact video/time range. Service groups and sermon groups share identical styling.

## Preserved existing content

The one-time migration is complete and its rewriting scripts are retired.
Use `pnpm verify:preserved` to check original evidence without Git history and
`pnpm validate:outlines` to check the current outline contract.

`chapters.internal.yaml` preserves all 582 original section IDs, bounds, notes and
metadata, including the first chapter-stage review work. Existing
`passages.internal.yaml` files and transcript bytes remain untouched. Their bytes
are sealed in `services/preserved-files.json`; see [preservation](chapter-migration.md).
The editorial guard enforces byte immutability for both internal files thereafter.

New public groups have distinct stable IDs; retained cues keep their original IDs.
Old passage IDs and retired chapter IDs are not redirected: the archive had no public
users when it was regrouped, so the migration's ID maps were removed. Regrouping changes
vector spans, so the explicit processor regenerates those rows from private speech
windows or the unchanged internal passages. Builds never re-embed.

## Weekly procedure

After discovery proposes an upload in a curator issue, a person invokes the curator, normally on
Monday to allow captions to appear. Apply the operator’s caption quality gate and
local whisper.cpp fallback; no media fetching or AI in CI.
Verify identity/duration and the sermon’s context/boundaries. Cover the sermon and
adjacent material needed for the outline, sampling ambiguous boundaries rather than
exhaustively transcribing routine service events.

Write the sermon description and compact neutral service outline first, then only
necessary supporting cues. Flag every place a reviewer should hear for themselves with a
[marker](editing-services.md#markers-places-worth-a-look), for example an uncertain
boundary, unclear audio or an unconfirmed name, hymn or reference. Do not bury these
questions in summaries. Verify Title Case, supplied metadata, timestamps, vector
bindings and all three status axes. Review the service and watch views at desktop
and mobile sizes: exactly one description, no rendered per-unit prose, peer service
groups, and an integrated subsection tree. Check retrieval of specific points,
privacy and ordinary playback, then propose a needs_review draft through the normal
separate signed checkpoint flow. Human editorial approval remains separate.

The M5 tooling and detailed procedure are in `docs/weekly-operation.md` and
`docs/operations.md`. Live discovery-to-publication and human editorial acceptance
remain pending human action; see `docs/milestone5-checks.md`.
