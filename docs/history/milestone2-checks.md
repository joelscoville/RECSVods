# Milestone 2 focused acceptance

## Recorded result — 2026-09-25

**Passed:** 27 CLI acceptance checks and 27 Playwright test executions against the
existing `/replay-check/` builds. No product blockers were found in this scope.

- Corpus: **5 logical services / 8 physical uploads**, all services `needs_review`.
- Media: `wh4mCRKRJ-4` retained as `failed` with evidence; the other **7** uploads
  are `playable` with disposition evidence. June's ordinary playback uses
  `k27dmsPvmG8`.
- Generated passages: **346 preview / 0 production**.
- Preview `passages.json` SHA-256:
  `03c0fbdf9e6b6fec5aee10629caa3441d38f1df0a59573fc34ac9ee7cbe9549a`.
- Focused ESLint and `tsc --noEmit` passed.

This is programmatic corpus and browser-behavior evidence. Visual review,
screenshots, actual YouTube network playback, media cleanup verification, and
the broader milestone completion protocol remain separate checks. This is not
a formal accessibility or Bible-text licensing audit.

## Run commands

Run sequentially from the repository root. The wrapper retains its finite
900-second process-group deadline. Browser runs use the existing Playwright
configuration: preview on `4173`, production on `4174`, one worker, and a
45-second timeout per test. Both builds must already exist at `/replay-check/`;
the tests start their own servers and do not rebuild or reuse running servers.

```sh
# Build prerequisites when outputs need refreshing (already supplied for this run):
SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build:preview

# Commands executed for this acceptance:
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsx scripts/evaluate-core.ts
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec playwright test tests/e2e/milestone2.spec.ts
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec playwright test
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec eslint scripts/evaluate-core.ts tests/e2e/milestone2.spec.ts
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm exec tsc --noEmit
```

The focused initial browser run exposed test-harness issues: Playwright's Node
loader could not import the build-time scripture JSON transitively, and the year
browse assertion incorrectly expected passage links rather than service links.
The tests now read the YAML fixture metadata directly (the CLI validates its
schema) and assert the actual year-page service link. After those corrections,
the combined run passed **27/27 in 1.8 minutes**: the existing **12** executions
plus **15** new executions. No product code or acceptance thresholds were changed.

## Actual-corpus evaluator

`scripts/evaluate-core.ts` prefers the canonical pair
`dist/preview/generated/{passages,vectors}.json`. If that preview index is absent,
it reads the canonical `site/public/generated/` pair, which must still equal the
current enriched preview projection. It also requires the built production index.
Missing or stale inputs fail; the evaluator does not regenerate artifacts.

The **11 non-query checks** cover strict source validation, all required service
and physical IDs, editorial/media states and evidence, canonical enriched preview
equality, production exclusion, failed-media projection exclusion and playable
defaults, ordered August uploads, trusted metadata and Sacrifice's sermon-only
chapters, normalized ESV links, vector integrity, prepared model integrity, and
an observed real semantic contribution. Source validation runs before reporting;
an invalid source or unreadable input exits with a named blocker.

Vector verification checks the digest of the exact passage-index bytes, shared
embedding configuration, complete passage-ID set, each exact embedding document,
and normalized 384-dimensional vectors. Local prepared and built model files
are checked against pinned upstream hashes. `embedTexts` embeds the **actual eight
query strings**, using the existing prepared model with remote model loading
disabled. The evaluator neither calls `prepare` nor downloads anything.

All ranking uses the centralized product `search()` implementation and its
unchanged weights. JSON output reports each mode's pass/fail, accepted rank and
threshold, target service/passage IDs, and top-three IDs, upload IDs, timestamps,
scores (six decimals), and match reasons. Any failed check or query threshold
sets exit code 1; artifact/corpus failures block hybrid acceptance rather than
silently allowing an exact-search fallback to count.

### Query results

Eight queries × two modes = **16/16 passing query checks**. All accepted targets
ranked **1 in exact and real-embedding hybrid search**.

| Query | Acceptance threshold | Observed first ID (both modes) | Required evidence |
|---|---|---|---|
| `Romans 13` | Authority rank 1 | `p0927-romans-government` | Scripture reference reason |
| `Rom 13` | Authority rank 1 | `p0927-romans-government` | Normalized scripture reference reason |
| `Yong Teck Meng` | Authority within top 3 | `p0927-welcome` | Trusted `Rev. Yong Teck Meng` field and speaker reason |
| `How should Christians relate to government?` | Accepted relevant passage within top 3 | `p0927-romans-government` | Accepted IDs: `p0927-romans-government`, `p0927-government-allegiance` |
| `Abraham and Isaac` | Specific Sacrifice passage within top 3 | `p1102-abraham-isaac` | Correct service and passage |
| `living sacrifice` | Specific Sacrifice passage within top 3 | `p1102-living-sacrifice` | Correct service/passage and BSB verse-text reason |
| `16 August 2026` | August service rank 1 | `p0816-p2-ephesians-reading` | Date reason |
| `27 September 2020` | Authority rank 1 | `p0927-word-authority` | Date reason |

Government's top three in both modes were `p0927-romans-government`,
`p0927-government-allegiance`, and `p0927-public-services`. Their hybrid scores
were **8.432036**, **8.262944**, and **6.259480**; each reported semantic similarity.
The first result maps to `W2IZ6MUX-Yk`, **2284.22–2358.42 seconds**.
The accepted Abraham/Isaac passage maps to `94fynFHtreg`, **1640.72–1706.96s**;
living sacrifice maps to the same upload, **2399.24–2444.22s**.

## Browser coverage

`tests/e2e/milestone2.spec.ts` adds **five tests**, each executed at desktop
1728×1000, portrait 390×844, and landscape 844×390. Real built corpus data is
required; these tests do not skip empty or missing content.

1. **Live worker hybrid search:** loads the government question, waits for the
   actual hybrid-complete status (up to 30 seconds within the 45-second test),
   inspects real top-three passage links and semantic reasons, then clicks Play
   and verifies the physical upload and precise start. Model/ONNX requests must
   use loopback. Observed full test durations were **7.4s / 6.9s / 5.1s**.
2. **Multipart and endpoint:** checks the three ordered upload links; navigates
   chapters across `mw4SAoJRZgo`, `XWAH9SWFcoo`, and `IcIxBc--VvM`; verifies current
   chapter text and `aria-current`; presses Play after each cross-upload idle
   remount; checks the adapter's constructed `videoId` sequence. Reloaded passage
   links on all three uploads seek to their own exact starts. Advancing to a
   passage endpoint pauses; Continue watching clears the stop through subsequent
   controller ticks beyond the endpoint.
3. **Browse, input, and scripture:** real static speaker
   `/browse/speakers/yong-teck-meng/`, scripture `/browse/scripture/romans/`, topic
   `/browse/topics/government/`, and year `/browse/years/2020/` URLs return 200 with
   correct H1s and Authority links. Focused native search inputs remain in the
   viewport. Living-sacrifice results display labelled ESV reference links;
   indexed BSB verse text is absent from the result-page DOM and no Bible API
   request occurs. Serialized search inputs are not confused with rendered text.
4. **New/returning home:** new home features the latest preview sermon; locally
   seeded progress for primary upload `ZTDYIJUDb0M` at 3200s produces the returning
   heading and resume link. Clearing search history announces success, removes
   history, and preserves playback progress through navigation.
5. **Exclusion:** failed upload absent from the served index and ordinary links
   on home, service browse, and every core service page; direct failed-upload
   playback gives Recording not found. Production has an empty index/home and
   all five unreviewed service routes return 404.

External network requests are blocked in the new tests. Only YouTube's IFrame API
is mocked, using the existing suite's adapter pattern extended to record physical
video IDs, seeks, pauses, and polling ticks. Search results and embeddings in the
live-worker test are not mocked. The mock establishes application behavior after
explicit user Play actions; it does not establish actual YouTube playback or
cross-upload autoplay. No screenshots were captured for this focused acceptance.
