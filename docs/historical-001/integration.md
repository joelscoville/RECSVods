# Historical batch 001 — main-agent integration

## Scope and workflow

The operator approved exactly twelve services in
`docs/implementation-prompts/inputs/historical-batch-001.yaml`. Input SHA-256:
`b58f3f8a69194b86628b20eb73adf66e622f1f04fff52e745afde9072472f6fb`.
The file, entry order and supplied metadata were preserved.

Following the 2026-09-26 concurrency decision, twelve isolated workers each wrote
only their service YAML and review report. Main imported/claimed the manifest,
maintained the run log, reviewed proposals and applied the changes below. Individual
reports describe worker output **before** this merge; their proposal wording does
not imply that main's later accepted metadata is still inactive.

Every service remains `needs_review`. Main's classification decisions are agent
interpretation, not human editorial approval. Transcript excerpts and summaries
were not rewritten in this integration; approved-input, source IDs, timestamps,
speaker evidence and provenance were preserved. Source uncertainty remains open.

## Acquisition staggering and worker outcomes

Starts were allocated in 90-second slots from 2026-09-26T02:43:11Z. Three workers
corrected local helper errors before network acquisition and used their next
reserved cycle rather than bunching downloads. Active adjacent slots remained
approximately one to two minutes apart; unused slots introduce longer gaps.

| Date | Upload | Actual acquisition start (UTC) | Sections | Passages |
| --- | --- | --- | ---: | ---: |
| 2026-08-30 | M9uwSKpB_gk | 02:43:11.002 | 15 | 78 |
| 2026-08-23 | QCNrRkiFeKw | 02:45:07.410 | 22 | 79 |
| 2026-08-09 | gO6gc5jL-jU | 02:46:11.008 | 30 | 83 |
| 2026-08-02 | 1R4gnCvqrOA | 02:47:41.003 | 33 | 82 |
| 2026-07-26 | D7gXD-Mo25s | 03:07:11.016 | 20 | 76 |
| 2026-07-19 | rM0Oi8-Y8G4 | 02:50:41.009 | 32 | 79 |
| 2026-06-21 | dNeZD1HUmmE | 02:52:39.861 | 26 | 79 |
| 2026-06-14 | GlVgMoehT2I | 02:53:41.010 | 19 | 80 |
| 2026-06-07 | 8Qjfp-2L5d8 | 03:13:10.964 | 15 | 82 |
| 2026-05-31 | m51rgcZHQmE | 03:14:40.963 | 16 | 74 |
| 2026-05-24 | uJDdItVGgj8 | 02:58:34.937 | 17 | 78 |
| 2026-05-17 | lrRnxGzvPaM | 02:59:41.013 | 33 | 87 |

Worker-reported batch total: **278 sections / 957 passages**. All workers reported
completed own-file schema/reference/boundary/provenance checks and cleanup, with no
remaining processing blocker. Batch-wide verification is recorded separately below.

## Taxonomy decisions

Main compared the proposal evidence with the cited passage text and existing
vocabulary. Eight focused terms were added to the reuse guide and applied only to
the clearly cited passages below; this is not blanket tagging by keyword. Existing
broader tags remain. The guide is not a runtime alias/rewrite mechanism.

| Added topic | Applied passage IDs | Rationale |
| --- | --- | --- |
| Joy | p20260830-021; p20260823-joy-and-despair | Repeated central teaching, including qualifications about unhappiness and despair. |
| Love | p20260830-046; p20260719-love-framework; p20260531-048; p20260517-love-uttermost | Central, recurring explicit theme across four services. |
| Hope | p20260830-059 | Direct distinction between assurance and wishful thinking. |
| Suffering | p20260830-041; p20260823-health-and-hope | Explicit treatment of tribulation, disappointment and severe health challenges. |
| Sanctification | p20260802-sanctification | Explicitly named and defined lifelong-growth concept, not a new doctrinal conclusion. |
| Persecution | p20260726-047; p20260726-050 | The preacher's labelled account of severe/subtle opposition; attributed claims remain unverified. |
| Trinity | p20260621-trinity-mystery | Direct discussion of the named concept and limits of human expression. |
| Salvation | p20260607-only-introduction | The sermon explicitly introduces salvation and exclusivity as its subject. |

Deferred proposals remain in worker notes:
- **Citizenship:** existing government, responsibility and discipleship cover the
  cited material for now.
- **Common grace:** retain source wording/searchability; avoid adding this narrower
  single-service classification without broader editorial agreement.
- **Obedience:** existing authority, discipleship and responsibility remain sufficient.
- **Servant leadership:** existing service and discipleship retain coverage.

Main normalized eleven source-supported series proposals to:
`gospel-of-john` — **Expository Preaching on the Gospel of John**. The original
caption wording and frame evidence remain in each worker report. August 9's topical
citizenship sermon was deliberately **not** assigned that series from a conflicting
header. Earlier M1–M3 service classifications were not changed.

New records consistently use `service-life: Church life` and
`communion: Holy Communion`. The earlier `church-life` ID and shorter Communion
label are documented legacy variants; they were not silently rewritten.
Full and partial preacher names remain distinct where evidence differs. Derrick
Zou's new local definition is supported by a caption; uncertain names remain noted.

## Editorial limitations and cleanup

These are edited ASR-derived excerpts with explicit omissions, not complete verbatim
transcripts or audio-listening certificates. Human review must inspect omitted
context, scripture/lyric boundaries, uncertain names, translated/code-switched terms,
longer coherent units and attributed historical/medical/political/doctrinal claims.
Worker reports contain the specific recording/timestamp priorities.

All twelve used the supplied operator-run faster-whisper batch; no new ASR ran.
Raw JSON checksums, source identity/duration and converted evidence were checked.
All twelve original audio targets were already absent in both designated roots:
**zero original-audio deletions**, with `audio_hash_verified: false` retained.
Workers removed their acquired media, samples, frames, imported evidence/receipts
and helpers. Raw transcript JSON, shared model cache and unrelated audio were kept.

## Batch-wide verification

Global source/manifest validation passed after main's merge: 22 services, 25 uploads,
582 sections, 1,646 authored passages, 1,645 preview passages and zero production
passages. The twelve batch jobs are complete; their source interpretation is still
needs_review. Full tooling acceptance is intentionally paused by the operator's
chapter-search decision until the current content checkpoint is committed and the
new chapter-only model is applied. See the run log for measured pre-migration sizes
and the explicitly incomplete passage-oriented search/performance results.
