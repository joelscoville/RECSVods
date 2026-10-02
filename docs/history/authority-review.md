# Authority — completed curation for human review

**2026-09-25: 32 sections / 63 passages; workflow complete, editorial needs_review.**
Only `services/2020/2020-09-27/service.yaml` and this report are owned by this run.
No other case, application code, shared run log, operator manifest or Git commit
was changed by this curation.

## Trusted metadata and scope

- **Authority**, **27 September 2020**, **Rev. Yong Teck Meng**.
- Trusted references: [Luke 20:19-26 (ESV)](https://www.esv.org/Luke+20:19-26/)
  and [Romans 13:1-7 (ESV)](https://www.esv.org/Romans+13:1-7/).
- Single physical upload: `W2IZ6MUX-Yk`, verified channel
  `UCLjwcZaIkiFEed1VgQYSsrw`, sequence 1, playable.
- Sermon-focused recording with greeting, convention announcements, recap,
  exposition and prayers. Earlier service readings are mentioned, but are not
  present in this upload; no worship sections or readings were invented.
- Title and both main references are legible at 0/10/40s. No preacher-name/date
  caption was observed; name and date remain trusted operator metadata, not an
  identification from facial appearance. The inspected frames show one presenter
  throughout. No contradictory title or main reference was observed.
- Historical-batch rows in the updated external README were read as context only;
  they did not expand the processing scope.

## Original-audio limitation resolved as an explicit exception

The first attempt stopped after finding both designated audio roots empty.
The operator then explicitly authorized the documented `--allow-missing-audio`
path. The updated bundle README records prior deletion of the originals, and the
shared import/run-log guidance permits this exception.

Both `$BATCH_AUDIO_ROOT` and `$DRIVE_AUDIO_ROOT` were supplied to the importer.
**Verified original-audio copies: 0; `audio_hash_verified: false`.** The declared
audio SHA-256 below is supplied provenance, not a fresh match against original
bytes. Fresh video acquisition establishes identity, measured duration and visual
evidence; it does not recreate an original-audio hash verification. No missing
audio was synthesized, reconstructed or retranscribed.

## Acquisition and import evidence

All project/native operations used ordinary sequential `scripts/devenv-run`
commands, with **900s outer bounds**, **900s per-native media bounds**, and a
940000ms terminal wait. No agent-shell, VM, CPU recovery or inference ran.
Applicable existing toolchain preflight evidence was reused without invoking its
ASR smoke step. The media tool enforced free-space, authorization and ownership
checks before acquisition. A fresh distinct sentinel-owned external work root
held only this case’s evidence; a helper installed signal/failure cleanup before
acquisition. The authorization record passed Git ignore checks.

Commands, with private paths replaced by placeholders:

```sh
scripts/devenv-run python3 scripts/media.py acquire \
  --youtube-id W2IZ6MUX-Yk --work-dir "$WORK" \
  --authorization-file "$AUTHORIZATION_FILE" --timeout 900

scripts/devenv-run python3 scripts/import_transcript.py import \
  --transcript "$TRANSCRIPT_BUNDLE/W2IZ6MUX-Yk.json" \
  --checksums "$TRANSCRIPT_BUNDLE/SHA256SUMS" --work-dir "$WORK" \
  --authorization-file "$AUTHORIZATION_FILE" \
  --audio-root "$BATCH_AUDIO_ROOT" --audio-root "$DRIVE_AUDIO_ROOT" \
  --allow-missing-audio

scripts/devenv-run python3 scripts/media.py sample \
  --youtube-id W2IZ6MUX-Yk --work-dir "$WORK" \
  --authorization-file "$AUTHORIZATION_FILE" --timeout 900
```

Native versions: yt-dlp **2026.08.19**, FFmpeg **8.1.2**, ffprobe **8.1.2**.
The acquisition tool also checked whisper CLI version/help only; no transcription
was requested. The existing CLI fingerprint matched preflight evidence. No model
cache was used for inference or changed.

| Verification | Result |
| --- | --- |
| Channel and physical ID | Exact RECS channel and `W2IZ6MUX-Yk` verified before download |
| Full source metadata duration | 3907.0s |
| Acquisition ffprobe duration | **3906.841s**; audio and video streams accepted |
| Independent repeat ffprobe | **3906.841s** |
| Acquired span | 0–3906.841s; no section selector |
| Transcript duration / imported full span | **3906.8154375s** / 0–3906.8154375s |
| Transcript minus actual source | **−0.025562499999978172s**, within 2s limit |
| Source minus metadata | −0.1590000000001055s |
| Transcript byte SHA-256 | Passed against supplied `SHA256SUMS`; rehashed again during final validation |
| Recipe, language, date, numeric bounds and RTF consistency | Passed; original language `en` |
| Full scan | **696 segments / 11,344 words** |
| Converted correspondence | Every segment text and absolute start/end equals supplied JSON; source order retained |
| Tail clamping / zero-duration segments | 0 / 0 |
| Zero-duration words | 5 retained, not expanded |
| Alignment warnings | 10 outside-segment words on 10 segments; maximum 0.19s |
| Segment overlap / backward starts | None |
| Original source-audio hash | Not independently verified; both copies absent |

Warning segment IDs: **95, 96, 251, 435, 493, 508, 574, 588, 631, 680**.
The maximum warning is 0.19s on segment 680. Warnings were not converted into
invented timing repairs. Passage boundaries are editorial thought boundaries,
not a claim that ASR word alignment has been listening-verified.

### Exact safe per-recording provenance

Import source: **operator-provided RECS Replay transcripts, 2026-09-25**, relative
filename `W2IZ6MUX-Yk.json`. The following is the complete safe
`receipt.archive_provenance` projection, copied into
`videos[0].transcription_provenance` and checked for parsed-object equality:

```yaml
engine: faster-whisper
engine_version: 1.2.1
model: large-v3-turbo
backend_version: 4.8.2
compute_type: float16
device: Tesla T4
settings:
  beam_size: 5
  word_timestamps: true
  vad_filter: false
  condition_on_previous_text: false
audio_sha256: 54ea3e82512cd92b57f5e50fccf089a464178586d9dc99113059964cb927984f
duration_seconds: 3906.8154375
elapsed_seconds: 128.254
real_time_factor: 0.03283
transcribed_at: '2026-09-25T11:23:33.536446+00:00'
transcript_sha256: ee87fa6fcb0336b7fc40f17d0ed2047b598df66f1013b9fd941f8154b5ffa97c
source_duration_seconds: 3906.841
duration_delta_seconds: -0.025562499999978172
audio_hash_verified: false
```

**128.254s / RTF 0.03283 describe the operator’s earlier GPU transcription**, not
local curation time. Neither local whisper chunk provenance nor a locally verified
source-audio checksum is claimed. Private receipt root identities and sentinel
tokens are not copied into the repository.

## Programme, frames and editorial decisions

All 696 converted transcript lines were read from beginning to end with adjacent
overlap retained during review. The programme’s successive movements were traced
through the greeting/announcements, prior-lesson recap, political comparisons,
Luke exposition, Romans exposition, political engagement, institutional boundaries,
conclusion and prayers. All 63 passages have positive contiguous ranges, from 0
through the imported span end; there are no invented gap passages. Passages range
from about 30 to 94 seconds, with the 93.7s public-services passage deliberately
keeping the example and its tax conclusion together. Chapters group these smaller
thought units into 32 navigable programme movements.

The existing sample CLI produced **14 audio windows and 14 frames**, at 0, 300,
600, …, 3900s. Windows are 30s except the last, 3900–3906.841s. All coarse frames
were inspected. Additional frames were extracted and inspected at **10, 40, 400,
725, 765, 1575, 2570, 2800, 3400, 3500, 3650, 3790, 3820, 3870, 3905.9s**.

**Audio windows were extracted but not listened to.** No claims of acoustic
intelligibility, exact word correction by ear, or listening-confirmed silence are
made. Technical playability is supported by successful audio/video decoding,
frames and matching imported content. Human listening remains an editorial check.

| Boundary / content | Evidence and decision |
| --- | --- |
| Programme start 0s | First ASR segment is the Sunday greeting; 0/10/40s frames show the sermon title and both references. No waiting period cropped. |
| Announcements 41.22–276.4s | Convention, next-Sunday arrangements and online support; dated context retained rather than turned into current instructions. |
| Recap 276.4–721.58s | 300/400/600s slides corroborate prior-lesson title, authority and stewardship. |
| Prayer 721.58–768.72s | Prayer text and 725/765s frames; mixed-segment transition is approximate. |
| Political comparisons | 900s regional illustration, 1200s liberation-theology slide, 1500s John MacArthur slide and 1575s anarchist-slogan slide match the imported discussion. |
| Luke and Matthew exposition | 1800s weeds-parable slide; 2100/2800s Luke 20 slides corroborate the tribute/fairness discussion. |
| Romans 13 | 2400s Romans 13 / 1 Corinthians 14:33 slide and 2570s Romans 13:5-6 slide corroborate public order and conscience. |
| Kuyper | 2700s political-engagement image; 3400/3500s slides verify Abraham Kuyper spelling and the displayed attribution. |
| Bonhoeffer | 3600s biography slide verifies name; 3650s displayed quotation is an attribution, not independent authorship evidence. |
| Conclusion 3658.5–3820.34s | 3790s summary slide confirms order, fairness, highest allegiance and wisdom. |
| Closing prayer 3820.34–3906s | 3820s prayer posture/Alive in Him slide; last ASR endpoint 3906s. Imported tail retained through 3906.8154375s. |
| Creed-slide discrepancy | 3870/3900/3905.9s frames show Apostles’ Creed while transcript remains prayer. Do not invent a creed recitation or a service section after the physical end. |

Editorial programme is approximately **0–3906s**, within a 3906.841s upload. The
already-approved full-recording transcript retains its actual full span; customary
two-minute context margins clip to available media. It is not relabeled as a
locally trimmed or chunk-transcribed recording.

### Remaining human-review issues

- Transcripts are explicitly **edited ASR-derived excerpts**, not full verbatim
  or listening-verified text. Deliberate omissions are visible in brackets.
  Uncertain colloquialisms, foreign-language phrases, names and repeated
  weed/wheat confusion are flagged rather than reconstructed.
- Speaker/date are operator-attributed. The sermon title and main references are
  visually corroborated. Earlier readers mentioned by name are not added as
  speakers in this upload; hypothetical titles do not change the preacher’s name.
- The 400s slide and ASR label a Psalm quotation **18:27**; possible reference
  discrepancy remains flagged rather than silently replaced. A garbled Timothy
  reference has no invented chapter/verse. Coin-person descriptions, political
  history, biography, institutional allegations and Facebook reports are not
  fact-checked by this curation.
- Claims attributed to Mark Twain, Abraham Kuyper and Dietrich Bonhoeffer are not
  authenticated quotations. Their longer wording is omitted, not reconstructed.
- Both the mask-refusal hypothetical **and its explicit disclaimer** stay in
  one passage. The general civil-obedience teaching is linked to the later
  qualifications about grave evil and wisdom; no unconditional rule is invented.
- Scripture readings/quotations and song lyrics are omitted with markers.
  ESV terms were rechecked at <https://www.esv.org/api/> on **2026-09-25**;
  documented storage/rate limits were unchanged. Display stays reference-only,
  with ESV links. Existing sourced BSB enrichment is hidden search input only.
- Agent workflow is complete under the operator’s flag-and-continue instruction.
  All interpretation remains **needs_review**; human listening and editorial
  approval have not occurred.

## Validation and search candidates

Sequential bounded checks passed:

- `pnpm validate:archive`: **4 valid interpreted services**.
- Focused Vitest archive/search/scripture/browse/player suites:
  **221 passed, 3 opt-in tests skipped**. No real-model inference was invoked.
- Importer unittest suite: **38 passed**.
- Case-specific deterministic checks: trusted metadata; exact provenance projection;
  unchanged raw transcript hash; continuous section/passage coverage; original
  video/time/speaker preservation; ESV URL generation; production exclusion and
  preview labeling; no provenance/private paths/model metadata in client projections.
- Final private-evidence file hashes still matched the receipt before cleanup.
  Source/private-data and selected scripture/creed quotation scans passed alongside
  manual omission review. Maximum gap between imported segments was **5.8s**;
  there were no 30–60s ASR gaps requiring a conjectured missing-speech section.
- **Production projection: 0 passages. Preview projection: 299 passages total,
  including all 63 Authority passages, each preview-labelled.**
- Schema validation initially caught two unquoted commas in flow-style chapter
  titles; corrected. A temporary test helper initially used CommonJS output and
  was switched to `.mts` for existing ESM imports. Neither issue required app code
  changes. Subsequent checks passed.

Deterministic queries used the existing `search()` function over the entire current
preview projection with normal BSB enrichment, not a case-only subset. No ranking
code or acceptance-query question was added to content. Results:

| Query | Authority result / rank | Original-upload seconds |
| --- | --- | --- |
| `Romans 13` | **1: `p0927-romans-government`** | **2284.22–2358.42** (38:04.22–39:18.42) |
| `Rom 13` | **1: `p0927-romans-government`** | Same |
| `Yong Teck Meng` | **1: `p0927-welcome`**; government exposition also top three | 0–41.22 |
| `Rev. Yong Teck Meng` | Same speaker results | Same |
| `How should Christians relate to government?` | **1: `p0927-romans-government`** | **2284.22–2358.42** |
| Same government query | **2: `p0927-government-allegiance`** | **3658.5–3726.04** (60:58.50–62:06.04) |
| Same government query | **3: `p0927-public-services`** | **2190.52–2284.22** (36:30.52–38:04.22) |

All candidate IDs point to **`W2IZ6MUX-Yk`**, not a fabricated combined timeline.
Useful qualifying continuation: **`p0927-qualified-action`, 3726.04–3787.16s**;
institutional caution: **`p0927-institutional-distance`, 3497.22–3544s**.

These are **deterministic lexical/reference/BSB results**, not a claim that semantic
inference or browser playback was exercised. Main-run semantic top-three acceptance
and integrated browser/build checks remain for the eventual Milestone 2 gate.
No build or generated index was rewritten during this scope, since normal nonempty
builds invoke embeddings. The no-inference instruction was preserved.

## Cleanup

Safe provenance and review evidence were retained above and in the service file
before cleanup. **The sentinel-validated cleanup operation removed the complete
owned workspace**, including acquired `source.mkv`, 14 audio samples, 29 frames,
manifests, converted evidence and private receipt. Both temporary evidence/check
helpers were removed too. The external parent was rechecked after removal.

Both batch roots were rechecked empty: **zero batch-audio files deleted**.
`cleanup-audio` was deliberately not run because `audio_hash_verified` is false.
The original raw JSON, checksum manifest, operator README and existing model
cache remain. Raw JSON SHA-256 was reverified before cleanup. No background
media task or transcription was launched; all native calls returned within their
finite bounds. No commit, editorial approval or deployment was performed.
