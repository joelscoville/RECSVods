# Browse, playback and local history

## Static routes and publication boundary

Routes call `loadPublicArchive` for the current `ARCHIVE_MODE`. It loads the
recording files, filters production to `status: published` and derives
`DisplayRecording` and `SearchUnit` projections. Preview includes labelled drafts.
Markers and transcripts never enter those projections.

| Route, relative to the deployment base | Content |
| --- | --- |
| `browse/` | Available categories or an empty state |
| `browse/all/` | All recordings, newest first |
| `browse/scripture/<canonical-book-slug>/` | Recordings citing that Bible book |
| `browse/topics/<topic-id>/` | Recordings assigned that topic |
| `browse/series/<series-id>/` | Recordings in the series' playlist order |
| `browse/years/<YYYY>/` | Recordings in that year, newest first |

Books, topics, series and years have category indexes when data exists. Books use
Bible order, years run newest first and other category labels sort alphabetically.
`BrowsePage` contains links or `recordingIds`; it does not carry chapter-ID lists.
The source loader validates topic IDs and series membership against the shared
taxonomy files. Series playlists include only recordings visible in that build.

Recording pages show the stored chapter titles and times, with subchapters under
**Show Subchapters**, plus one **Suggest a change** action. Timestamped point notes
support search rather than being rendered. Browse pages use base-aware URLs.

## One recording clock

Canonical watch links use `watch/?r=<recording-id>&t=<seconds>`. An optional
`focus=<chapter-id>` identifies a named chapter or subchapter for bounded playback.
Times are on the recording clock, not an individual upload's clock. Uploads are
laid end to end with `uploadSkip` deducted from restarted uploads. The player maps
recording time to the correct upload and advances across upload boundaries.

Selecting an entry plays its range. Replay returns to the range start; continuing
past its endpoint allows the rest of the recording. An unavailable upload keeps
its position on the clock and is handled by the player rather than shifting every
later chapter. YouTube errors offer timestamped external playback where possible.

The earlier `?chapter=`, service/video and passage `?id=` link schemes are not the
current routing contract. New links use a recording ID and time so that editing the
outline does not change their time target.

`ScriptureLinks` renders reference-only ESV links with canonical URLs and original
display spelling where provided. Hidden BSB search text is never displayed.

## Home and local state

Home shows one card per recording, rather than one per physical upload. Returning
viewers can resume a known unfinished recording on its combined clock. Search
history and playback progress stay in browser storage; there is no account or
remote history service. Search-history clearing leaves playback progress alone;
the policies page offers broader local-data clearing.

The optional developer switch for unapproved recordings loads drafts live from
GitHub and opens them in the dev player. Those drafts are not bundled in production
pages or search artifacts. See [developer tools](README.md#developer-tools-dev).

## Verification

`tests/browse.test.ts` covers categories, publication filtering, playlist order and
base-aware URLs. Recording/player tests cover the combined clock, upload boundaries,
selection, replay and resume. Browser suites exercise actual hydration, playback
adapters, keyboard operation and responsive layouts. Automated adapters do not
establish actual YouTube availability; axe checks are not formal conformance evidence.
