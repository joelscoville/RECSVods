# Milestone 3 frontend QA

**Result:** scoped frontend checks pass; ready for the integration owner's batched
visual capture. No remaining blocker was found in the exercised paths.

**Verification date:** 2026-09-26 local (UTC+08:00). The actual clock check was
`2026-09-26T02:24:15+0800` / `2026-09-25T18:24:15Z`; the UTC calendar day is Sep 25.

## Builds and exact results

All commands used ordinary bounded `scripts/devenv-run`, sequentially, with no
parallel media work. Both final builds followed the application fixes.

| Check | Result |
| --- | --- |
| `SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build:preview` | Pass: 87 pages, 688 eligible passages |
| `SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build` | Pass: 7 pages, 0 eligible passages |
| Focused Vitest: corrections, browse, player | 81 passed, 1 opt-in artifact test skipped |
| Corrections with `RECS_TEST_PREVIEW_CORRECTIONS=1` after fresh build | 46 passed, no skips |
| Full `pnpm test:e2e --reporter=line` | 69 passed, no skips, one worker, 6.7 minutes |
| Accessibility evidence follow-up (`axe tagged\|keyboard chapters`) | 24 passed; persists JSON/ARIA text evidence |
| Tracking-aware correction expectation follow-up | 3 passed, one per viewport |
| Project `pnpm lint` | Pass |
| Project `pnpm typecheck` | 0 errors, 0 warnings, 1 existing ESLint `ts.config` deprecation hint |
| `git diff --check` | Pass |

The 69 executions comprise 12 existing archive checks, 15 M2 checks and 42 M3
checks. Follow-ups are reruns, not additional unique coverage. The final test-only
changes persist evidence and derive edit-link expectations from current Git
tracking; the affected tests and lint/typecheck were rerun. Application code and
build outputs did not change after the full passing run.

Source inventory supplied by integration: 10 logical sources, 13 uploads,
one failed upload and one retained unassessed short upload. Nine services are
preview-eligible. This pass rebuilt/verified both outputs, not media evidence or
classification. The previously reported 74 evaluator checks were not rerun here.

## Material fixes

1. **Correction draft before issue-form installation.** GitHub installs issue
   forms from the default branch. `site/lib/corrections.ts` now includes standard
   Markdown `body` alongside all existing form parameters. It repeats the same
   stable public IDs, archive timestamp bounds and canonical deployment-relative
   page; includes six named problem checkboxes and an optional selected choice;
   and offers a suggested-correction prompt. Caller body text and private query,
   history and resume state cannot enter it. Unit tests distinguish reserved
   `body` from issue-form field IDs and verify privacy for both forms of context.
2. **Keyboard focus after Play.** Browser testing demonstrated that iframe focus
   was attempted while its host was `visibility:hidden`. `YouTubePlayer.tsx`
   now focuses the iframe after the ready-state DOM update. The keyboard journey
   asserts its full accessible title and actual focus.
3. **Long playback title.** A synthetic long/unbroken title overflowed the player
   overlay. Existing CSS now wraps and limits only that duplicate overlay title
   to two lines. Its full text remains in h1 and Play's accessible name. Tests
   check horizontal text bounds and separation from Play and the connection
   notice at every viewport. No palette, font, player ratio or component redesign.
4. **M2 latest-home expectation.** The test derives the newest eligible sermon
   from sources and playable uploads (currently Sep 13), rather than pinning the
   new-user feature to Sep 6. The saved Sep 6 / `ZTDYIJUDb0M` / 3200-second resume
   case remains deterministic, including persistence after clearing search history.

## Browser matrix and interaction scope

Chromium via the existing Playwright configuration:

- Desktop **1728×1000**.
- Mobile-emulated portrait **390×844**, touch enabled.
- Mobile-emulated landscape **844×390**, touch enabled.

`tests/e2e/milestone3.spec.ts` has 14 scenarios, each at all three sizes:

- Seven tagged axe scans (routes below).
- Correction URLs on service, passage card, selected watch passage, full-video
  watch, exact selected chapter, transcript context, interactive search and
  static government-topic browse. Exact decoded IDs, fractional bounds, canonical
  page, all Markdown choices, no-referrer attributes and private-state exclusion.
  Existing tracked M2 source edits are present; currently untracked M3 source edits
  are absent. Expectations read actual Git tracking and original transcript pointers.
- Tab/Shift+Tab/Enter from skip link through named search, result, Play and native
  iframe focus. No `.focus()` or click substitutes in these keyboard journeys.
- Tab/Enter chapter selection, native transcript disclosure, correction link
  activation and all-passages disclosure. Assertions cover visible focus rings,
  `aria-current`, “Current chapter”, “Selected passage”, and reduced-motion CSS.
  Correction activation is fulfilled by an in-memory test sink; its request
  headers are inspected for absent Referer, without contacting GitHub.
- Synthetic index 503 and successful retry; blocked semantic model with useful
  exact results and a named meaning-based retry action.
- Synthetic YouTube adapter error 100, readable alert, timestamped direct link
  and successful retry. This verifies application recovery, not provider behavior.
- Response-only synthetic long title/name, four scripture references and missing
  optional speaker; no spurious `undefined`, unknown speaker or dangling separator.
- Response-only synthetic long playback title; Play and consent remain separate.

Primary controls in watch action rows, error actions, synthetic result actions
and the long-title Play button are measured at **at least 44×44 CSS px**, with
pairwise overlap checks. Document horizontal overflow is checked on the scan
routes and difficult-content/error states. This is a sampled control/layout
scope, not a claim that every link in the archive was measured. Synthetic content
exists only in intercepted HTTP responses, never in archive files or build data.

## Automated accessibility scope

**21 scans passed with zero violations and zero incomplete results** under
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. Each route is scanned once
per viewport:

1. Preview home.
2. Preview search/history/category screen.
3. Preview search results for `Romans 13` (semantic model intentionally blocked).
4. Preview watch `p0927-romans-government`, idle, **no YouTube loaded**.
5. Preview service `2026-09-13`.
6. Preview `browse/topics/government/`.
7. Current empty production home on port 4174.

No axe violations required a token/color change. The explicit keyboard and
content-length tests found issues outside those passing automated scans.
JSON evidence is emitted at `test-results/milestone3-axe-*/axe.json`, containing
route, tag set, passing-rule count, incomplete IDs and violations. Successful
snapshots are local test artifacts and can be regenerated; later Playwright runs
may replace the default output directory.

## Assistive-technology-oriented inspection and design reference

Manually inspected Playwright's **DOM-derived ARIA text snapshots**, produced by
`locator.ariaSnapshot()`, for the representative Authority watch passage at all
three sizes, plus the keyboard assertions and the implementation's native
semantics. This is not an OS accessibility-tree or actual screen-reader test.

Observed: a main landmark; one named h1/recording region; Play named with the
passage title; separate ESV reference link names; named Chapters and Passage
transcript regions; chapter buttons with time/title/speaker/duration and current
text; explicit unreviewed label; named GitHub correction/edit actions; previous
and next context summaries; selected passage text in the expanded list. Mobile
snapshots additionally expose “Back to service”. Repeated correction names are
read in their surrounding passage context. Snapshot paths:
`test-results/milestone3-keyboard-chapte-*/watch-accessible-structure.txt`.

Design authority: checked-in Penpot snapshot captured **2026-09-23**, existing
`tokens.json`, current CSS and components. Inspected saved desktop, portrait and
landscape playback exports for the narrow fixes. Existing Atkinson Hyperlegible
Next / Domine roles, palette, spacing and player/chapter composition were retained.
The duplicate-title clamp is an intentional long-content accommodation with full
text available below. Mechanical scoped detector returned no findings.

**Limits:** no fresh screenshots or visual-fidelity sign-off in this pass; those
remain with the requested batched capture. No physical keyboard, VoiceOver/NVDA,
real mobile keyboard, touch-device hardware or other browser engine was tested.
YouTube errors used a test adapter; actual provider playback evidence remains the
earlier M1 verification. GitHub rendering of the unmerged form/fallback was not
contacted or account-tested. No formal WCAG conformance conclusion follows from
these checks. No archive IDs/classifications, operator M4 input, approval, staging,
commits, manifests or network-account actions were changed/performed.
