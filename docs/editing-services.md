# Editing and reviewing a recording

Edit **`services/YYYY/<service-id>/service.yaml`**. This is the human-authored source.
The schema comment at the top connects YAML-aware editors to `schema/service.schema.json`
for completion, field descriptions, type choices and format errors. The editor schema is
generated from the application's source schema, not maintained as a second rulebook.

## What belongs where

| Information | Place |
| --- | --- |
| Title, date, description, people, chapters and active quirks | `service.yaml` |
| A genuine unresolved review question | A short YAML comment beside the relevant field |
| Check dates, outcomes, sample locations, measurements and processing provenance | `docs/checks/<service-id>.md` |
| Vector files and compatibility maps | Generated service-side files; do not hand-edit |
| `chapters.internal.yaml` / `passages.internal.yaml` | Frozen historical reference; do not edit |

Old migration instructions and processing diaries do not belong in the current source.
The website never reads diagnostic reports. Explicit vector regeneration may read the
clearly marked processing appendix for preserved chapter lineage and caption provenance.

## One title

```yaml
id: 2026-06-28
date: 2026-06-28
title: Teaching Us All Things…
```

There is no `sermon_title`. `title` is used by the home page, browse/search results,
watch page, service page and player. Do not include RECS or repeat the date in it.
`sermon_description`, when applicable, is the one public paragraph describing the sermon.
Chapter `summary` fields are concise retrieval synopses, not extra public descriptions.
An optional `short_summary` is public and may only appear on a primary chapter.

## Times: use the clock you see in the video

Always quote clock values:

```yaml
start: "42:54.62"
end: "1:07:02.86"
```

- `MM:SS` or `HH:MM:SS`; fractional seconds are optional (up to nine digits).
- `"42:54.62"` means 42 minutes and 54.62 seconds, **not** 42.5462 minutes.
- Ordinary manual entry can use whole seconds, such as `"42:54"`.
- Existing precision is preserved. Changing notation must not change a boundary.
- The video's `duration` also uses a quoted clock, e.g. `"1:41:30.161"`.
- Start/end refer to **that physical upload**. Part 2 starts at its own `"0:00"`;
  do not add the length of Part 1.
- Ends are explicit: later than the start and no later than the upload duration.
- Subsections must fit inside their parent on the same upload. They have `parent_id`;
  a parent cannot itself be a subsection.

The loader converts clocks to numeric seconds for playback/search. Humans do not have
to run a converter. Numeric timestamps in generated JSON/vector manifests are normal.

## IDs: create once, then leave them alone

- A chapter ID is a stable link target, not a title or a position in the list.
- Keep existing IDs, including older `c…` and `s…` names. Those prefixes carry no
  authoring meaning and should not be "cleaned up".
- For a new chapter use `<service-id>-<short-slug>`, e.g. `2026-06-28-prayer-and-peace`.
- Do not change an ID when changing a title, time, or position. Never reuse an old
  chapter/link ID for different content.
- IDs must be unique across the archive. Letters, digits, hyphens and underscores
  are allowed; the first character must be a letter or digit.
- `parent_id`, `speaker_id` and topic IDs are references, not free-form names.

The add-chapter helper generates a collision-free ID and validates the proposal:

```sh
pnpm author add-chapter 2026-06-28 \
  --video k27dmsPvmG8 --title "Prayer and Peace" --type sermon \
  --start "42:54.62" --end "48:19" \
  --summary "Replace this example with an accurate concise synopsis."
```

This prints a **proposal only**. The example is illustrative, not a proposed change to
the recording. Add `--apply` only after supplying the intended content. Use
`--parent EXISTING_ID` for a subsection. Applying a content edit to a reviewed service
returns it to `needs_review`; it never grants approval. New or retimed chapters need
updated vectors before publication; the check command explains that step.

## Type choices

Values are case-sensitive and enforced. `Sermon`, for example, is not `sermon`.
Run `pnpm author types` to print the choices from the same definitions used by validation.

### Recording-level `type`

| Value | Use |
| --- | --- |
| `service` | A full service, including one split into multiple uploads |
| `sermon` | A sermon-only recording |
| `recording-excerpt` | An isolated or partial recording |

### Chapter-level `type`

| Value | Use |
| --- | --- |
| `opening` | Welcome, introduction or opening preparation |
| `worship` | Grouped worship: singing, prayer or readings |
| `sermon` | A chapter within the main sermon |
| `question-answer` | A distinct Q&A outside the main sermon |
| `communion` | Communion |
| `anthem` | A standalone choir/anthem item |
| `music` | Other standalone music |
| `testimony` | A personal testimony |
| `reflection` | A separate devotional reflection |
| `address` | A non-sermon address |
| `closing` | Closing response, prayers, announcements or dismissal |

A **sermon chapter is not necessarily the entire sermon**. The player uses consecutive
top-level `sermon` chapters in an upload for its sermon-only span; the recording card
opens the first top-level sermon chapter. A sermon illustration remains `sermon` rather
than becoming a distinct service item just because it mentions music or a testimony.
Changing `type` can therefore affect navigation and playback, not just a label.

## Quirks and comments

Flags require no timestamps, measurements, author name or special origin:

```yaml
quirks:
  - embed_blocked
  - audio_choppy # Listen near 42:54; repeated dropouts during speech.
```

Omit `quirks` when none are recorded. This means "no recorded quirks," not "tested and healthy."
Supported values are printed by `pnpm author types` and offered by the editor schema.

```sh
pnpm quirks flag --video VIDEO_ID --kind audio_choppy --note "Listen near 42:54"
pnpm quirks clear --video VIDEO_ID --kind audio_choppy
pnpm quirks check-embeds --all
pnpm quirks check-embeds --all --apply
```

Checks write reports in `docs/checks/`. `--apply` only **adds** definite embedding or
availability restrictions; a success suggests reviewing an existing flag for removal.
Timeouts and other inconclusive attempts change nothing. Audio measurements are
suggestions requiring listening and cannot be automatically applied as flags.
Technical flag/comment edits do not invalidate otherwise unchanged content approval.

Review questions are plain comments, not a `review_notes` field:

```yaml
# Slide says 1 Timothy; the spoken reading indicates 2 Timothy.
# Confirm during review rather than inventing a correction.
scripture:
  - 2 Timothy 3:14-17
```

## A finite review workflow

1. Run `pnpm author check <service-id>`. Fix syntax, references, time ranges and any
   stale/missing vector warnings. The output includes clock times and links to both boundaries.
2. Check the recording's title/description, chapter navigation, names and scripture
   references against the source. Read the nearby comments. Leave genuinely unknown
   identities unset; do not guess merely to fill a field.
3. Verify any relevant playback quirks separately. An embed restriction is compatible
   with a reviewed recording: the website can link to YouTube instead.
4. Review the diff and commit content corrections. The existing approval command
   requires a clean checkout so it cannot accidentally bundle unrelated edits.
5. After the human review, run:

   ```sh
   pnpm editorial:approve -- SERVICE_ID --reviewer "Your Name"
   ```

This writes the reviewer/date and makes an approval-only commit. `workflow_status:
complete` means preparation is complete; it is not editorial approval. Passing machine
checks is not approval either. The human review covers published metadata/navigation
and meaningful retrieval summaries, not certification of every ASR word, machine hash,
hardware setting or historical processing note. `pnpm author check --all` gives a summary
of the archive; services with no playable uploads remain excluded from the website.

If a real timing edit invalidates vectors, follow the reported regeneration command
with the appropriate private evidence. Do not hand-edit vector bindings or silently
replace missing evidence with zero vectors. Pure clock-format changes need no regeneration.

Maintainers: run `pnpm schema:service` after changing the source schema. CI checks that
the generated editor schema is current. Legacy formats are accepted only by history/import
readers, not as today's editable source format.
