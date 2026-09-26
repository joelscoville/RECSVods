# Browse, chapter playback, and local history

## Static routes and publication boundary

Browse routes load `loadArchive`, `publishedServices`, and `flattenChapters` on the
server for the current `ARCHIVE_MODE`. Only the allowlisted `displayServices`
projection reaches components. Production contains reviewed services and playable
videos; preview additionally contains labelled needs-review services. Metadata used
only by excluded uploads produces no browse links.

| Route, relative to the deployment base | Content |
| --- | --- |
| `browse/` | Available categories or the honest empty state |
| `browse/services/` | Logical services, newest first |
| `browse/sermons/` | Sermon chapters, or a sermon recording without invented chapters |
| `browse/speakers/<speaker-id>/` | Chapters assigned that speaker |
| `browse/scripture/<canonical-book-slug>/` | Chapters referencing that Bible book |
| `browse/topics/<topic-id>/` | Chapters assigned that topic |
| `browse/series/<series-id>/` | Services in that factual series, newest first |
| `browse/years/<YYYY>/` | Services in that year |

Speakers, books, topics, series and years have category indexes when data exists.
IDs come from archive metadata, not display-name guesses. Conflicting series names
under one ID are rejected. `BrowsePage` uses `chapterIds` and `serviceIds` only.
`DisplayService` has `chapters: SearchChapter[]`, and speaker/topic records contain
`chapterIds`. It excludes private metadata and browser-only BSB enrichment.

Chapter rows retain the existing component styles and show the short summary.
Service pages list chapters once, with a single correction link per chapter and
per service. Browse pages work without JavaScript and use deployment-aware URLs.

## Playback and compatibility

Canonical chapter links are `/watch/?chapter=<stable-id>`. IDs are the original
chapter/section IDs. A chapter selects its physical upload and exact start/end.
The player remains keyed by video ID, so changing uploads disposes the old player.

`resolveSelection(services, target)` is synchronous for chapter and service/video
targets. Only old `?id=` links call `resolveLegacyChapter(base, oldId, signal)`;
the returned ID must exist in the current public services before Watch replaces
the URL. No old text or segment objects are fetched. Unknown IDs show not-found;
network failure shows a retry action. New links never emit `?id=`.

Existing service/video/time links still work. Valid times are bounded to the video
and select a chapter only when `start <= time < end` on that same upload. Gaps
remain full-recording positions with no invented chapter or endpoint. Known
chapter selections replace the address with their canonical chapter URL; the
initial resume position remains only in component state.

`createChapterController` exposes `setChapter`, `tick`, `replay`,
`continueWatching` and `ended`. A `PlaybackRange` has `{id,start,end?,resumeAt?}`.
A valid in-range resume seeks to `resumeAt`, while Replay always seeks the full
chapter's `start`. The endpoint soft-pauses an actively playing video once, without
rewinding manual seeks. Continue disables the current endpoint; Replay or selecting
a new chapter rearms it. No transcript panel or secondary segment list remains.

`ScriptureLinks` still displays only references, with canonical ESV URLs and
optional original display spelling. Hidden BSB search text is never displayed.

## Home and local state

Home keeps one card per eligible upload and the established featured layout. New
users see the latest eligible sermon; cards link to its chapter when available.
Returning users resume only a known, unfinished service/video using the existing
local progress record. The watch resolver then safely identifies the chapter.

Search history and playback progress keep the existing local-storage keys.
**Clear search history** preserves playback and unrelated storage. Policies'
clear-all action removes both RECS records and reports storage failure honestly.
No account, remote history or correction-link history is introduced.

## Verification handoff

`tests/browse.test.ts` covers publication filtering, categories, stable IDs,
non-root URLs, hidden BSB exclusion, unknown metadata, home selection, multipart
selection, time containment and gaps. Player tests cover endpoint, Continue,
resume/full Replay, malformed times and local-state behavior.

The existing desktop, portrait and landscape Penpot references and checked-in CSS
remain the visual authority. CSS changes are semantic selector renames and removal
of unused panel/list rules, with existing tokens, spacing, typography and layout
values preserved. Fresh browser, keyboard, screen-reader and responsive checks are
pending the integrating owner's post-migration run; unit coverage is not visual or
WCAG conformance evidence.
