# First recording review — ZTDYIJUDb0M

## Operator disposition after recovery

On 2026-09-25, after the single targeted recovery pass, the operator selected
**“Flag it and continue”** for the remaining 251.08–318.34s uncertainty. Service
and video workflow are therefore `complete` (agent processing finished), while
editorial status remains `needs_review`. This supersedes the earlier processing
status below, not the evidence or uncertainty. Human listening is still required
for that interval before editorial approval; no complete-verbatim claim is made.

## Result and status

Scope: **only RECS 6 September 2026**, physical upload `ZTDYIJUDb0M`, logical
service `2026-09-06`. No other service was interpreted. Review date: 2026-09-25.

The existing full transcription completed successfully without a restart or
interruption. After one targeted recovery pass, the archive draft contains
**22 sections and 77 passages** (five added), including
**46 sermon passages** spanning the introduction, review, exposition, illustrations
and conclusion. Two additional passages hold the prayer before exposition and the
sermon's closing prayer. All passage transcripts are inline, passage-specific text
in `services/2026/2026-09-06/service.yaml`.

**Editorial status: `needs_review`. Service and video workflow: `in_progress`.**
Media disposition: `playable`. The recovery repaired the opening, Communion and
pastoral-prayer gaps. **One unresolved coverage issue remains:** the collective
prayer excerpt begins mid-thought at 318.34s, while the preceding original ASR
repeats the supplication prompt. Listen to 251.08–318.34s, particularly the final
approximately 20 seconds, to establish whether spoken prayer is missing and its
actual onset/wording. That interval was outside the requested recovery windows.
Frames alone do not settle it. Full spoken-programme curation is therefore still
**not complete**, and no second recovery/retry was attempted.

No editorial approval, Git commit or delivery was performed. This scoped task did
not update registration provenance, the run log, scripts or application files.
The main implementation owner retains responsibility for its run-log update and
workspace cleanup. The operator reports that the pre-recovery **72-passage preview,
zero-passage production builds and 12 E2E tests passed**. This pass did not modify
those generated builds; their reported success does not certify the five newly
added passages.

## Processing evidence

| Measurement | Result |
| --- | --- |
| Verified source channel | `UCLjwcZaIkiFEed1VgQYSsrw` |
| Source duration / acquired absolute span | 6759 seconds / 0–6759 seconds |
| ffprobe container duration | 6759.281 seconds |
| Chosen programme / requested transcription | 0–6759 / 0–6759 seconds |
| Coarse samples | 23 windows, 30 seconds each, starts 0, 300, …, 6600 |
| Pipeline elapsed | 4808.914255949 seconds (80m 08.91s) |
| Pipeline real-time factor | **0.7114830974920846** = elapsed / 6759 |
| Prior overlap-adjusted expected time | 4407.715273 seconds |
| Finite bounds | 1200 seconds per native call; 13260 seconds whole operation |
| Engine | whisper.cpp, pinned environment package 1.8.4 |
| Language / inference | English, original speech, `--no-gpu` on Intel macOS |
| Chunks | 13; 600-second windows, 555-second advance, 45-second overlap |
| Processed audio including overlaps | 7299 seconds |

The result was collected with one `agent-shell wait recs-baseline -t 900` call
(outer shell-tool timeout 920000 ms) after reading the existing session. The
agent-shell version-mismatch notice did not trigger a session restart. The actual
pipeline was about 9.1% slower than the calibrated expectation but remained well
within its finite bound. RTF is pipeline time, not editorial labour or total
acquisition-plus-review time. No inference option or model revision was changed.

Model: `ggml-large-v3-turbo-q5_0.bin`, `ggerganov/whisper.cpp`, revision
`5359861c739e955e79d9a303bcbc70fb988958b1`, 574041195 bytes, SHA-256
`394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`.
Pinned source:
`https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin`.
Executable SHA-256:
`ca96421296b25286fafcbfa319ad2c749abb9e70f2ed7a719ca45d1a1c0836e3`.
FFmpeg/ffprobe 8.1.2, yt-dlp 2026.08.19. These match the inherited preflight
evidence. Authorization was confirmed for this ongoing run; no private grant data
is reproduced here.

The complete merged `evidence.txt` was inspected, together with metadata and
raw overlapping chunk segments. All 23 coarse frames were inspected. Additional
single frames were captured with bounded FFmpeg inside `scripts/devenv-run` at
720, 780, 1080, 1125, 1900, 1920, 1940, 2850, 3080, 3425, 3460, 4260, 4880,
4950, 5500, 5555, 6340 and 6750 seconds. The two batches had finite whole-operation
bounds of 180 and 90 seconds. These are external operational evidence, not archive
assets. No direct audio-listening verification is claimed for this curation pass;
word and phrase accuracy still requires listening, especially where ASR is weak.

## Identity, boundaries and reference evidence

- **0 seconds:** service/date slide, 6 September 2026 at 9:30am, with leader at
  pulpit. The separately inspected opening 0–30s sample established preparation
  for worship and Holy Communion. Recovery now restores the lost opening. Keep
  the programme start at zero; do not substitute a later welcome for its beginning.
- **300 seconds:** A.C.T.S. slide expands adoration, confession, thanksgiving and
  supplication. Quiet prayer is legitimate programme, not setup to trim away.
- **706.24 seconds:** spoken introduction to Holy Communion. Frame 720s is an
  empty pulpit; 780s shows minister at the table; 900s shows **1 Corinthians
  11:23-26**; 1125s shows the cup. The slide's translation differs from ESV, so it
  is not labelled a verified ESV reading. All its verse text is omitted anyway.
- **1200 seconds:** responsive-reading slide explicitly gives **Proverbs 6:1-35;
  John 17:1-19**. Frame 1500s labels the reading English Standard Version 2016.
- **459.96s / 1584.16–1612.96s:** spoken references support **Psalms 98:1-3** and
  **Psalms 27:4**, respectively.
- **1900 seconds:** reader and **1 John 5:12**, labelled ESV. **1920 and 1940
  seconds:** sermon title **Eternal Life**, **John 17:1-5**, **1 John 5:10-12**.
  The service title retains this displayed human title. **2100 seconds:**
  *Overcoming*, **John 16:25-33**, is explicitly the previous session.
- **3000 seconds:** High Priestly Prayer slide with John MacArthur attribution.
  **3080:** Hebrews 7:25. **3425:** John 16:33. **3460:** John 17:1.
  **3900:** Psalms 19:1. **4260:** John 17:2. **4800:** John 17:3.
  **4880:** displayed transliteration `ginóskó`. **4950:** Luke 1:34.
  **5100 and 5400:** J. I. Packer, resolving ASR “Parker”. **5500:** John 17:4-5.
  **5555:** 1 John 5, corroborating the return to the earlier scripture reading.
- **6302.16 seconds:** blessing announced from **Hebrews 13**. Frame 6340s
  supplies no verse range; retain the chapter rather than infer numbers.
- **6600 seconds:** Personal Financial Stewardship, Paul Rafiuly, 26 September
  2026, 1.30 pm, Alexcier #03-11. Name spelling is slide-supported. Those visual
  event details are not inserted as if spoken in the passage transcript.
- **6750 seconds:** minister and event slide remain visible. Dismissal ends about
  6754.96s, with only 4.04 seconds left. Keep the endpoint at the acquired 6759s
  bound, including terminal meditation. Two-minute margins are clipped at both
  recording ends; no additional upload or fabricated common clock is involved.

No displayed/trusted full speaker name was located. The spoken introductions
sound like Pastor Yong, Patrick and Brother Joseph; these remain review leads.
No speaker records are assigned. Topics are service-local descriptive labels
drawn from this recording, not a new global theological taxonomy.

## Transcript treatment, gaps and priorities

This is a lightly edited **ASR-derived draft**, not a certified verbatim transcript.
Capitalization, punctuation, numerical formatting and some clear grammatical
surface errors are normalized. Bracketed uncertainty is intentional and should
not be replaced by plausible guesses. Dialogue punctuation, a few familiar-name
spellings and apparent minor word corrections remain provisional; a reviewer
should compare the underlying recording. Confidence expresses evidence quality,
not correctness of doctrine or independent truth of anecdotes.

1. **Opening restored; pre-318.34s prayer lead-in unresolved:** recovery supplies
   0–29s and corroborates confession at 85–107.4s. Repetitive quiet-interval
   artifacts are excluded. The original lead-in to the excerpt beginning
   318.34s remains unresolved outside the targeted recovery scope; it is the
   remaining coverage concern requiring human listening, not a claimed silence.
2. **Communion recovered:** the original repeated introduction is superseded by
   six smaller recovery windows, not overwritten. Four new passages cover the
   minister's explanation, liturgy/reading, invitation and thanksgiving/participation.
   Frames and recovery show a Communion hymn between invitation and thanksgiving;
   this is an intentional lyric omission, not missing sermon speech. Exact
   greeting and post-hymn invitation onsets still need refinement within broad
   ASR segments. No familiar liturgical words were inserted from memory.
3. **Creed 5727.14–5763.62s:** recovery omits the first half, but frames at
   5735/5755s corroborate both displayed portions and resolve the earlier material
   ASR errors. Per instruction, all creed text remains intentionally omitted;
   the passage retains the invitation and a recitation marker.
4. **Pastoral prayer recovered:** new passage 5940–6012.76s contains the invitation
   and substantive prayer beginning about 5964.02s. The two overlapping recovery
   windows agree at the seam. Exact invitation onset within 5940–5964.02s remains
   coarse; that duration is not presented as continuous speech.
5. **Offertory 6027.62–6135s:** no reliable continuous speech transcript. Raw
   chunk 0011 starts with unrelated hallucinated text at 6105–6134.98s, excluded.
6. **Sermon uncertainty:** review proper names, brief Chinese/Hokkien phrases,
   `Four/false Spiritual Laws`, the first pastor's name and bombing locations,
   original-language terminology, and prayer words that ASR reverses or drops.
   Statistics, historical assertions, medical anecdotes and comparisons between
   churches remain attributed to the preacher; no theological conclusions or
   external identity guesses were added.
7. **Editorial omissions, not processing failures:** all sung lyrics, creed and
   liturgical recitations; full ESV readings and quotations; quiet music; the 1697.92–1709.92s anthem introduction
   (announces a reader and video anthem); individual teacher call-outs at
   6630.18–6696.64s. These intervals remain in chapter playback. The closing
   teacher prayer and substantive announcements have their own passages.

ESV API terms were re-read at `https://www.esv.org/api/` on **2026-09-25**. The
published storage ceiling (500 verses or half a book, whichever is less) and stated
rate limits still match the shared contract. This draft uses reference-only ESV
links and stores no intentional verse quotations. The reference-only rule is also
applied conservatively to other displayed translations and unannounced biblical
allusions. An uncertain reference is marked uncertain, not reconstructed. Hymn
lyrics are omitted regardless of possible public-domain status of older words or
copyright status of a performed arrangement. Spoken commentary is retained with
omission markers distinguishing it from a continuous verbatim transcript.

### Overlap decisions

Raw chunk offsets are milliseconds converted to seconds plus `index × 555`.
Adjacent versions can differ in timing and wording; retaining one coherent
version does not establish sample-accurate audio alignment.

| Absolute area | Evidence and decision |
| --- | --- |
| 555–600 | Chunks 0000/0001 overlap in opening hymn; lyrics excluded, no searchable seam text. |
| 1110–1155 | Original chunk 0001 repetitive failure conflicts with 0002; targeted recovery now supplies participation through 1118.5s. Original prayer from 1140s retained. |
| 1665–1710 | Chunk 0002/0003 hymn-to-anthem context; lyrics excluded, chapter retains transition. |
| 2220–2265 | Chunks 0003/0004 duplicate the early-Christians phrase. Kept once; sentence boundary uses 2244.2s from raw 0003. “Closest” is supported by raw 0003 where 0004 misrecognizes it. |
| 2775–2820 | Raw 0005 opening agrees with preceding context of disciples' limited understanding. |
| 3330–3375 | Raw 0006 supports Billy Graham illustration and transition to daily prayer; no duplicated sentence retained. |
| 3885–3930 | Raw 0006/0007 repeat “original state of glory”; retained once, followed by cross explanation. |
| 4440–4485 | Raw 0007/0008 duplicate great-leader sentence and differ on the adjective before organizations. Duplicate removed, uncertain adjective marked; 0008 supports “everything is gone”. |
| 4995–5040 | Raw 0008/0009 recover the transition “One of them” before Packer, lost by midpoint ownership. |
| 5550–5595 | Raw 0009 loses a clause in the scripture quotation; raw 0010 contains the intact sequence. Quotation remains omitted. Subsequent commentary starts at 5565.06s using raw 0010. |
| 6105–6150 | Offertory hallucination excluded; closing-hymn introduction uses 0011 at 6135s. |
| 6660–6705 | Individual teacher call-outs excluded from search; prayer starts 6696.64s in 0012, supported by end of 0011. |

## One bounded targeted recovery pass — 2026-09-25

The operator explicitly authorized one targeted recovery using the same engine,
model, original English language and Intel CPU inference. No download, model
change, engine change, retry loop or full transcription restart occurred.

Execution used `RECS_DEVENV_TIMEOUT_SECONDS=1800 scripts/devenv-run python3 -c …`
with the existing media module's bounded native-command helper. Every FFmpeg and
whisper call had a **positive 300-second limit**. The helper suppresses raw native
output and terminates the native process group on timeout/error. Ownership and
authorization were checked, the model was rehashed, and the executable fingerprint
was checked against the original run. No source script was edited.

Each extraction used 16 kHz mono PCM with FFmpeg `-ss START -t DURATION`.
Each inference used the existing whisper executable with:
`--no-gpu --model MODEL --language en --file recovery-START-END.wav
--output-json --output-txt --output-file recovery-START-END`.
Output paths were checked absent before starting. Native outputs remain only in
the owned external workspace. No Python-authored transcript file was generated.

**Timestamp rule:** each recovery JSON/TXT has local audio timing. Absolute
original-video seconds = the START encoded in its filename + JSON millisecond
offset / 1000. The END encoded in its filename is the requested absolute bound,
not an ASR-inferred duration. Discard hallucinated output beyond that bound.
The old full-run 555-second chunk formula does **not** apply to recovery files.

| Recovery stem | Absolute span | Extraction s | Inference s | Total s |
| --- | --- | ---: | ---: | ---: |
| recovery-0000-0065 | 0–65 | 0.391 | 43.507 | 43.898 |
| recovery-0055-0120 | 55–120 | 0.445 | 42.331 | 42.776 |
| recovery-0706-0796 | 706–796 | 0.500 | 64.148 | 64.648 |
| recovery-0786-0876 | 786–876 | 0.706 | 73.953 | 74.659 |
| recovery-0866-0956 | 866–956 | 0.552 | 75.418 | 75.970 |
| recovery-0946-1036 | 946–1036 | 0.659 | 71.252 | 71.911 |
| recovery-1026-1116 | 1026–1116 | 0.596 | 58.096 | 58.691 |
| recovery-1106-1135 | 1106–1135 | 0.236 | 14.429 | 14.665 |
| recovery-5718-5770 | 5718–5770 | 0.339 | 31.114 | 31.453 |
| recovery-5910-5980 | 5910–5980 | 0.343 | 37.188 | 37.531 |
| recovery-5970-6013 | 5970–6013 | 0.286 | 30.763 | 31.049 |

All **11 windows succeeded**, no native timeout or failure. Pipeline elapsed
**547.254628335 seconds** (9m 07.25s); whole Python operation including verification
and integrity checks **552.647228262 seconds** (9m 12.65s), excluding devenv startup.
Unique requested audio: **704 seconds**; processed audio with overlaps:
**774 seconds**. RTF against unique audio: **0.7773503243**; against processed
audio: **0.7070473234**. These measurements are for this recovery only, not a new
full-service calibration. Longest inference: **75.418 seconds**, below 300.

Before/after SHA-256 assertions confirmed that original `evidence.json`,
`evidence.txt`, `manifest.json` and all **26 original chunk WAV/JSON files** were
unchanged. No main generated build/index output was written. Existing shell
session, owned workspace and model cache were retained.

For visual corroboration, one separate bounded frame-inspection batch (180-second
outer limit; 300-second native limit) captured `recovery-frame-SSSS.jpg` at
85, 300, 315, 745, 825, 850, 925, 940, 990, 1045, 1060, 1085, 5735, 5755, 5945,
and 5965 seconds. All 17 were inspected. The 1085s frame is a dark transition
and establishes no speaker identity. Other frames confirm the Lord's Prayer,
1 Corinthians 11:23-26, Communion hymn, two creed slides and Pastoral Prayer.

Recovery is still ASR, not direct audio-listening verification. Specific decisions:

- Restored opening from 0–29s. A spurious segment extending to 89.98s from the
  65-second first window was rejected, as were isolated quiet-interval artifacts.
- Joined Communion explanation across 786–796s once. The small-c/big-C wording
  remains uncertain rather than being repaired into familiar doctrine.
- Scripture reading occupies approximately 869.6–905.06s; both overlapping
  recognitions and the displayed reference support one reference-only omission.
- Repetitions of the hymn announcement after 930.96s were excluded. Recovery
  946–1036s recognizes singing and frames 940/990/1045/1060s show hymn lyrics.
- The invitation's first segment is 1050.94–1075.74s; frame 1060s still shows
  hymn text. Its passage explicitly includes the end of music, with exact spoken
  onset flagged. Prayer begins around 1083.88s; participation around 1104.88s.
- Participation overlaps at 1106–1116s; retained once using the complete final
  window through 1118.5s, not the old coarse 1130.4s endpoint.
- Pastoral-prayer overlap at 5970–5980s agrees in wording. Joined after the
  shared reminder at about 5976.45s. No repeated seam words retained.
- Creed recovery skipped the first half; verified displayed text is still
  intentionally omitted. No reconstructed creed or Lord's Prayer was added.

**Status remains `in_progress` / `needs_review`.** The requested major gaps are
substantially recovered; the pre-318.34s prayer lead-in remains for human review
outside this pass. No further recovery was attempted.

## Preview test candidates

These are **candidate acceptance queries**. The operator reports successful
pre-recovery builds and 12 E2E tests; this curator did not independently rerun
browser ranking or YouTube playback. Every video ID is `ZTDYIJUDb0M`.

| Query | Passage ID | Start | End | Section ID |
| --- | --- | ---: | ---: | --- |
| `learn about prayer by praying` | `p0906-learn-by-praying` | 3133.66 | 3220.74 | `s0906-prayer-example` |
| `eternal life here and now` | `p0906-here-now` | 5407.72 | 5476.2 | `s0906-knowing-god` |
| `gifts talents resources purpose` | `p0906-purpose` | 5565.06 | 5623.56 | `s0906-knowing-god` |
| `John 17:3` | `p0906-john17-answer` | 4756.04 | 4832.5 | `s0906-knowing-god` |
| `financial stewardship` | `p0906-financial-stewardship` | 6546.64 | 6594.44 | `s0906-announcements` |
| `Communion knowing you` | `p0906-communion-prayer` | 1140 | 1191.68 | `s0906-communion` |
| `purpose of Holy Communion` | `p0906-communion-meaning` | 736 | 815.9 | `s0906-communion` |
| `pastoral prayer trust` | `p0906-pastoral-prayer` | 5940 | 6012.76 | `s0906-creed-prayers` |

## Section inventory

All ranges are absolute original-video seconds. Small gaps between searchable
passages reflect pauses/transitions or explicit omissions, not edited playback.

| Section ID | Start | End |
| --- | ---: | ---: |
| s0906-preparation | 0 | 356.58 |
| s0906-welcome | 356.58 | 459.96 |
| s0906-call-hymn | 459.96 | 619.4 |
| s0906-invocation | 619.4 | 706.24 |
| s0906-communion | 706.24 | 1195.68 |
| s0906-responsive | 1195.68 | 1584.16 |
| s0906-hymn-anthem | 1584.16 | 1857.2 |
| s0906-scripture | 1857.2 | 1919.2 |
| s0906-sermon-intro | 1919.2 | 2073.2 |
| s0906-recap | 2073.2 | 2706.78 |
| s0906-sermon-prayer | 2706.78 | 2759.78 |
| s0906-high-priestly | 2759.78 | 3133.66 |
| s0906-prayer-example | 3133.66 | 3412.82 |
| s0906-glory | 3412.82 | 4247.7 |
| s0906-eternal-life | 4247.7 | 4756.04 |
| s0906-knowing-god | 4756.04 | 5623.56 |
| s0906-response-prayer | 5623.56 | 5718.3 |
| s0906-creed-prayers | 5718.3 | 6012.8 |
| s0906-offering | 6012.8 | 6135 |
| s0906-closing-worship | 6135 | 6369.18 |
| s0906-announcements | 6369.18 | 6594.44 |
| s0906-teachers-dismissal | 6594.44 | 6759 |

## Passage inventory

Passages follow thought/illustration boundaries rather than fixed 60-second cuts.
Several run 91–109 seconds to keep context together. Complete reference-only
responsive readings are longer. Short notices, prompts and dismissal are below
30 seconds because extending them would add music or unrelated material.

| Passage ID | Start | End |
| --- | ---: | ---: |
| p0906-acts-prayer | 0 | 108 |
| p0906-thanksgiving | 168 | 251.08 |
| p0906-preparation-close | 318.34 | 352.24 |
| p0906-welcome | 356.58 | 413.8 |
| p0906-call-to-worship | 459.96 | 504.16 |
| p0906-opening-prayer | 619.4 | 705.34 |
| p0906-communion-meaning | 736 | 815.9 |
| p0906-communion-liturgy | 815.9 | 905.06 |
| p0906-communion-invitation | 905.06 | 930.96 |
| p0906-communion-thanksgiving | 1050.94 | 1118.5 |
| p0906-communion-prayer | 1140 | 1191.68 |
| p0906-proverbs-reading | 1195.68 | 1419.92 |
| p0906-john-reading | 1424.48 | 1576.8 |
| p0906-hymn-introduction | 1584.16 | 1612.96 |
| p0906-scripture-reading | 1857.2 | 1918.2 |
| p0906-sermon-introduction | 1919.2 | 1972.2 |
| p0906-recordings | 1972.2 | 2073.2 |
| p0906-direct-prayer | 2073.2 | 2155.2 |
| p0906-believers-community | 2155.2 | 2244.2 |
| p0906-tribulation-love | 2244.2 | 2347.56 |
| p0906-acceptance | 2347.56 | 2456.78 |
| p0906-imperfect-faith | 2456.78 | 2527.78 |
| p0906-faith-examples | 2527.78 | 2618.78 |
| p0906-hope-plan | 2618.78 | 2706.78 |
| p0906-teachable-prayer | 2706.78 | 2759.78 |
| p0906-disciples-understanding | 2759.78 | 2853.94 |
| p0906-unusual-prayer | 2853.94 | 2925.5 |
| p0906-lords-prayer | 2926.32 | 3013.02 |
| p0906-intercession | 3013.02 | 3097.84 |
| p0906-prayer-mystery | 3097.84 | 3133.66 |
| p0906-learn-by-praying | 3133.66 | 3220.74 |
| p0906-billy-graham | 3220.74 | 3300.22 |
| p0906-pray-more | 3300.22 | 3358.8 |
| p0906-daily-prayer | 3358.98 | 3412.82 |
| p0906-hour | 3412.82 | 3494.36 |
| p0906-glory-suffering | 3494.36 | 3558.36 |
| p0906-stations | 3558.36 | 3625.42 |
| p0906-recognition | 3626.26 | 3719.8 |
| p0906-large-choirs | 3719.86 | 3787.26 |
| p0906-nature-glory | 3787.26 | 3871.28 |
| p0906-cross-purpose | 3871.92 | 3959.92 |
| p0906-crosby | 3959.92 | 4046.6 |
| p0906-first-pastor | 4046.6 | 4126.98 |
| p0906-eyesight | 4126.98 | 4196.74 |
| p0906-continuing-service | 4196.74 | 4247.7 |
| p0906-election | 4247.7 | 4318.58 |
| p0906-living-forever | 4318.58 | 4403.62 |
| p0906-significance | 4403.62 | 4498.2 |
| p0906-packaged-message | 4499.16 | 4583.58 |
| p0906-changing-church-scene | 4583.58 | 4678.76 |
| p0906-consistency | 4680.06 | 4755.08 |
| p0906-john17-answer | 4756.04 | 4832.5 |
| p0906-know-word | 4832.5 | 4915.34 |
| p0906-oneness | 4915.34 | 5018.02 |
| p0906-packer | 5018.02 | 5099.16 |
| p0906-knowledge-relationship | 5099.16 | 5196.12 |
| p0906-meditation | 5196.12 | 5299.96 |
| p0906-application | 5300.92 | 5355.24 |
| p0906-courtship | 5355.24 | 5407.72 |
| p0906-here-now | 5407.72 | 5476.2 |
| p0906-accomplished-work | 5477.48 | 5565.06 |
| p0906-purpose | 5565.06 | 5623.56 |
| p0906-sermon-closing-prayer | 5623.56 | 5718.3 |
| p0906-creed | 5718.3 | 5763.62 |
| p0906-prayer-prompts | 5764.34 | 5819.64 |
| p0906-leaders-prayer | 5876.52 | 5897.04 |
| p0906-pastoral-prayer | 5940 | 6012.76 |
| p0906-offering | 6012.8 | 6027.62 |
| p0906-closing-hymn | 6135 | 6171.6 |
| p0906-benediction | 6299.92 | 6369.18 |
| p0906-anniversary | 6369.18 | 6438.1 |
| p0906-proofread-request | 6438.1 | 6527.22 |
| p0906-proofreading-followup | 6527.22 | 6546.64 |
| p0906-financial-stewardship | 6546.64 | 6594.44 |
| p0906-teachers-appreciation | 6594.44 | 6630.18 |
| p0906-teachers-prayer | 6696.64 | 6742.56 |
| p0906-dismissal | 6742.56 | 6754.96 |

## Validation and remaining handoff

- Post-recovery `scripts/devenv-run pnpm validate:archive`: **passed**, one
  interpreted service.
- Post-recovery read-only loader/projection check: **22 sections, 77 passages,
  46 sermon passages; production 0, preview 77, all preview flags true**. No generated
  index was written by this check. This proves data eligibility, not browser
  ranking or player behaviour.
- Final assertions also passed for contiguous section coverage, all five newly
  added recovery passage ranges and the six unchanged original candidate ranges.
  `git diff --no-index --check`
  passed for both newly authored files.
- An initial concurrent pair of devenv invocations collided in a generated shell
  command and produced a shell syntax error. Sequential validation immediately
  passed. No environment/script repair was attempted. Run remaining devenv checks
  sequentially to avoid this observed collision; this is an implementation-owner
  follow-up, not an archive schema failure.
- No source media, raw ASR, frames, model bytes, authorization data or complete
  scripture readings were added to these repository files. Source and review
  metadata intentionally retain only safe evidence descriptions.
- The external owned workspace and separate verified model cache remain for the
  main owner's evidence review and cleanup, as requested. Cleanup is **pending**,
  not claimed complete. The existing shell session was not stopped.
- Next: human listening to the pre-318.34s prayer lead-in and refinement of the
  flagged coarse timings/uncertain words. The single authorized recovery pass is
  finished; further automated retries were not run. Only after actual coverage
  resolution should the main owner advance workflow and validate again.
  Human editorial approval remains a separate later action.
- The operator reports that the original 72-passage preview, zero-passage
  production builds and 12 E2E tests passed. Those generated outputs remain
  untouched and do not yet contain the five additions. Refreshing builds and
  verifying new passages remains with the main implementation owner. No milestone
  completion is asserted by this curation handoff.
