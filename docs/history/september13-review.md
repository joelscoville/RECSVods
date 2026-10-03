# 13 September 2026 — first Milestone 3 case

## Result and scope

Processed only **`GkmB_KeBlBw`**, the **13 September 2026** RECS English service.
`services/2026/2026-09-13/service.yaml` contains **40 sections / 91 passages**,
one **playable** physical upload, service/video workflow **`complete`**, and
editorial status **`needs_review`**. Passage lengths are **31.44–89.30 seconds**.
Processing completion follows the operator’s explicit decision to flag remaining
uncertainty and continue; it is not human editorial approval.

The verified sermon title is **Simple but Demanding**, with **John 17:1-5** and
**Psalms 1:1-6** on this recording’s title slides. Structured speaker metadata is
left empty: the ASR introductions say **Pastor Yong** and **Brother Hadi**, but no
full-name caption was verified. Familiarity with other dates or appearance was
not used to expand names. The later **Last Session / Eternal Life** slide is a
recap inside this sermon, not its title.

This case authored only the service file and this review. Other M3 recordings and
the advance M4 bundle records were not curated. This is a case-level handoff,
not completion of the integrated M3 browser, semantic evaluation or delivery gate.
No builds, commits, approval, run-log edits or application changes were performed
by this case. Concurrent correction-workflow changes belong to the other worker.

## Authorization, source and import

Read the canonical curator skill, updated shared implementation README, Prompt 3,
run log, archive/media/import/curation/preflight documentation, current schema,
existing structural example and operator bundle README/checksum manifest.
Current operator confirmation covered the existing ignored, untracked local
authorization record, passed explicitly on acquisition, sampling and import.

Commands ran sequentially through ordinary finite `scripts/devenv-run` calls:
**900s outer deadline**, **900s media-native deadline**, **940000ms tool wait**.
An external stage helper installed failure/interruption cleanup before acquisition;
its importer subprocess had an additional **850s** deadline. Metadata/repeat-probe
and refined decoder invocations used **800s** native deadlines. Initial free space
was approximately **59 GiB**. No agent-shell, local/remote transcription, ASR
preflight, model inference, Colab execution or VM dispatch occurred. Existing
preflight evidence was reused; acquisition checked native versions without ASR.

| Check | Result |
| --- | --- |
| Verified video / channel | `GkmB_KeBlBw` / `UCLjwcZaIkiFEed1VgQYSsrw` |
| Fresh metadata title / date | `RECS 13 September 2026` / `20260913` |
| Fresh metadata description | Reformed Evangelical Church Singapore English Service |
| Acquisition | Full recording, no section selector; usable audio and video |
| Metadata duration | **6628 seconds** |
| Acquisition ffprobe / independent repeat ffprobe | **6628.441 seconds**, both |
| Acquired manifest span | **0–6628s**, reflecting integer-floor metadata |
| Supplied duration / imported full span | **6628.4146875s / 0–6628.4146875s** |
| Transcript minus actual source | **−0.026312500000130967s** |
| Source minus metadata | **+0.44099999999980355s** |
| Duration comparison | Actual acquisition ffprobe, **2s** tolerance; passed |
| JSON checksum / exact engine and metadata | Passed |
| Timing scan | Complete; all **1,518 segments / 15,277 words** checked |
| Converted correspondence | Every segment ID, text, start, end and word array equals raw JSON |
| Language | Original **`en`** retained; a short Chinese quotation is not translated |
| Zero-duration segments / words | **0 / 36**, retained |
| Tail-normalized timestamp fields | **0**; no timestamps shifted or scaled |
| Original audio | **0 verified copies; `audio_hash_verified: false`** |

Import used `scripts/import_transcript.py import` with the supplied transcript,
`SHA256SUMS`, sentinel-owned acquired workspace, explicit authorization, both
designated `--audio-root` arguments, and **`--allow-missing-audio`**. It checked this
file rather than processing the entire enlarged bundle. The raw file remains
unchanged and external. Safe source identifier: **operator-supplied 2026-09-25
Colab bundle**, relative filename **`GkmB_KeBlBw.json`**.

### Hashes and safe receipt

- Verified transcript JSON SHA-256:
  `bc67930bf70b25f102e25c01e9f1db573dcd011c449f6c06fd16292ab5bc5e7b`
- Supplied original WebM audio SHA-256, **not reverified**:
  `38454d2075c72843f898464af43cac29dea36187d3e704dadc2a70c9ddb6af7a`
- Reacquired inspection `source.mkv`, **173,212,960 bytes**, SHA-256:
  `22998c4ec20126993768baf38c458f0b946eca753ab0a0c4ece20c045536e864`
- Converted `evidence.json` SHA-256:
  `2b147b8dce3bab5ecafe659e3a44f53083f25640e9d9377de1098cba55c4c283`
- Converted `evidence.txt` SHA-256:
  `d8a95087174732fd0bc0e0687a027f49c1f969e49fbe35a89bc730d66967b75e`
- Local receipt SHA-256, before cleanup:
  `bfda8cb6d76fbfa850abcc223988cef2837d12000f93e0ba043e1cb3eca6bb23`

Reacquired video is inspection evidence, **not proof that original Colab audio
bytes match**. Only the exact **`receipt.archive_provenance`** object was copied to
`videos[0].transcription_provenance`; a parsed deep-equality assertion passed.
The private receipt, workspace token, root identities and paths are not copied.
An extra-key rejection check passed. Existing search/display allowlists exclude
provenance and review metadata.

Exact supplied engine JSON:

```json
{
  "name": "faster-whisper",
  "version": "1.2.1",
  "ctranslate2": "4.8.2",
  "model": "large-v3-turbo",
  "compute_type": "float16",
  "device": "Tesla T4",
  "options": {
    "beam_size": 5,
    "word_timestamps": true,
    "vad_filter": false,
    "condition_on_previous_text": false
  }
}
```

Supplied GPU elapsed **215.409s**, RTF **0.0325**, transcribed at
**`2026-09-25T11:17:24.639192+00:00`**. Import verified elapsed/duration consistency
within the documented five-decimal rounding tolerance. These are operator-recorded
GPU timings, not local inference measurements. Import verification timestamp:
**`2026-09-25T14:55:11.338294+00:00`**.

Local stage measurements, excluding environment startup and editorial work:
acquisition **60.802s**; import **0.849s**; coarse sampling **12.361s**;
fresh metadata and repeat probe **10.099s**; correspondence/regional-word checks,
refined frames and samples **18.143s**; hash audit **0.605s**.
Native versions: yt-dlp **2026.08.19**, ffmpeg/ffprobe **8.1.2**. The checked whisper
executable fingerprint matches the previously documented pinned package; it was
not used for transcription. The separate verified model cache is retained.

## Source inspection and programme coverage

Read the complete timestamped evidence, with overlapping adjacent context and
neighbor paragraphs around editorial cuts. Interpretation follows the programme’s
thought progression, not equal-sized ASR blocks. The full imported evidence is
not represented as local 600/555-second inference chunks.

**23 coarse audio windows** were decoded at 0, 300, …, 6600s: 30 seconds each,
except the last metadata-bounded 28s window. A frame was captured at every start.
**Eight additional 30-second windows** were decoded at **90, 1000, 4505, 4530,
4560, 5920, 6100, 6598s**. All **31 windows** decoded successfully, but were
**not listened to**. There is no claim of listening-verified silence, wording,
word-level alignment or uninterrupted audible playback.

**52 refined frames** were inspected at:

```text
0, 10, 28, 60, 100, 180, 240, 285, 450, 490, 850, 1050,
1150, 1300, 1450, 1840, 1905, 1925, 1950, 2590, 3500, 3750,
3845, 4060, 4215, 4370, 4498, 4515, 4535, 4540, 4543, 4546,
4550, 4565, 4620, 4805, 4925, 5395, 5665, 5780, 5900, 6100,
6180, 6335, 6380, 6420, 6500, 6550, 6605, 6615, 6625, 6628
```

All **75 source frames** were visually reviewed using seven contact sheets and
individual tail-frame checks. They support playability and programme identity
together with probing, decoding and transcript correspondence. They do not
identify a speaker by appearance or establish exact audible boundaries.

| Interval (original recording seconds) | Evidence and treatment |
| --- | --- |
| 0–284.58 | Dated opening card; invitation to prayer at 11.16s; ACTS slides at 100/180/240s. Preparation retained as programme, not waiting. |
| 284.58–551.42 | Collective prayer, welcome, introit and Psalms 99:1-5 call to worship. |
| 551.42–1145.4 | To God Be the Glory, opening prayer, Ancient of Days. **1050s frame explicitly announces temporary muting for copyright/streaming restrictions.** Exact mute bounds remain unknown. |
| 1145.4–1481.14 | Proverbs 7:1-27 and John 17:1-19 responsive readings; ranges confirmed by slide and announcements. |
| 1481.14–1910.52 | I Am Thine, O Lord; video anthem I’ll Have a New Life; Psalms 1:1-6 reading and invitation to Pastor Yong. |
| 1910.52–2446 | This sermon’s introduction, congregation questions, John 17 recap and prayer. Title slide at 1905/1925/1950s separates current title from last-session recap. |
| 2446–2985.5 | Eternal life, mortality, the preacher’s afterlife chart and limits of detailed knowledge. |
| 2985.5–3451.66 | Seminary/burial recollections, reported Stephen Tong conversations, Singapore context and explicit cremation answer. |
| 3451.66–3724.28 | 1 Corinthians 13:9-12 mirror illustration, future hope, Dallas Willard proposal and eternal life beginning now. |
| 3724.28–4347.46 | Packer’s Knowing God, train-journey application, simplicity, correct knowledge and Acts 17. |
| 4347.46–4779.56 | Psalms 1, mental rest versus reflective meditation, **flagged alignment region**, everyday relationships and internalization. |
| 4779.56–5399.46 | Prayer/praise and four markers: energy, great thoughts, boldness, contentment; illness and imperfection qualifications retained. |
| 5399.46–5755.3 | Simple-but-demanding study analogy, daily devotional practice, growth together and sermon-closing prayer. |
| 5755.3–6180.22 | Apostles’ Creed, personal/church prayer and offertory. Prayer/offerings remain meaningful intervals despite sparse ASR. |
| 6180.22–6413.9 | Trust and Obey, doxology, benediction and closing Amen. Only announced benediction chapters recorded; verse ranges not guessed. |
| 6413.9–6628.441 | Next week’s anniversary arrangements, ministry anniversary, financial stewardship, ministry invitation and dismissal. Communion is announced for next week, not invented in this service. |

Editorial beginning is the worship-preparation invitation at **11.16s** with
opening visual context from **0s**. Last substantive speech ends **6610.54s**;
**6615s** shows the vacated lectern, and **6625/6628s** are black. The isolated final
ASR “You” at 6625.22–6626.62s is not reliable evidence of additional speech.
Two-minute context margins around the meaningful programme clamp naturally to
**0–6628.441s**. The true imported span remains **0–6628.4146875s**, independently
of that editorial selection. No waiting duration, missing sermon or tail speech
was invented.

Long hymns, responsive readings and the offertory retain their full **section**
spans. Their 30–90s navigation passages explicitly say when the item continues;
they do not pretend to be full performances or arbitrarily subdivide lyrics into
thoughts. Sermon passages follow complete arguments and examples. Sparse ritual
entries are not padded to a token quota. Scripture/lyrics/uncertain wording and
selected digressions have explicit omission markers; remaining excerpts preserve
the speaker’s surrounding context rather than substituting summaries for speech.

## Alignment receipt and regional review

**21 warning occurrences on 20 source IDs**, maximum overall offset **2.82s**:

- **18 outside-segment words**, maximum **0.30s**, IDs
  **32, 36, 38, 83, 183, 186, 269, 315, 472, 641, 694, 720, 721, 745,
  1056, 1079, 1081, 1422**.
- **2 segment overlaps:** ID **975**, **1.36s**; ID **976**, **1.74s**.
- **1 backward start:** previous ID **974** begins **4543.58s**; current ID
  **975** begins **4540.76s**, **2.82s backward**.
- **0 within-segment word overlaps**, **0 tail clamps**, **36 zero-duration words**.

Import/evidence preserves incoming array order and source times. The receipt’s
`nonmonotonic_segment_start_count` is **1**, `max_backward_jump_seconds` **2.82**,
and the warning requires regional curator review before publication.

Regional review covered the mental-rest discussion, Chinese quotation, Packer
definition and subsequent everyday-love application, with the neighboring
paragraphs **4407–4504.58s** and **4564.5–4650.64s**. Frames at
**4498/4515/4535/4540/4543/4546/4550/4565/4620s** show a coherent visual progression
from the meditation illustration to Packer’s definition and purpose. Displayed
Chinese captions lag and contain apparent errors; they are not a corrected clock.

Word adjacency reveals **more than merely a decreasing segment start**:

1. Around IDs **958–960** (4517.88–4522.04s), the Chinese segment texts and word
   arrays do not partition the same wording. Later English segment text continues
   to lag the corresponding word arrays.
2. ID **972**’s word array contains the end of the definition and already reaches
   “for example”; IDs **973/974** contain words of the following connector.
3. ID **974** text finishes the definition at **4543.58–4543.86s** while its word
   array contains only “about.” IDs **975/976** contain the connector text at
   **4540.76–4542.12s / 4542.12–4543.90s**, with **empty word arrays**.
4. The following application resumes at **4544.52s**. This is consistent with a
   source-ASR text/alignment mismatch; it does not prove audible duplication,
   authorize sorting, or establish corrected word times.

**`p0913-meditation-definition` (4504.58–4564.5s)** encloses the entire problem,
has confidence **0.67**, a visible uncertainty marker and detailed review notes.
The Packer slide supports the definition’s wording, but the transition remains
unresolved. No passage starts or ends inside the 974/975/976 sequence. Following
**`p0913-love-application` (4564.5–4595.94s)** keeps the relational application
together; **`p0913-reflection-doubt` (4595.94–4669.6s)** preserves its next thought.
Three regional audio windows decoded successfully; there was **no listening** and
no claim that this review repaired the alignment. Human listening remains needed
before editorial approval.

Other explicit uncertainties include names/dialect terms, the ASR burial term,
unverified anecdotes and public-policy statistics, prayer/music gaps, and the
temporary-muted song interval. Historical/theological claims are attributed to
the speaker. The illness and imperfection qualifications remain beside the
four-marker discussion, and the uncertain aircraft story retains the preacher’s
own statement that he does not know whether it is true.

ESV API conditions were re-read at **https://www.esv.org/api/** on **2026-09-25**;
the documented storage and rate restrictions were unchanged. Scripture remains
reference-only, including embedded quotations and the short Chinese quotation.
No verse text, alternative translation or lyrics were supplied from memory.

## Validation and candidate handoff

- **`pnpm validate:archive`: passed**, six interpreted services. An initial YAML
  quoting error in two summaries was fixed before the successful run.
- **`pnpm exec vitest run tests/archive.test.ts`: 123 passed**, one file,
  **2.43s** total runner duration. No broad suite or build was run.
- Read-only archive/projection assertions passed: exact receipt projection,
  strict extra-key rejection, all 91 new passages present and labelled in preview,
  **0 production / 437 preview passages**, and no engine/hashes/review metadata
  in search or display serialization.
- Standard `displayServices` / `homeItems` path passed without video-specific
  application code: **Simple but Demanding**, `GkmB_KeBlBw`, sermon start
  **1910.52s**, `preview: true`; standard URL uses whole-second **`t=1910`**.
- All section/passage references, ranges and metadata validate against the current
  schema. No new speaker or title special case was added.
- Final read-only checks passed for contiguous section coverage, all passage
  durations within 30–90s, no passage overlaps, the correct physical video on every
  passage, absence of private paths/authorization/approval fields, and whitespace
  checks of both new files.

Deterministic lexical checks against all **437 preview passages** returned these
candidates. These are measured lexical results, **not semantic/browser acceptance**:

| Query | Candidate passage | Rank | Video | Start–end (s) |
| --- | --- | ---: | --- | --- |
| `Simple but Demanding` | `p0913-simple-demanding-title` | 1 | `GkmB_KeBlBw` | 3784.86–3874.16 |
| `cremation` | `p0913-two-questions` | 1 | `GkmB_KeBlBw` | 2038.32–2077.18 |
| `cremation` — substantive answer | `p0913-cremation-answer` | 2 | `GkmB_KeBlBw` | 3406.48–3451.66 |
| `How can knowledge about God become knowledge of God?` | `p0913-simple-demanding-title` | 1 | `GkmB_KeBlBw` | 3784.86–3874.16 |
| `Psalms 1:1-6` | `p0913-psalm-one` | 1 | `GkmB_KeBlBw` | 1835.48–1891.52 |
| `13 September 2026` | `p0913-future-wonder` | 1 | `GkmB_KeBlBw` | 3451.66–3525.42 |
| `daily devotional` | `p0913-daily-devotional` | 1 | `GkmB_KeBlBw` | 5525.3–5591.24 |

Useful additional editorial candidates: **`p0913-two-movements`**,
**4123.72–4197.72s**, for meditation leading to prayer/praise; and the explicitly
flagged **`p0913-meditation-definition`**, **4504.58–4564.5s**, for alignment review.
All retain the original physical YouTube ID and absolute recording clock.

## Cleanup

Original **`GkmB_KeBlBw.webm` was absent from both designated audio roots** at
import and remained absent at the post-review check. `cleanup-audio` was **not
called**: the receipt honestly says `audio_hash_verified: false` and that command
does not permit this state. No original bytes were reconstructed or claimed as
matching. The local batch-audio root was empty at the final inspection; the Drive
root then contained **unrelated audio files**. Those files were neither hashed
for this case nor removed. Do not report both entire roots as empty now.

**Cleanup: true.** The sentinel-validated `media.py cleanup` command returned
`cleaned: true`. It removed the owned acquired video, all 31 audio windows, all
75 source frames and seven contact sheets, manifests, converted evidence and full
local receipt after the safe provenance copy and checks. The external stage
helper was also removed. The unchanged raw operator bundle and separate verified
model cache were retained. The safe provenance and review evidence above are the
only receipt-derived material retained in repository source.
