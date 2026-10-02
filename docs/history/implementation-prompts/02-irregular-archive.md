# Prompt 2: Model The Irregular Archive

Read `docs/implementation-prompts/README.md` first and follow its shared contracts. Continue from the passing Milestone 1 checkpoint on the same feature branch and draft PR. Read `docs/run-log.md`, then inspect existing schemas, curator skill, design system, tests, and prior decisions before editing.

Add these seven videos, producing eight core physical videos across five logical cases when combined with Milestone 1:

```text
16 August 2026, part 1: mw4SAoJRZgo, 12m 57s
16 August 2026, part 2: XWAH9SWFcoo, approximately 30m
16 August 2026, part 3: IcIxBc--VvM, approximately 50m

28 June 2026, failed stream: wh4mCRKRJ-4, 7s
28 June 2026, full stream: k27dmsPvmG8, approximately 1h 41m

27 September 2020, Authority: W2IZ6MUX-Yk, approximately 1h 5m
Known: Luke 20:19-26; Romans 13:1-7; Rev. Yong Teck Meng

2 November 2025, The Death That Brings Life: Sacrifice:
94fynFHtreg, approximately 51m
Known: Genesis 22:1-19; Romans 12:1-2
```

Run the media preflight, then use the curator skill and authorized `yt-dlp`/`ffmpeg`/whisper.cpp pipeline one logical case at a time. `mw4SAoJRZgo` was only used for calibration in Milestone 1, so acquire and interpret it properly now. Preserve trusted metadata and do not infer unsupported details. All newly interpreted services remain `editorial_status: needs_review`, including services containing failed or rejected uploads whose media disposition records why they are unsuitable. If real access fails, record the blocker and stop the run; fixtures may test behavior but cannot satisfy this milestone.

## Logical Services

Implement and verify:

- One 16 August logical service containing three ordered physical videos.
- Every passage tied to the physical video that contains it.
- Seamless logical-service browsing while playback selects the correct upload.
- The seven-second 28 June upload retained with `media_disposition: failed` and evidence.
- The full 28 June upload used for normal playback.
- Failed and rejected uploads excluded from search and recommendations without being erased.
- `Sacrifice` treated as a pre-trimmed sermon, without invented service sections.
- Existing `Authority` and `Sacrifice` metadata preserved and augmented rather than overwritten.

Validate sequence uniqueness, service membership, failed/rejected-video exclusion, and that every default playback video is `playable`.

## Bible Enrichment

Implement the shared Bible Text contract: ESV references with esv.org links for display, and public-domain BSB verse text used only as hidden search input. Re-check the ESV terms first. Document the BSB source, version, public-domain status, and update process. Maintain canonical book names and common aliases.

Parse canonical names, common abbreviations, chapter references, and verse ranges. Preserve the original display reference while storing a normalized form. Generate esv.org links from the normalized form. Never commit, bundle, or display ESV verse text.

Support exact searches such as `Romans 13`, variants such as `Rom 13`, and verse-text matches such as `living sacrifice` through the BSB search text.

## Hybrid Search

Implement centralized, testable score components for semantic similarity, transcript exact matches, title, scripture reference/text, and speaker/topic/date metadata. Exact identifiers must not be weakened by semantic ranking. Explain the strongest supported match reasons.

Meet these acceptance cases without query-specific hard-coding:

- `Romans 13` prominently finds `Authority`.
- `Yong Teck Meng` finds records with that trusted speaker metadata.
- `How should Christians relate to government?` returns the relevant `Authority` passage in the top three.
- `Abraham and Isaac` reaches `Sacrifice`.
- `living sacrifice` reaches `Sacrifice`.
- A 16 August result opens the correct one of its three uploads.
- The failed seven-second stream never enters ordinary results.

## Home, Browse, And Player

Implement browse views for available data among Services, Sermons, Speakers, Bible books, Topics, Series, and Years. Do not invent content for empty categories.

Complete:

- New-user home featuring the latest sermon included in the current build mode, which is reviewed content in production and preview-labelled content in preview.
- Returning-user home using local-only progress for `Continue watching`.
- Penpot-derived desktop cards/category tiles and mobile chips/single-column feed.
- Logical service pages with ordered uploads and major sections.
- Static speaker, scripture, topic, series, and year URLs.
- Local search history with a clear removal action.
- Loading, model-download, empty, no-results, and failure states.

Test focused inputs with a real mobile viewport rather than rendering the Penpot keyboard artwork.

Keep chapters distinct from smaller searchable passages. Highlight active items without color alone and show the reviewed transcript segment with surrounding context where available.

When navigation crosses multipart uploads, switch YouTube IDs correctly. After `Continue watching`, clear the soft-stop guard so playback does not immediately pause again.

## Required Tests

Test multipart ordering and navigation, failed-stream exclusion, pre-trimmed sermon behavior, trusted metadata preservation, forbidden curator promotion, production/preview content filtering, scripture parsing, esv.org link generation, absence of ESV text from the repository and build output, BSB verse-text matching, hybrid scoring and reasons, all named acceptance queries, new/returning home states, local history/progress, static browse URLs, soft-stop clearing, cleanup of every processed recording, and every Penpot orientation using live Penpot or the checked-in exports.

## Completion Gate

Do not complete the checkpoint until all five core services are `editorial_status: needs_review`, all eight real core videos have evidence-based media dispositions, 16 August behaves as one service in the local preview build, the failed 28 June upload is excluded from search because of its disposition, the named queries pass against the local preview build, and each result opens the correct upload and timestamp. The local production build must still exclude every unapproved record. Follow the shared completion protocol, create and push the Milestone 2 checkpoint, update the same draft PR, then load Prompt 3 and continue.
