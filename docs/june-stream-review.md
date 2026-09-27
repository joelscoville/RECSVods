# 28 June 2026 failed/full-stream case

**Processing complete; editorial status `needs_review`.** One logical service,
two retained physical uploads in source order, **42 sections / 87 passages**, all
on the playable full upload. The earlier local-ASR blocker below was resolved by
the operator-approved, source-verified Colab transcript import. No new inference
was executed during import/curation, locally or remotely. This is an edited
ASR-derived review draft, not a directly listened-to, word-perfect transcript or
human approval. Only this logical case is complete, not all of Milestone 2.

Deliverables: `services/2026/2026-06-28/service.yaml` and this review document.
Earlier failed-attempt measurements are retained below as historical evidence;
the final import, curation and checks are recorded in the completion section.

## Required logical case and verified media

The case contract is **one logical service**, retaining both physical uploads in
source order: **1 — `wh4mCRKRJ-4` (failed), 2 — `k27dmsPvmG8` (full/playable)**.
Normal playback must select the full playable upload; the failed upload must have
no fabricated passages and must be excluded from ordinary search/navigation.
The source service now implements this order. Its preview projection filters out
sequence 1 and defaults to sequence 2, without renumbering or erasing the failed
upload. Both processing states are complete; only the second upload is playable.

Both authorized acquisitions passed the tool's exact channel/ID checks for
`UCLjwcZaIkiFEed1VgQYSsrw` before downloading. Neither used a section selector.

| Upload | Measured evidence | Result |
| --- | --- | --- |
| `wh4mCRKRJ-4` | ffprobe **6.561s**, VP9 video and Opus audio | Expected near-empty rejection, media exit **2**; workspace removed |
| `k27dmsPvmG8` | Metadata **6090s**, ffprobe **6090.161s**; acquired span **0–6090s** | Acquisition and sampling succeeded; recognizable worship, sermon and announcements |

The failed upload's safe ffprobe observation was made before the existing probe
rejected it; the original validator was called unchanged. Exact diagnostic:

```text
media: Near-empty or unusable media (6.561s); audio and video of at least 10s required
```

This reproduces the preflight failure evidence. It is a technically near-empty
upload, **not an access failure**. Duration is measured, not inferred from the
nominal seven-second listing. No transcription was attempted on it. This run did
not inspect its visual content or establish any word-level continuity with the
full upload; the failed/full association and source order are operator-supplied.
No claim of duplicated speech, gap duration or gapless continuation is made.

The full upload's earlier transcription timeout does **not** make its media failed.
Its playable evidence remains distinct from processing, now completed by import.

## Original sampling and boundaries (reused, not rerun)

- Extracted **21 audio windows**, each 30 seconds, at **0, 300, 600, …, 6000s**,
  and a frame at every window start. Reviewed all frames in a contact sheet and
  the same-engine English sample ASR. Total sampled audio: **630s**.
- Opening **0–30s** contains instructions for personal prayer using adoration,
  confession, thanksgiving and supplication. Programme is already underway at
  the physical start; there is no evidenced opening waiting interval to crop.
- The **6000–6030s** sample contains announcements. An additional **6030–6090s**
  ASR window continues the announcements and ends with dismissal and silent
  meditation instructions, with the final detected speech ending at **6089.30s**.
- Proposed programme interval is therefore approximately **0–6089.30s**; the
  selected transcription interval was **0–6090s**, including two-minute margins
  clipped to physical bounds. First/last speech supports that full-range choice.
  Endpoint times are ASR estimates, not directly listened-to timing guarantees.
- The **0s frame** explicitly displays **28th June 2026 9:30am**. The **1800s
  frame** displays **“Teaching us all things…”**, **John 14:25-31** and
  **2 Timothy 3:14-17**, under “Expository Preaching on The Gospel of John.”
  These are slide evidence, not a title or references supplied from model memory.
  No preacher name was verified on a title slide in this attempt; leave speaker
  metadata unassigned until verified. A quotation-attribution slide is not proof
  that its named person is the live preacher.
- Coarse evidence spans opening prayer/worship, scripture reading, music, an
  Ask Me Anything discussion, sermon teaching, closing/pastoral prayer, offering,
  closing hymn and announcements. These observations do not substitute for full
  thought-aligned passage curation or exact section boundaries.
- Sample ASR includes obvious suspect wording and reading/lyric material. No
  sample transcript, sung lyric or verbatim scripture quotation was copied into
  archive content. A resumed interpretation must use explicit omission markers,
  canonical reference-only metadata and attributed claims, without reconstructing
  scripture or unclear words from memory. ESV terms were checked on 2026-09-25 in
  the existing preflight evidence; this attempt stores no verse text.

## Historical local pipeline, provenance and finite limits

All command execution used ordinary non-interactive Bash through
`scripts/devenv-run`, sequentially, with no agent-shell session or concurrent
devenv work. The current operator-confirmed ignored authorization record was
passed explicitly to acquisition, preflight, sampling and each transcription.
No authorization environment flag was set. Raw native output was suppressed;
only safe timing/structural results were returned.

Primary Intel macOS devenv, unchanged tools:

- yt-dlp **2026.08.19**; FFmpeg/ffprobe **8.1.2**.
- whisper.cpp package **1.8.4**; CLI version not exposed, executable SHA-256
  `ca96421296b25286fafcbfa319ad2c749abb9e70f2ed7a719ca45d1a1c0836e3`.
- **English CPU inference**, automatic `--no-gpu`, no translation.
- Model **ggml-large-v3-turbo-q5_0.bin**, **574,041,195 bytes**, SHA-256
  `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`.
- Model revision **5359861c739e955e79d9a303bcbc70fb988958b1**, pinned source:
  <https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin>.
  Cached bytes were rehashed by preflight and transcription; no model download or
  engine/model change. Existing full calibration was reused, not rerun.
- Initial free space **70,760,165,376 bytes**. Current smoke preflight reported
  **70,755,860,480 bytes**, above the minimum.

| Operation | Pipeline elapsed / RTF | Command elapsed | Native / wrapper / Bash-tool limit |
| --- | --- | --- | --- |
| Failed upload, full acquisition | — | **20.769254s** | 900s / 900s / 940000ms |
| Smoke `MZr169xBwrU`, first 60s | **61.267478s / 1.021125** | **104.600075s** | 900s / 900s / 940000ms |
| Full upload acquisition | — | **49.970633s** | 900s / 900s / 940000ms |
| Coarse sample/frame extraction | — | **21.967665s** | 900s / same 900s acquisition wrapper / 940000ms |
| 21 sample ASR windows | **969.317370s / 1.538599** aggregate | **1114.067976s**, sum of stage calls | 1200s / 3000s / 3040000ms |
| Endpoint ASR, 6030–6090s | **115.137954s / 1.918966** | **121.681711s** | 1200s / 900s / 940000ms |
| Full ASR, requested 0–6090s | **No completed pipeline RTF** | **3193.915491s**, then exit 2 | 1200s / 27000s / 27040000ms |

Smoke ffprobe duration was **60.003s**; nested and outer smoke workspaces were
removed. Sample timing is the sum of the separately preserved stage outputs,
not a claimed single wrapper measurement. The temporary helper moved successful
ASR outputs to labelled subdirectories to prevent subsequent windows from
overwriting evidence; all remained inside the sentinel-owned media workspace.

The full-operation limit followed the requested last-full-run RTF calculation:

```text
3 × 1.47 × 6090 + 120 seconds startup allowance = 26976.9 seconds
selected wrapper limit = 27000 seconds
outer Bash-tool wait = 27040000 milliseconds, longer than the wrapper deadline
```

The pipeline uses **600s chunks with 45s overlap**. Planned full-run chunk starts
were **0/555/1110/1665/2220/2775/3330/3885/4440/4995/5550s**: 11 chunks,
**6540s** including overlaps. The historical pipeline RTF already incorporates
overlap overhead. The **1200s per-native limit** was retained as explicitly
requested. Sample/endpoint RTFs were measured separately and are not a completed
full-recording RTF.

Exact full-transcription error:

```text
media: Native tool timed out; bounded runner terminated its process group
```

This was **media exit 2**, not wrapper exit 124: the whole-operation deadline did
not expire. The safe error does not identify the specific native invocation or
chunk; do not infer either from elapsed time. Failure cleanup removed partial
chunks before they could be inspected. Consequently no complete transcript,
seam reconciliation, meaningful passage counts or full-run RTF is claimed.
No recovery or automatic retry followed that blocker in the initial attempt.
The subsequently authorized 2400s-native retry was canceled/superseded by the
operator's supplied-batch plan; no completed transcript from it was used. The
historical CPU model/RTFs above are not provenance for the final imported evidence.

## Initial blocked-attempt checks (historical, before import)

- `pnpm validate:archive`: passed; **2 existing interpreted services**.
- Focused `vitest run tests/archive.test.ts tests/browse.test.ts
  tests/player.test.ts`: **138 passed** across 3 files.
- Read-only projection assertions: **0 production passages / 149 existing preview
  passages**, **0 June services / 0 June passages**. Failed ID `wh4mCRKRJ-4` absent
  from preview passages and projected navigation. This is exclusion by current
  absence, not acceptance of an authored June disposition record.
- **Candidate query / passage ID / start / end: unavailable.** No completed June
  passage exists, so no fabricated candidate or claimed successful June search.
  Default playback and a real full-ID query still require completed curation.
- No embeddings, production/preview build, browser playback, approval, commit or
  run-log edit. The existing two services remain untouched; only this review
  document is delivered from this attempt.
- Confirmed failed, smoke and full owned workspaces all absent after cleanup.
  Raw media, audio, frames, sample/endpoint transcripts and partial full-ASR output
  were removed. The temporary helper was also removed. The separate verified
  model cache and its receipt are retained.
- Final exact-name process check found **no whisper-cli, whisper-cpp, yt-dlp,
  ffmpeg or ffprobe processes**. No private paths, authorization contents or raw
  native output are retained here.

## Completion through the operator-provided transcript

The latest operator decision superseded all CPU retry/VM plans. Followed the
updated shared contract, canonical curator skill, bundle README/checksum manifest
and `docs/transcript-import.md`. Reused the same-run failed-upload, smoke and
21-window sampling evidence; none of those downloads or ASR runs was repeated.
Local whisper.cpp remains the future weekly default, not the engine of this
recording's imported transcript.

### Fresh acquisition and verified import

Only `k27dmsPvmG8` was reacquired, full range, for source verification and frames.
The current authorization record was passed explicitly. Fresh channel/ID checks
passed; metadata **6090s**, actual ffprobe **6090.161s**, exactly matching earlier
source evidence. Acquisition took **70.887005s**; free space was
**67,792,117,760 bytes**. Native versions matched the earlier pinned environment.

Every command in this continuation used ordinary sequential Bash through
`scripts/devenv-run`, **900s wrapper / 940000ms Bash-tool wait**. Media acquisition
and frame extraction had a **900s native limit**. The import and cleanup commands
are offline verification/file operations, not transcription. No preflight,
`media:transcribe`, local model load, Colab execution, remote dispatch or translation
was performed in this continuation. The old 27000/2400s inference limits did not
apply to importing existing evidence.

Portable command forms (all directories are operator-provided external roots):

```sh
scripts/devenv-run python3 scripts/media.py acquire \
  --authorization-file "$AUTHORIZATION_FILE" --youtube-id k27dmsPvmG8 \
  --work-dir "$JUNE_WORK" --timeout 900

scripts/devenv-run python3 scripts/import_transcript.py import \
  --transcript "$TRANSCRIPT_BUNDLE/k27dmsPvmG8.json" \
  --checksums "$TRANSCRIPT_BUNDLE/SHA256SUMS" --work-dir "$JUNE_WORK" \
  --authorization-file "$AUTHORIZATION_FILE" \
  --audio-root "$BATCH_AUDIO_ROOT" --audio-root "$DRIVE_AUDIO_ROOT"

scripts/devenv-run python3 scripts/import_transcript.py cleanup-audio \
  --work-dir "$JUNE_WORK" \
  --audio-root "$BATCH_AUDIO_ROOT" --audio-root "$DRIVE_AUDIO_ROOT"
```

Safe bundle identifier: **operator-colab-backlog-2026-09-25**; relative input
filename **`k27dmsPvmG8.json`**. The raw JSON was retained unchanged outside the
repository. Only the exact receipt `archive_provenance` was copied into
`videos[1].transcription_provenance`; a deep-equality assertion passed. No full
receipt, source-root identity or private path was copied into archive content.

| Imported provenance / verification | Result |
| --- | --- |
| Engine / backend | **faster-whisper 1.2.1 / CTranslate2 4.8.2** |
| Model / compute / device | **large-v3-turbo / float16 / Tesla T4** |
| Settings | **beam 5; word timestamps true; VAD false; condition_on_previous_text false** |
| Original language | **en**, unchanged, no translation |
| Operator-recorded transcription time | **2026-09-25T11:29:41.778506+00:00** |
| Operator-recorded elapsed / RTF | **195.947s / 0.03217**; not a local curation or inference measurement |
| Transcript duration | **6090.1529375s** |
| Actual source duration | **6090.161s** |
| Transcript minus actual source | **−0.008062500000050932s**, within importer’s 2s tolerance |
| Source minus nominal metadata | **+0.161s** |
| Imported span | **0–6090.1529375s**, original physical-upload seconds |
| Source video duration in archive | **6090.161s**, measured ffprobe, so imported span remains inside the video |
| Transcript scan | **1434 segments / 13612 words**, complete |
| Alignment | **15 outside-segment word warnings on 15 segments**, maximum **0.26s** |
| Overlap/backtracking | **0 segment overlaps, 0 word overlaps, 0 backward starts** |
| Zero-duration words / tail clamps | **22 / 0**; no invented duration or timestamp shifting |
| Transcript checksum | **Verified against SHA256SUMS** |
| Original audio checksum | **1 original WebM copy verified; the other root’s copy absent** |
| Channel / video identity / source duration | **Verified** |

Full SHA-256 values:

```text
transcript: e343a678aac1cb1402d9c81d5f65d24b216683bd0d5c149232248bfbd4e1f07f
audio:      bf3df5067418963c4505725dff6c5ab1f98b0eafa95507c573bc87655f9a7faa
```

Audio was verified from the actual supplied original bytes, not from the fresh
video's remuxed/re-encoded audio. The importer checked text/timestamp correspondence
and evidence integrity before issuing the receipt. The reviewed evidence preserves
source order; it was not made to resemble whisper.cpp's local chunk output.

### Metadata, boundaries, gaps and interpretation

Reviewed all 1434 converted evidence lines and their surrounding context. Fresh
frames inspected at **0/60/120/190/260/370/400/435/450/486/790/950/1460/1655/
1705/1750/1800/2000/2300/2770/2900/3135/3540/3750/3960/4300/4310/4425/4720/
4820/5275/5368/5520/5570/5600/5850/5885/5990/6020/6085s**. These supplement the
prior coarse frame/audio evidence, not a rerun of its sample ASR.

- **Date/title/texts:** fresh 0s date; 1705/1750/1800s title and **John 14:25-31;
  2 Timothy 3:14-17**. Displayed sermon title retained as **Teaching us all things…**.
- **Reader:** 1655s slide verifies **Johan Pramono**. The slide says **1 Timothy
  3:14-17**, but his spoken introduction and the sermon slide say **2 Timothy**.
  Authored canonical reference is **2 Timothy 3:14-17**, with the conflicting
  human slide text preserved in review notes. Only the reading passage receives
  his speaker ID; the preceding worship-leader handover is not attributed to him.
- **Preacher:** left unassigned. Spoken/ASR references to “Pastor Yong” and a
  hypothetical fuller-name example do not establish a trusted full-name spelling.
  “Winston” and the announcement contact name likewise remain uncertain. Stephen
  Tong, Jan Hus and Wang Yi are discussed or quoted, not additional live speakers.
- **Ancillary verified slides:** 450s **Psalms 81:1-3**; 950s **Proverbs 27:1-27 /
  John 14:15-31**; 2900s Tong attribution; 3960s **Jan Hus (1369–1415)**;
  4300/4310s Westminster Confession chapter 1, paragraph 5; 4425s humility
  references; 4820s **Rev. Wang Yi, Chengdu Early Rain Covenant Church**; 5600s
  **It Is Well With My Soul**, **Horatio G. Spafford**; 6020/6085s North Sumatra
  events, **28–31 July**. Spelling fixes are source-supported; claims about
  biographies, dates, statistics and historical causation remain attributed.
- **Programme bounds:** preparation already begins at the physical start. Imported
  speech begins at **10.2s**, leaving an explicitly marked opening gap; prior
  sample evidence supports programme from 0s but missing words are not supplied.
  Imported final dismissal ends **6089.28s**, versus prior endpoint **6089.30s**.
  Editorial programme is approximately **0–6089.28s**; the true imported full span
  and final fraction remain recorded, with two-minute margins clipped to bounds.
- **Quiet and music intervals:** 60/120/190/260s frames corroborate A.C.T.S.
  prayer context; the long opening ASR gaps are preserved in playback rather
  than replaced with invented speech. 400/435s show **Introit**, now retained as
  a worship chapter rather than cropped waiting. 486s shows hymn lyrics before
  ASR's 498.5s singing onset. 1460s shows the anthem during a missing-ASR interval.
  1705s is the sermon title transition; 5275/5368s pastoral prayer; 5520/5570s
  offertory; 5850s the closing hymn. These observations support context, not a
  claim of complete silence or recovered words. No direct audio-listening claim.
- **Material ASR gap:** **4301.34–4321.7s**, during the Westminster teaching, is
  explicitly untranscribed. 4310s shows the next quotation slide. Its words were
  not reconstructed from the slide or model memory. No recovery engine was run.
- **Alignment review:** warning source IDs **52/70/114/172/384/720/734/766/812/
  872/879/974/1223/1292/1321** were examined in context. These involve opening
  prayer, music/reading, anthem introduction, seed illustration, subjective-truth
  discussion, bell idiom, absolute-truth conclusion, Hus, scripture evidence,
  John 14 conclusion and pastoral prayer. Offsets up to **0.26s** are retained as
  human timing uncertainty, not used to invent exact word boundaries.

For continuity, checked adjacent review context around the usual 600-second
windows with 45-second overlap. These are **review windows**, not imported engine
chunks or a claim of local midpoint merging:

| Overlapping review span | Continuity decision |
| --- | --- |
| 555–600s | Hymn performance; repetitions are lyrics, omitted from searchable text |
| 1110–1155s | Proverbs ends and John begins at 1130.24s; references kept separately |
| 1665–1710s | Timothy reading followed by title transition; reading omitted |
| 2220–2265s | Choice of moral illustration transitions into the seed analogy; no duplicated bridge |
| 2775–2820s | Holy Spirit recap continues into the Helper’s attributes |
| 3330–3375s | Objective example transitions to subjective judgments at 3330.86s |
| 3885–3930s | Diagram application continues into Jan Hus; trailing transition is explicit |
| 4440–4485s | Humility discussion continues into preconceived attitudes |
| 4995–5040s | John 14 quotation/exposition leads into sermon conclusion; quoted text omitted |
| 5550–5595s | Offertory ends with hymn introduction at 5588.24s; no invented speech in gap |

The source has no segment-overlap duplication requiring a fabricated merge. A
supplemental deterministic check found no uniquely matched eight-word excerpt
located wholly outside its authored passage (1s tolerance); this is a timing
sanity check, not proof of every word. Source passage ranges have **no overlap**.

The **42 sections** cover preparation, introit, worship, readings, AMA, sermon
subtopics, prayers, creed, offertory, hymn, blessing and announcements. The
**87 passages** cover the meaningful programme with completed-thought priority.
**80 are 30–90s**. Exceptions: short call **25.88s**, hymn invitation **26.46s**,
topic transition **26.02s**, personal conviction **29.46s**, blessing **20s**;
intact reference-only readings **196.02s** and **149.66s**. Some short prayer prompts
include explicitly labelled prayer context, never filler speech.

Transcripts are edited ASR-derived **excerpts**, with disfluencies normalized and
omissions declared in brackets. Lyrics, scripture quotations/readings and creed
recitation are omitted explicitly. Scripture is never completed from memory.
Sections without speech passages retain worship playback. Cautious attributed
summaries distinguish the speaker's theology, cultural generalizations, legal/
medical illustrations and historical claims from verified facts. Specific review
items include the **2177–2204s** third-party allegation, the **2611–2631s**
explicitly hypothetical scandal, car-price ASR, the Spafford telegram/story,
Wang Yi family claims, unclear concert/contact names and the approximate
**5497s** prayer-to-offertory cut inside a mixed ASR segment. Remaining uncertainty
is retained under operator-authorized flag-and-continue, not silently repaired.

### Final validation and exact-query candidates

- `pnpm validate:archive`: **passed**, 3 interpreted services.
- `vitest run tests/archive.test.ts tests/browse.test.ts tests/player.test.ts`:
  **159 passed** (123 archive, 14 browse, 22 player).
- `python3 -m unittest discover -s tests -p test_import_transcript.py`:
  **38 passed**; no inference in these tests.
- Read-only source/projection assertions passed: one June service, failed/full
  source sequence **1/2**, both complete, service `needs_review`, no failed-upload
  sections/passages, **0 production / 236 total preview passages**, including
  **87 June preview passages**, all labelled unreviewed.
- Preview navigation and home projection contain only **`k27dmsPvmG8`** for June;
  it retains sequence **2** and is the default playback upload. Failed ID absent
  from ordinary search, navigation and home recommendations. Production excludes
  the service. Provenance hashes and receipt fields are absent from frontend
  allowlist projections.
- Actual lexical search over the entire source preview projection returned:

| Exact query | Passage ID | Video | Start–end (physical seconds) | Rank |
| --- | --- | --- | --- | ---: |
| `Hotel-room prayer requests` | `p0628-hotel-prayer` | `k27dmsPvmG8` | **4178.68–4233.90** | **1** |
| `Self-justification does not change the truth` | `p0628-bell-application` | `k27dmsPvmG8` | **3612.98–3644.34** | **1** |

Both production queries returned no result. These are source-projection/lexical
checks, not new embedding, build or browser-playback acceptance. No approval,
commits, code, package, other logical service or run-log changes by this task.

### Verification-gated audio deletion and final cleanup

Immediately after verified import, while its workspace-bound receipt remained
available, `cleanup-audio` checked both explicitly supplied roots. It reported
**1 deleted audio file / 1 already-absent audio file / 2 checked roots**:

- **Drive audio root:** matching June original WebM hash verified, then deleted.
- **Local batch audio root:** June original WebM already absent, confirmed.

A final receipt-based cleanup recheck reported **0 deleted / 2 already absent /
2 checked roots**, confirming both copies absent before removal of the receipt.
The retained raw June JSON was rehashed and still matched the exact checksum above.

No unrelated recording audio or raw JSON was deleted. The source transcript
bundle remains local and unchanged. The acquired curation video stayed in its
separate sentinel-owned workspace for frame review. After curation and receipt
equality checks, that workspace was removed with the media cleanup operation:
source media, frames/contact sheets, imported evidence and temporary receipt all
removed. Both owned temporary helpers were removed. Safe provenance is retained
in the service and this document; the fixed local-whisper model cache is retained.

Final cleanup verification confirms the owned workspace/helpers absent and no
native media processes remaining. No downloaded media, raw ASR/JSON bundle,
private paths, credentials, source audio, model or ESV verse text is included in
the deliverables. Human editorial review remains pending for the entire service.
