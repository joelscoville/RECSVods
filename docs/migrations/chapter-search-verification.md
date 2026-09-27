# Chapter-search implementation evidence — 2026-09-26

This records the first chapter-only implementation against the chapter-search
decision. **It is not final migration acceptance:** a newly appearing operator
brief, `2026-09-26-sermon-outline.md`, requires a different public outline before
acceptance. Preserve this evidence as an intermediate measurement, not a claim
that the later outline brief has been implemented.

## Preservation and metadata

- Frozen baseline: Git `540abab`; 22 services, 25 physical uploads, 582 sections,
  and 1,646 passage records.
- Lossless migration and post-review verification passed against that baseline.
  Every original section field/boundary and every passage/transcript is retained;
  passages live in service-local `passages.internal.yaml` files. The baseline
  manifest contains hashes and counts, not transcript text.
- Metadata-only passes covered all 582 chapters, synthesizing existing passage
  summaries and retaining only supplied spoken keyword candidates. No new audio
  listening or ASR was performed. Each local review receipt records its scope,
  uncertainty and protected-field checks. All services remain `needs_review`.
- Preview eligibility is 21 services / 581 chapters. The unassessed short July 12
  clip remains internal and excluded. Production contains zero chapters.

## Committed-format vectors and privacy

The source sidecars are ready for a content checkpoint but are not yet committed.
Generation used 1,886 overlapping token windows (1,885 newly embedded and one cache
hit), took 181.114 seconds, and wrote 223,840 binary bytes across 22 services.
Nine August multipart chapters had no usable transcript text and have explicit
zero rows; no summary-derived substitute vectors were created.

The explicit repeated processing pass after metadata review reused all 22 services
byte-for-byte: zero model initialization, zero inference, zero writes, 1.849 seconds.
The source-artifact verifier passed all 582 ordered bindings. Builds read committed-
format rows and metadata only; fixture builds also pass without any ASR or internals.

Both non-root builds passed output checks against 56,108 normalized private
transcript shingles, exact BSB content, binary row order and gzip reconstruction.
Pinned tokenizer vocabulary is distinguished from private data by upstream byte
hashes; the vendor worker's computed diarization confidence expression has a narrow
code-shape exception, while literal private fields and all transcript/hash leaks
remain rejected. See the injection tests and `chapter-search-artifacts.md`.

## Measured search artifacts

All values are bytes. Model/application assets are separate. The optional legacy
map loads for old links only and is excluded from ordinary search totals.

| Artifact | Raw | Gzip |
| --- | ---: | ---: |
| Before: passage metadata | 3,154,353 | 718,476 |
| Before: JSON vectors | 15,627,541 | 6,907,531 |
| **Before total** | **18,781,894** | **7,626,007** |
| Chapter metadata | 393,446 | 83,751 |
| Int8 vectors | 223,120 | 204,854 |
| Deduplicated BSB | 488,623 | 149,747 |
| **Current search total** | **1,105,189** | **438,352** |
| Optional legacy map | 71,945 | 13,755 |

Compressed search artifacts are approximately **94.3% smaller**. Current BSB data
contains 3,308 unique verses, not a copy of verse text per chapter.

Source YAML fell from 2,148,986 bytes (97,681/service) to 486,432 bytes
(22,111/service). Adding binary vectors and provenance manifests brings current
source output to 860,633 bytes (39,120/service). These are file-output measurements,
not agent token counts. Preserved internal passages and old-link maps are excluded
from that new-authoring comparison; the repository still retains the old material.

## Qualified 700-service scenarios

These retain all 581 currently eligible chapters and add 679 services at each
stated future density. They do not pretend the existing corpus was resegmented.
Metadata/vector gzip rates are extrapolated from current data. The Bible scenario
includes all 31,102 BSB verses once (1,330,855 compressed bytes), plus reference-map
growth extrapolated separately. Future prose, vocabulary, references and compression
may differ. These are scenarios, not measurements of 700 real services.

| Chapters per new service | Total chapters | Estimated search gzip | With raw rather than gzip vectors |
| ---: | ---: | ---: | ---: |
| 8 | 6,013 | 4,441,560 | 4,630,602 |
| 10 | 7,371 | 5,144,089 | 5,375,825 |
| 12 | 8,729 | 5,846,620 | 6,121,050 |
| 15 | 10,766 | 6,900,415 | 7,238,886 |

Reproduce actual sizes, per-service breakdowns and assumptions with
`scripts/devenv-run pnpm exec tsx scripts/chapter-report.ts`. The sermon-outline
amendment will change these counts; measure again after its implementation.

## Retrieval, browser and performance evidence

- **508/508 TypeScript tests**, including opt-in real CPU embeddings, browser WASM
  agreement, token-window inference and built-preview corrections.
- **77/77 Python tests**. ESLint and Astro/TypeScript checks passed (one existing
  ESLint configuration deprecation hint, zero diagnostic errors/warnings).
- **110/110 chapter acceptance checks**, using actual pinned-model query vectors.
  All original natural-language questions and rank thresholds remain hybrid gates.
  Four cases explicitly use separate lexical keyword companions; those are not
  claims of exact recall for the longer questions. September 13 additionally
  accepts the substantive meditation/prayer/praise answer at `s0913-knowledge`,
  supported by preserved `p0913-two-movements` at 4123.72–4347.46 seconds.
- Ranking now has general inflection normalization, metadata document-frequency
  weights and a constrained distinctive-cue fallback. No query IDs, service IDs or
  bespoke answer mappings occur in ranking code. BSB common words no longer dominate
  chapter descriptions; match reasons remain tied to actual contributing fields.
- **75/75 browser executions**, across desktop, portrait and landscape, including
  **21 axe scans**. Tests cover exact/reference results while BSB/model are delayed,
  BSB arriving before the model, real semantic merging, canonical and old URLs,
  multipart physical clocks, soft endpoints, full-recording resume, correction
  context, long text, keyboard interaction and private-text/control exclusion.
- Full-recording links and saved offsets retain full-video playback; selecting a
  chapter establishes its own endpoint. Reload does not snap a saved offset back
  to a chapter start.
- Desktop/mobile search and watch captures inspected together; no overflow or
  layout defect found in this implementation. The new sermon-outline brief's
  information-density concern remains separate work. Mechanical detector returned
  no findings on the two UI files edited during integration. YouTube behavior uses
  deterministic IFrame test adapters; this does not claim a new manual live-video test.
- **53/53 performance budgets passed** on the declared 4× Chromium main-thread CPU
  proxy, Intel i9-9980HK, Chromium 153.0.8010.12, loopback identity networking.
  Real 581-row worst query p95: 14.6ms exact / 20.3ms hybrid. Synthetic 5,000-row
  worst p95: 114.5ms exact / 182.2ms hybrid. Cold model 2,024.9ms; warm cache
  1,811.6ms; warm query inference p95 37.1ms. No external requests.
  Preparation was 1,159.6ms real / 3,697.3ms at 5,000 rows and is reported separately.
  Synthetic duplication is latency stress only, not accuracy/compression evidence.
  Full local report: `.local/performance-chapters.json`.

## Handoff state

No migration commits, signing changes, push, approval, merge or deployment were
performed in this integration pass. The operator's weekly prompt, caption decision
and new sermon-outline brief remain unstaged. Resolve/apply the newer outline brief
before final migration acceptance and the normal separate signed checkpoints.
