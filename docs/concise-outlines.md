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

## Existing-content migration

The 22-service proposal inputs are local, metadata-only files under
`.local/outline-plans/`. Their contract is `.local/service-outline-contract.md`.
The one-time `scripts/outline-services.ts` command validates every plan before
mutation, including contiguous same-video membership, full original coverage,
source-supported keyword candidates, Title Case and stable cue identity.

```sh
scripts/devenv-run pnpm exec tsx scripts/outline-services.ts --check --all
scripts/devenv-run pnpm exec tsx scripts/outline-services.ts --apply --all
scripts/devenv-run pnpm exec tsx scripts/migrate-chapters.ts --baseline 540abab --verify
scripts/devenv-run pnpm exec tsx scripts/chapter-vectors.ts generate --all --transcripts-dir <private-evidence-directory>
scripts/devenv-run pnpm index:verify
```

Use `--service <id>` instead of `--all` for one explicitly selected proposal. Apply
is an explicit interpretation rewrite from the proposal, not a routine build step.
Local proposal files are not needed by builds or by the preservation verifier.

`chapters.internal.yaml` preserves all 582 original section IDs, bounds, notes and
metadata, including the first chapter-stage review work. Existing
`passages.internal.yaml` files and transcript bytes remain untouched. Verification
checks the internal originals against Git `540abab`, proves that primary groups
partition them once in order, and proves every new span stays on its original upload.
The editorial guard enforces byte immutability for both internal files thereafter.

New public groups have distinct stable IDs; retained cues keep their original IDs.
ID-only maps resolve old passage IDs and retired chapter IDs to their containing
group/cue. Both `?id=` and retired `?chapter=` links resolve. Regrouping changes
vector spans, so the explicit processor regenerates those rows from private speech
windows or the unchanged internal passages. Builds never re-embed.

## Weekly procedure

After discovery proposes an upload in a curator issue, a person invokes the curator, normally on
Monday to allow captions to appear. Apply the operator’s caption quality gate and
local whisper.cpp fallback once M5 tooling implements them; no fetching or AI in CI.
Verify identity/duration and the sermon’s context/boundaries. Cover the sermon and
adjacent material needed for the outline, sampling ambiguous boundaries rather than
exhaustively transcribing routine service events.

Write the sermon description and compact neutral service outline first, then only
necessary supporting cues. Verify Title Case, supplied metadata, timestamps, vector
bindings and all three status axes. Review the service and watch views at desktop
and mobile sizes: exactly one description, no rendered per-unit prose, peer service
groups, and an integrated subsection tree. Check retrieval of specific points,
privacy and ordinary playback, then propose a needs_review draft through the normal
separate signed checkpoint flow. Human editorial approval remains separate.

The M5 tooling and detailed procedure are in `docs/weekly-operation.md` and
`docs/operations.md`. Live discovery-to-publication and human editorial acceptance
remain pending human action; see `docs/milestone5-checks.md`.
