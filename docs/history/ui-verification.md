# Milestone 1 interface verification

Checked 2026-09-25 against the complete saved Penpot reference captured 2026-09-23.
The desktop-new frame was also exported live and visually inspected during this
run. Later Penpot calls were blocked by the suspended tab; no broader live-fidelity
claim is made and no source design was edited.

## Implemented behavior

- Penpot palette, Atkinson interface typography, Domine editorial CTA, burgundy
  new-user feature, indigo returning-user feature, periwinkle controls and dark footer.
- Responsive home, search, playback, service and policy pages. The one-service
  catalogue intentionally has fewer cards than the design's placeholder catalogue.
- Passage-level exact search with lazy, self-hosted worker-based semantic search;
  honest loading, retry and empty states.
- Shareable query/passage URLs, original YouTube playback, chapter navigation,
  visible passage transcript, reference-only ESV links, replay and continuation.
- Visible unreviewed labels in local preview; empty production archive until approval.

## Checks

- Playwright: 12 browser tests passed at 1728×1000, 390×844 and 844×390 with real
  preview records. Includes keyboard skip/search focus, query reload, no horizontal
  overflow, production exclusion, and deterministic player-adapter endpoint behavior.
- Live YouTube: the real IFrame API loaded `ZTDYIJUDb0M` with requested start 3133s.
  At the initial sample the video was playing at 3142.207s. Seeking the real video
  near the passage endpoint (3219s) demonstrated the UI's endpoint pause, followed
  by Continue watching and Replay. No mock provider was installed for this check.
  An earlier natural-duration wait timed out; the final check does not establish
  uninterrupted network playback for the full 87-second passage.
- Generated-output checks: production 0 passages, preview 77 unreviewed passages;
  no downloaded media/authorization files; every output file below 100 MiB.
- Final captured home/search/watch pages had scroll widths equal to their viewport
  widths at all three sizes. Desktop chapter scrolling is bounded; portrait keeps
  chapters in normal flow; landscape preserves 16:9 playback and a reachable Back.
- Fresh read-only review of the final captures returned **ship**, with no high- or
  medium-impact defects identified in that bounded review.

Local captures and measurements are in gitignored `.local/ui-review/`. Reproduce
them after a `/replay-check/` preview build with:

```sh
scripts/devenv-run pnpm exec tsx scripts/capture-ui.ts
```

This live capture check uses the first service's fixed passage as an acceptance
sample; it needs network access to YouTube. Core browser tests use a deterministic
adapter so they remain independent of provider availability.

## Limits

This is implementation verification, not a formal accessibility conformance
assessment. Screen-reader testing, a physical mobile software keyboard and native
YouTube touch-control testing remain manual checks. The returning-user appearance
is implemented and its saved-state logic unit-tested; final visual captures focus
on the new-user state. Editorial confidence and word-level transcript accuracy are
separate from these interface checks.

## Milestone 2 extension — 2026-09-25

Compared new/returning home, search, results, static browse and playback captures
with the same unchanged offline references at 1728×1000, 390×844 and 844×390.
Captures are in `.local/ui-review-m2/`; the reproducible command is:

```sh
scripts/devenv-run pnpm exec tsx scripts/capture-ui.ts --milestone2
```

All 15 measured route/viewport combinations had matching document and viewport
widths. Returning-home captures verified the indigo feature and saved progress;
new-user captures retained burgundy. A fresh bounded visual review returned ship
with no high-/medium-impact fixes. Variable catalogue and category counts, long
scrollable result lists, and the mandatory preview notice are legitimate content
differences from static mockups. Some empty-query captures include the actual
archive-loading state; passing browser tests separately establish completed loads.

Milestone 2's 27 browser executions also verify real-worker hybrid search,
multipart video selection, static browse routes, local history clearing without
erasing resume state, and production/failed-media exclusion. See
`docs/milestone2-checks.md` for exact acceptance queries and evidence scope.

## Milestone 3 confirmation

Final captures in `.local/ui-review-m3/` cover new/returning home, loaded search,
results, browse, playback and a service page at the same three viewports. All
18 measured route/size combinations have no horizontal document overflow. A fresh
bounded comparison with the saved Penpot frames returned ship with no material
fixes. Correction/edit links wrap in the established action rows; mobile Back and
Play remain reachable. Very long service/result pages are intentionally scrollable;
review of those pages used representative viewports, not an exhaustive pixel audit.

The final 69-browser-execution run passed after all M3 changes, including 21 tagged
axe scans with zero violations/incomplete findings. The initially combined command
exceeded its external five-minute tool wait partway through browser tests; it was
not a product assertion failure. Verified orphaned test-server groups were stopped,
test servers were changed to direct Node entry points with graceful shutdown, and
the full run passed in 6.4 minutes under the existing finite 900-second wrapper.

Keyboard and DOM-derived ARIA inspection, difficult content lengths, unavailable
player/retry states, model/index failure fallback, and correction-link privacy are
documented in `docs/milestone3-ui-checks.md`. Physical keyboards/software keyboards,
actual assistive-technology sessions, and new real-provider playback are not claimed.
