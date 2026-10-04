# Recording files and the editor

Each recording is `services/<date>.yaml` (use `-2`, `-3`, etc. for another recording
on the same date). Topics and series are shared lists in `taxonomy/`.

The file stores the names and times people chose. Changing a type never changes
a title, creates a chapter, or rearranges the outline.

## The structure

- **Recording:** title, date, the overall sermon description, scripture,
  topics and the ordered YouTube uploads.
- **Chapter:** its own title, type, start and end. A recording may have several
  chapters of the same type, including several sermon chapters.
- **Subchapter:** a named section inside a chapter, with its own type, start and end.
  Any chapter can have subchapters. There is one level of subchapters.
- **Point:** a time and a short text note summarizing what happens there. Chapters
  and subchapters can both have points. A point has **no end time**.
- **Marker:** a note about something a reviewer should check, rather than search content.

## Example

```yaml
# yaml-language-server: $schema=../schema/recording.schema.json
recordingTitle: Serving Our Neighbours
serviceDate: 2026-09-06
status: draft
sermonDescription: A paragraph describing the sermon as a whole.
sermonScripture:
  - Romans 12:9-13
sermonTopics:
  - service
uploads:
  - youtubeId: AAAAAAAAAAA
    uploadDuration: "1:30:00"
chapters:
  - chapterId: sincere-love
    chapterTitle: Love Without Pretending
    chapterKind: sermon
    chapterStart: "30:00"
    chapterEnd: "1:15:00"
    chapterScripture:
      - Romans 12:9-13
    points:
      - pointTime: "31:20"
        pointText: The preacher distinguishes sincere concern from seeking recognition.
    subchapters:
      - chapterId: hospitality
        chapterTitle: Practise Small Hospitality
        chapterKind: sermon
        chapterStart: "1:00:00"
        chapterEnd: "1:15:00"
        points:
          - pointTime: "1:02:15"
            pointText: A practical example shows how noticing a neighbour's needs leads to action.
markers:
  - markerTime: "1:02:15"
    markerNote: Check the name used in the example.
```

This is a fictional structural example, not a recording to publish.

## Titles and types

Both levels use `chapterId`, `chapterTitle`, `chapterKind`, `chapterStart` and
`chapterEnd`. The eight types are:

| Value | Editor label |
| --- | --- |
| `acts` | ACTS Prayer |
| `opening` | Opening |
| `sermon` | Sermon |
| `closing` | Closing |
| `communion` | Communion |
| `music` | Music |
| `qa` | Q&A |
| `other` | Other |

Types describe content; they are not fixed slots. Every title is required and
editable, including Communion. Keep IDs when changing names, types or times.
IDs must be unique within the recording, across both chapters and subchapters.

`chapterScripture` keeps the Bible passage links belonging to that section. The
watch page gathers these links across the recording; search keeps their section
associations. Preserve existing references when renaming or changing a type.

Chapters are ordered by time and cannot overlap each other. Gaps are allowed;
the first chapter need not start at zero. A subchapter must fit inside its parent
and cannot overlap another subchapter in that parent. Ends are explicit, not
silently generated from the next start.

## Points and what viewers see

A point has only `pointTime` and `pointText`. Its time falls inside its owner.
Points are ordered by time, without a mandatory spacing. Aim for about 5–10 useful
points per section, but do not invent notes to reach a count. Fewer points do not
block saving or publishing.

The editor draws points as **diamonds**, not ranges. Viewers see chapter titles
and times, and subchapter titles under **Show Subchapters**. Point notes help search
and maintainers; the viewer's outline does not show those notes or a point list.
There are no separate chapter/subchapter descriptions. The overall
`sermonDescription` remains the single paragraph under the video.

The editor sidebar is a steady chapter/subchapter navigation list. Select a section
to see its full, directly editable title and timestamped descriptions in the separate
editing area. Expanding a chapter only reveals subchapter navigation; editing needs
no Rename or Expand step. Each description has a timestamp above full-width text,
without a separate title, type, end time or review checkbox. Click its timestamp or
diamond to go to that moment. Clicking the text edits it without moving playback.
Choosing a diamond reveals its owner and description. On phones, **Back to chapters**
returns to navigation; selection opens the editing area immediately.

Timing, type and scripture controls follow the descriptions. **Review & send**
opens validation and GitHub instructions. Failed sending leaves edits available,
with retry, return-to-editing and a downloadable JSON draft for safekeeping.

### Arrange the workspace

On desktop, chapter navigation, editing, video, transcript, recording details and
markers are dockable panels. The transcript initially opens in a full-width area
below navigation, editing and video.

- Drag a panel's header or tab to an edge of another panel to put it alongside,
  above or below it. The highlighted preview shows the destination before release.
- Drop in the middle to group panels as tabs. Drag a tab to an edge to separate it.
- Use the header's **Move** button for the same actions without dragging.
- Drag the dividers to resize panels. A focused divider supports arrow keys
  (Shift for larger steps); double-click restores an even split.
- The divider above playback controls adjusts the overall workspace height.
- **Windows** reopens closed panels. **Windows → Reset the layout** restores the
  default arrangement. Closing or moving a panel preserves its in-session content,
  including a loaded transcript, transcript search and the current video player.

The layout is saved in this browser independently of recording edits and Undo.
Compact screens use a readable stacked arrangement without changing the saved
desktop positions. Very complex desktop arrangements keep panel minimum sizes
and scroll within the workspace rather than overflowing the page.

The transcript highlights the caption at the scrubber and follows it automatically.
Scrolling that caption out of view pauses automatic scrolling so you can browse;
it does not jump back after a timeout. **Return to now** reveals the current caption
and resumes following without moving playback. It also clears any transcript search.
Caption timestamps still seek to their own moments. Resizing or reopening a panel
keeps the current caption visible when following, and preserves your place when browsing.

Search uses these YAML titles, point notes, the overall description, topics and
scripture references, with BSB enrichment. It never embeds transcripts or markers.

## Uploads and clocks

All times are quoted clocks (`"42:54"`, `"1:07:02.86"`), on one recording clock.
Clocks support up to nine fractional digits when representable at that duration.
Calculated times are normalized to that precision, so millisecond upload lengths
such as `"30:02.801"` can be added without producing unrenderable floating-point digits.
Unsupported precision and unsafe combined durations produce file/field validation errors.
Uploads play back to back. `uploadSkip` subtracts repeated seconds at the start of
a later upload; it is never used on the first. Upload lengths must be positive.
`uploadUnavailable: true` records a removed upload; `uploadQuirks` records confirmed
playback problems. See [quirks](quirks.md).

Unavailable uploads keep their duration and position on the recording clock. A
seek into one, or playback reaching its start, shows an unavailable state without
requesting that upload or silently skipping time. Previous/next available-part
actions navigate on the same clock, including upload-skip offsets. The editor can
still inspect and edit metadata in those spans. A recording with no available
uploads shows that explicitly instead of offering a play action.

Editor speed controls apply the selected rate after loading and after multipart
upload changes. They reflect the player's reported rate; unsupported rates are
disabled, and a rejected change is reported instead of shown as successfully applied.
The requested rate is retained during switching, buffering and unavailable spans.
Rejection detection starts only once the target media is ready and the preference
has been reapplied; temporary loading rates do not replace the selection.

## Drafts, review and markers

An agent writes `status: draft`. A person reviews the recording and proposes a
change from the editor; sending sets `status: published`, and a maintainer merges
the pull request before the site changes. A published sermon needs its overall
description, at least one scripture reference and a topic from the shared list.

Saved markers are visible to anyone using the editor, but are excluded from watch
pages and search. New local markers stay in the browser unless **Send with my
changes** is checked. Resolve a saved marker by removing it from the file.

## Checks

```sh
pnpm validate:archive
pnpm schema -- --check
pnpm build:preview
```

`site/lib/recording-schema.ts` defines validation. `pnpm schema` updates the JSON
schemas used by YAML editors; cross-field timing rules are checked by archive
validation and the chapter editor.
