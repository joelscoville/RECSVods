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
