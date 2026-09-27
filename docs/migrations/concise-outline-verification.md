# Concise outline and integrated tree verification

2026-09-26. Supersedes the public layout/counts in the earlier
`chapter-search-verification.md`; original preservation evidence remains valid.

## Implemented scope

All 22 services now contain **156 primary peer chapters and 78 selected subsections**.
The 21 eligible services expose 155 primary chapters and 78 subsections (233 search
units); the short unassessed clip is retained but excluded. All interpretation is
still `needs_review`, so production exposes zero units.

The August 23 example has nine main entries: Opening; Worship and Scripture;
Discovering Gifts for Faithful Ministry; Christian Allegiance and Civic Responsibility;
Trusting Christ’s Care in Uncertainty; Sorrow Gives Way to Promised Joy; Ask the
Father for Christ’s Purposes; Serving With Joy While Awaiting Restoration; Response
and Closing. The political Q&A remains independent of the four John 16 sermon
movements. Three selective subsections support direct access; routine events were
not copied wholesale into a nested inventory.

Every public chapter/subsection title uses Title Case. One holistic sermon paragraph
appears beneath the video and in service context. Per-unit synopses never render in
chapter/subsection rows, watch navigation, browse rows or search cards. Display
DTOs omit them; the static retrieval index still carries them for exact search.

Per the user’s follow-up, subsections are **inside the chapter block as a tree**.
A count/chevron button within the parent row expands smaller title/time rows with
connecting lines. It uses a native button, nested list, `aria-expanded` and
`aria-controls`, rather than a separate details/dropdown. Enter/Space works; expansion
preserves focus, URL and playback state. Child selection uses its precise range.
Neutral service groups and sermon movements have identical primary styling.

## Preservation and vector evidence

- All **582 original section records** now also reside in service-local
  `chapters.internal.yaml`, including the initial metadata-review work. All **1,646
  original passages/transcripts** remain unchanged in their existing internal files.
- Frozen Git-baseline verification passed after regrouping. Primary groups partition
  original sections once in order; every group and cue stays on the correct upload.
- Old passage IDs and retired chapter IDs resolve through minimal maps; retained
  cue IDs remain stable. Both old `?id=` and retired `?chapter=` links are handled.
- Regenerated changed-span vectors use the pinned transcript-window recipe, with
  lineage-aware unchanged-passage fallback. Current source artifacts cover **234
  units / 2,192 windows / 90,208 binary bytes** and pass binding/checksum verification.
  The first regrouped generation took 138.481s; the additional meaningful Romans 13
  cue reused cached windows without new inference. New combined spans all contain
  some usable text; this does not recover or erase the older missing-evidence notes.
- Both non-root builds passed exact publication/binary/BSB/gzip checks and scans
  against **56,108 private transcript shingles**.

## Verification

- Full unit/Python run: **512 passed, four optional integration checks skipped;
  77 Python checks passed**. New focused coverage includes grouping, immutable
  original fields, same-video parent containment, keyword evidence, Title Case,
  non-rendered synopses, fallback vectors and scripture-coverage deduplication.
- Lint and Astro/TypeScript passed, with the existing ESLint deprecation hint only.
- The 78-case browser run passed 72 cases initially. Six stale selectors assumed
  unique generic chapter titles; those tests now select stable IDs/physical-upload
  context, and all six passed their focused rerun. This includes **21 passing axe
  scans** and explicit integrated-tree checks on desktop, portrait and landscape.
- Desktop/mobile tree captures were inspected together. Child rows are visibly
  connected within their parent, compact and free of synopsis prose; no horizontal
  overflow was observed. This is not a formal conformance or live-YouTube claim.
- **110/110 retrieval acceptance checks passed** after target IDs were mapped to
  containing groups/cues. Romans 13 also accepts the August 9 actual reading/exposition,
  a substantive whole-service destination; the M2 core-only scope still requires
  Authority. No service/query-specific ranking code was added. The reference bonus
  now measures deduplicated requested-verse coverage, not repeated citation count.
- Regrouping initially caused two synthetic 5,000-row speaker-query budget failures.
  A query-local cache now scans repeated normalized field/BSB values once per query,
  preserving scores/reasons. Ranking/privacy fixtures passed after that change.
- Updated benchmark: **53/53 budgets passed** on the unchanged 4× CPU/loopback proxy.
  Real 233-row worst p95: **17.1ms exact / 17.5ms hybrid**; synthetic 5,000-row worst:
  **101.3ms / 170.6ms**. Preparation is separate: 1,107.8ms real / 6,845.9ms synthetic.
  Cold model 1,665.4ms, warm cache 1,335.5ms, warm inference p95 17.1ms; zero external
  requests. Synthetic rows are latency stress only. Report:
  `.local/performance-outlines-cached.json`.

## Current sizes

| Artifact | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Chapter/subsection metadata | 182,351 | 38,595 |
| Int8 vectors | 89,488 | 84,023 |
| Deduplicated BSB | 488,623 | 149,747 |
| **Search total** | **760,462** | **272,365** |
| Optional old-link mapping | 114,477 | 17,593 |

Compared with the original passage-era 7,626,007 compressed bytes, ordinary search
artifacts are approximately **96.4% smaller**, excluding model/application assets.
Source YAML is 378,608 bytes, mean 17,209/service. With binary vectors/manifests it
is 544,074 bytes, mean 24,731/service. These exclude immutable preservation and old
maps; they measure authored file output, not tokens or a reduction in Git history.

The 700-service projection now explicitly counts **search units**, both parents and
selected children. At 8/10/12/15 units per additional service, retaining the current
233 eligible units and including the full-BSB-once scenario, estimated compressed
search payloads are **4.60/5.39/6.17/7.35 MB**. Future compression, reference density
and curation choices can differ; these are scenarios, not measured future data.
`scripts/chapter-report.ts` reproduces the full assumptions and raw-vector sensitivity.

## Delivery

Code/content remain separate pending the normal signed checkpoint. No editorial
approval, merge or deployment has occurred. M5 caption automation is still pending;
the current curator and `docs/concise-outlines.md` record its updated whole-service,
sermon-description, Title Case and integrated-tree review procedure.
