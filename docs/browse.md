# Browse, local history, and passage context

## Static routes and publication boundary

`site/pages/browse/index.astro` and `site/pages/browse/[...path].astro` load the
archive on the server using `loadArchive`, `publishedServices`, and
`flattenArchive`, with the current `ARCHIVE_MODE`. Only the sanitized
`displayServices` projection reaches the components. Production contains reviewed
services with playable videos; preview additionally contains clearly labelled
needs-review services with playable videos. Failed/rejected uploads, their
passages, and metadata used only on those uploads produce no browse links.

Available routes, relative to the configured deployment base:

| Route | Content |
| --- | --- |
| `browse/` | Available categories, or an honest empty archive message |
| `browse/services/` | One entry per logical service, newest first |
| `browse/sermons/` | Actual sermon chapters, or a pre-trimmed sermon recording without invented chapters |
| `browse/speakers/<speaker-id>/` | Actual speaker's chapters and passages |
| `browse/scripture/<canonical-book-slug>/` | Passages referencing that Bible book, e.g. `1-john` |
| `browse/topics/<topic-id>/` | Passages assigned the topic |
| `browse/series/` | Factual series present on eligible services |
| `browse/series/<series-id>/` | Logical services in that series, newest first |
| `browse/years/<YYYY>/` | Logical services in that year |

Speakers, Bible books, topics, and years also have static category indexes. IDs
come from archive metadata rather than display-name slugs. Book slugs come from
canonical references; years come from ISO service dates. Empty categories are
not generated. Optional service `series: { id, name }` supplies the Series category
and stable series URLs only when eligible data exists. Shared series IDs must use
the same name; conflicting names are rejected rather than silently merged. No
series is assigned to the real archive by this capability change.
Service cards and service pages use the existing text-link style for the series.
The display and search-passage projections carry only the optional `id` and `name`,
omitting the key when absent. Search navigation can derive Series from these
passages alone. Exact search matches the series name as a general metadata field
with weight 4; the explicit embedding-document fields are unchanged. Hidden BSB
verse text and transcription provenance are not rendered as series metadata.
All links use `browseUrl`, `serviceUrl`, or `watchUrl`, preserving nested/non-root
deployment bases. Browse pages work without JavaScript.

## Home and local state

The reviewed desktop category tiles and mobile scrolling chips now link directly
to static categories and the browse index. Home still has one card per eligible
physical upload, not per searchable passage. The new-user feature selects the
latest eligible sermon (falling back to a service only when there is no sermon).
The returning-user feature uses local playback progress only when its service and
video still exist in this build and playback is unfinished. Resume uses a
full-video target, so it does not re-arm a prior passage endpoint.

Search's **Clear search history** removes only the RECS search-history key and
announces success or a storage failure. Playback progress and unrelated storage
remain intact. The existing Policies clear-all action still clears both RECS
history and playback progress. Storage and same-document clear events refresh
the history display; no account or remote history is introduced.

## Player and scripture

The selected transcript remains visible. Native `details` controls expose the
actual previous/next indexed transcript segment on the same physical upload.
Each has its own title, timestamp range, transcript body, and playback link.
Gaps are explicitly labelled; segments are never joined into a continuous
transcript and context never crosses uploads. Chapters continue to navigate by
the section's physical video ID; the existing keyed YouTube player switches
uploads. Searchable passages remain distinct from major chapters.

`ScriptureLinks` accepts canonical `references` and optional parallel
`displayReferences`. Its ESV URL uses `scriptureUrl` and the canonical reference;
visible spelling uses the original reference when supplied. Watch supplies
`SearchPassage.scriptureDisplay`, including for full-recording metadata. There
is no rendering of the hidden BSB `verseText` search field.

## Verification and design scope

`tests/browse.test.ts` covers eligible static route sets, stable IDs, dates,
non-root bases, absent categories, preview labels, hidden verse-text exclusion,
home selection, multipart video resolution, filtered default playback, adjacent
context boundaries, and original/canonical scripture display. Additional
`tests/player.test.ts` cases cover search-only clear success/failure and existing
clear-all behavior.

Implementation reuses the checked-in Penpot reference's category tiles, chips,
chapter rows, passage results, header/footer, typography and palette. Only
scoped browse CSS is added. Final live mobile-input, keyboard, responsive and
milestone screenshot verification is performed by the integrating agent; unit
tests are not a claim of visual or WCAG conformance.
