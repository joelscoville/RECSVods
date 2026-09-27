# July 12 bounded M3 curation

## Final disposition

The full `D-FyolbxJgk` programme is now fully curated as **`2026-07-12`**:
**43 chapters / 94 passages**, `complete`, `needs_review`, video **`playable`**.
The displayed sermon title is **To be Nothing**, not Signs and Wonders.

The complete **188.061-second** `MZr169xBwrU` was also inspected and interpreted,
including everything after the former 60-second smoke-test limit. It is retained
separately as **`2026-07-12-mzr169xbwru`**, `complete` / `needs_review`, with one
whole-clip, reference-only musical/liturgical passage and video **`unassessed`**.
Its relationship and intended-programme suitability remain unresolved after
inspection; this is not an assertion that technical inspection is unfinished.
It is neither rejected for shortness nor described as a failed/no-audio upload.

No multipart order, shared clock, duplicate rejection, invented prayer, or
unverified lyric has been imposed. The full programme is independently suitable
for review preview; the short candidate remains outside ordinary results pending
human resolution. Both retain their exact physical IDs and import provenance.

### Date and identity evidence

| Evidence | Full programme D | Short clip MZ |
| --- | --- | --- |
| Verified physical ID | `D-FyolbxJgk` | `MZr169xBwrU` |
| Verified YouTube title | `RECS 5 July 2026` | `RECS 12 July 2026` |
| Description | RECS English service | RECS English service |
| Upload / release dates | Both `20260712` | Both **`20260716`** |
| Visible date | 30s sanctuary screens and 105s welcome slide: **12th July 2026 9:30am** | No date in inspected frames |
| Archive date basis | Convergent source-slide and release evidence | July 12 source title, explicitly provisional against July 16 release |
| Language evidence | Metadata `en-US`; original ASR `en`, brief Chinese quotations | Metadata language absent; original ASR `en`, not independent proof of speech |

Each metadata response verified exact ID and channel
`UCLjwcZaIkiFEed1VgQYSsrw`; both are finalized `was_live` uploads. Dates refer to
metadata/visible evidence, not a deduction from duration or a transcript's topic.
The short clip's release date is a material new uncertainty, not silently changed
to July 12 or ignored to manufacture a restart.

D's former `2026-07-05-d-fyolbxjgk` directory was an **uncommitted comparison-only
record**, with no published links. It was moved to the truthful date-backed ID
before first commit. Its former unassessed status is superseded by this full
curation; its prior evidence remains in [the July 5 comparison](july5-comparison.md).
`OrsN83j3qxE` and its July 5 record were not modified or reacquired. No title,
speaker identity, passage, announcement detail or scripture range was borrowed
from that service or any other date.

## Scope, authorization and operations

Read the canonical curator skill, shared implementation README, Prompt 03, run
log, archive/media/preflight/curation/import documentation, strict archive schema,
existing comparison record and operator bundle README/SHA256SUMS. No taxonomy
directory exists; no speculative taxonomy was introduced. Current-conversation
permission confirmed the ignored, untracked local authorization record, passed
explicitly to acquisition, sampling and import. Its private path and contents are
not reproduced here.

Only the two supplied JSON files were imported. No local/remote ASR, model
inference, VM, translation, new transcription preflight or Colab execution ran.
Existing toolchain evidence was reused. All native/project operations used
`scripts/devenv-run` with finite **900s outer bounds**, **900s native limits** and
**940000ms tool waits**. Workspaces were fresh external per-video sentinel-owned
roots. Failure/interruption cleanup was installed before acquisition, with
explicit success cleanup after evidence review. Original batch-audio roots were
never part of unconditional workspace cleanup.

Native versions: yt-dlp **2026.08.19**, FFmpeg/ffprobe **8.1.2**. The media tool
fingerprinted the unused whisper executable as
`ca96421296b25286fafcbfa319ad2c749abb9e70f2ed7a719ca45d1a1c0836e3`;
this is **not** the imported transcript engine or model provenance. No dependency
installation or toolchain fallback was needed. Acquisition's disk check passed;
post-acquisition free space was 58.392 GiB for D and 58.390 GiB for MZ.

One initial local inspection-helper call failed before acquisition because its
metadata-capture wrapper omitted the media command's optional third argument.
Correcting that helper signature resolved the error; it was not a source-access
failure, a transcription attempt or a repository-code change. The successful
acquisition stages took **64.273s** and **16.540s** respectively; coarse sampling
took **26.501s** and **1.146s**. No inference timing is attributed to these stages.

## Verified source and import receipts

Safe import source: **operator-provided Colab transcript bundle, README decision
2026-09-25**, relative files `D-FyolbxJgk.json`, `MZr169xBwrU.json`, `SHA256SUMS`.
Raw bundle bytes were retained unchanged. Each import used `--checksums`, both
designated `--audio-root` arguments and **`--allow-missing-audio`**.

| Measurement / check | D | MZ |
| --- | ---: | ---: |
| yt-dlp duration | 6676s | 188s |
| Actual ffprobe duration, independently reprobed | **6676.361s** | **188.061s** |
| Acquisition manifest span, metadata endpoint | 0–6676 | 0–188 |
| Imported duration / full transcribed span | **0–6676.3406875s** | **0–188.0351875s** |
| Transcript minus actual source duration | −0.0203124999998181s | −0.025812500000000682s |
| Source minus metadata duration | +0.361s | +0.061s |
| Segments / words | 1605 / 14481 | 7 / 57 |
| First segment | 0–29.94s | 0–29.98s |
| Last segment | 6657.18–6658.58s | 157.40–185.86s |
| Outside-segment word warnings / affected segments | 11 / 11 | 0 / 0 |
| Maximum alignment offset | 0.42s | 0s |
| Zero-duration words | 42 | 3 |
| Zero-duration segments / backward starts / tail clamps | 0 / 0 / 0 | 0 / 0 / 0 |
| Operator GPU elapsed | **220.672s** | **5.261s** |
| Supplied RTF | **0.03305** | **0.02798** |
| Verified original audio copies | **0** | **0** |
| Entire converted segment array equals raw JSON | Yes, including words/order/text | Yes, including words/order/text |
| Exact video `transcription_provenance` equals receipt `archive_provenance` | Yes | Yes |

Each JSON passed full SHA-256 comparison, approved engine/settings validation,
finite/bounded segment and word scans, exact ID/channel checks, elapsed/duration
RTF consistency and the 2s source-duration tolerance. No sorting, time scaling,
invented local chunks or timestamp repairs were made. Both full sources passed
FFmpeg audio **and video** decoding to end using `-xerror`, and were separately
decoded to 16kHz mono signed 16-bit PCM for measurement. Complete decode establishes
technical usability, not a complete verbatim transcript or listening verification.

For **each** video the exact receipt records faster-whisper **1.2.1**,
CTranslate2 **4.8.2**, `large-v3-turbo`, float16 on **Tesla T4**, beam 5, word
timestamps true, VAD false, `condition_on_previous_text: false`. Transcription
dates are respectively `2026-09-25T11:13:48.845647+00:00` and
`2026-09-25T11:17:29.974727+00:00`. Model-weight checksum/revision and full remote
runtime image are not supplied; they remain unknown. No whisper.cpp model hash
has been substituted for those gaps.

| Digest | D | MZ |
| --- | --- | --- |
| Verified JSON SHA-256 | `9ba1f1e2b0e822a89e0bbdce87965b732455950ce028007dcac52d31d4cb1712` | `7029d354d90ff56361d33010c1058c71876c551044968ef604a91f99a66bbbaa` |
| Supplied original-audio SHA-256 — **not byte-verified** | `75db02d5f38183ec69508d764dd83d9cebcdbe4930714725147cca0edc8a451b` | `3b80a4aabd75a88a4e828ba1521cc97ee800b4a81f6069026d730b774b0911c5` |

Both `<video-id>.webm` target basenames were absent in **both** accessible
designated audio roots. Thus **`audio_hash_verified: false`** remains in both
receipts and both archive projections. Newly downloaded media, matching durations
and derived PCM hashes cannot prove identity of already-deleted Colab input bytes.
`cleanup-audio` was not invoked; **zero original source-audio files were deleted**.

## Full-programme inspection and boundaries

D's complete 1605-segment supplied transcript was read sequentially, with
overlapping context around the read boundaries. All 23 coarse frames and 30-second
samples at `0, 300, …, 6600` were acquired and decoded. Thirty refined frames were
captured at `30, 90, 105, 120, 430, 580, 640, 960, 1720, 1740, 1780, 2010, 2040,
2120, 2340, 2780, 3020, 3440, 4320, 4650, 5210, 5550, 5710, 5950, 6190, 6370,
6490, 6540, 6640, 6670`. Additional comparison frames at **6.5s and 36.5s**
were decoded and inspected at full size. Contact sheets and key full-size frames were inspected;
unused contact-sheet padding is not source footage. Full PCM decode also covers
quiet prayer, song and anthem gaps beyond the coarse windows.

All boundaries and links use **original-upload seconds**. Chapters and passages
each cover the full source contiguously, 0–6676.361s. This is programme coverage,
not a claim that every second contains speech or that every spoken word is printed.
**83 of 94 passages are 30–90s**. The exceptions preserve coherent prelude, hymn,
responsive-reading, instrumental, poem or offering units; one 28.34s passage is
the complete Deuteronomy recap conclusion with its explicit qualification.

| Absolute D anchor | Evidence and editorial consequence |
| --- | --- |
| 0–105.06 | Sanctuary setup and dated welcome. Prelude/possible background music retained; isolated ASR thanks withheld. Frames 90/105s still show welcome, 120s shows ACTS leader; first substantive invitation at 105.06s. |
| 105.06–439.42 | ACTS adoration, confession, thanksgiving, supplication and concluding prayer. Personal-prayer gaps remain, not invented speech. |
| 439.42–633 | Welcome, greeting, silent meditation and call to worship. **580s slide says Psalms 85:10-13**, resolving ASR's apparent 1–13 report in favour of visible evidence, with discrepancy noted. |
| 633–1156.24 | Great is Thy Faithfulness, opening prayer and **Christ Liveth in Me** (960s title slide). **900s caption: Belinda Sutan**. Prayer names Pastor Yong; no full name is borrowed from another service. |
| 1156.24–1540.02 | Responsive readings; slides at 1200/1500s explicitly **Proverbs 29:1-27; John 15:1-17**. Congregational ASR omissions not reconstructed. |
| 1540.02–1719.86 | I Need Thee Every Hour introduction and hymn. |
| 1719.86–2026.56 | Anthem introduction and **Guitar Ensemble — There is a Hope**. 1780/1800s title/inset and 2010s musicians confirm performance. Repeated ASR thanks are not treated as the anthem's words. |
| 2026.56–2111.14 | Invitation names Jacinta and Pastor Yong. Matthew 10:40-42 read at 2045.94–2089.70; 2100/2120s reading slide lingers beyond the spoken handoff. Frame changes are not blindly used as speech cuts. |
| 2111.14–2372.84 | Sermon introduction: ensemble appreciation, hope, football illustration and John introduction. **2340s title slide: To be Nothing; John 15:1-11; Matthew 10:40-42**. |
| 2372.84–2740.48 | **Last Session** recap of Signs and Wonders, visible at 2400/2700s. Not today's title; contains his own claims about tongues, healing and authority. |
| 2740.48–2997.04 | Prayer and John 13–15 background, including a proposed walk toward Gethsemane; the setting remains explicitly probable. |
| 2997.04–3542.10 | Seven declarations, true vine, temple/cultural comparison, divine simplicity and Father as caretaker. 3440s slide verifies the loving-caretaker explanation. |
| 3542.10–3836.94 | Confidence, **Psalms 121:1-2** (3600s slide), dependence and mutual care rather than solitary faith. |
| 3836.94–4312.52 | Removed branches, fruitfulness and pruning. 3900/4200s slides corroborate **John 15:2,6** and deliberate pruning. Strong rhetoric, medical illustration and Chinese quotation retained as explicit review issues. |
| 4312.52–4752.08 | Abiding, fruit, truth and goodness. 4320s Our Response; 4500s **Galatians 5:22-23**; 4650s **James 1:17**. |
| 4752.08–5183.40 | John 15:5 central theme, retirement/rich-fool illustration, Antilia and poverty. 5100s slide corrects the building name; conflicting spoken-ASR financial figures are withheld, not certified. |
| 5183.40–5622.50 | **Matthew 10:42** (5210s), enduring value, judgment, prayer, love, obedience and joy; **1 Samuel 15:22 / John 15:10** verified at 5550s. |
| 5622.50–5935 | **Charles Thomas Studd** name and WEC on 5700/5710s slides; Only One Life recitation, concluding appeal and response prayer. Unknown other missionary names withheld. |
| 5935–6243.42 | Apostles' Creed (5950s), personal reflection, possible 2027 South America rally and pastoral prayer. Missing creed words and quiet intervals not filled from memory. |
| 6243.42–6509.76 | Offering, **Thou my everlasting portion** (6370s displayed title) and doxology (6490s). Uncertain offering designation withheld; no payment details copied. |
| 6509.76–6676.361 | Blessing announced from **Hebrews 13**, plans for Jakarta, a September-trip follow-up, dismissal at 6642–6646.66s and closing meditation. Empty pulpit at 6670s; source end retained. |

The sermon title's **John 15:1-11** and responsive reading's **John 15:1-17** are
distinct verified ranges. Exact references are not expanded merely because a
quotation sounds familiar. Hebrews 13, Luke 12, Deuteronomy 13 and 2 Timothy 3
remain chapter-level where only chapters were explicitly identified in the
reviewed evidence. Speaker references preserve **Belinda Sutan**, source-announced
**Pastor Yong**, and **Jacinta**; unidentified leaders remain unidentified.

Transcripts are **edited ASR excerpts**, not a complete verbatim transcript.
Punctuation and limited grammar/homophone edits remain reviewable. Omissions of
quoted scripture, hymn/poem words, uncertain speech and selected illustrations
are explicitly marked. Summaries cover their role and attribute claims to the
speaker. No external biographical, denominational, financial or medical claim is
presented as independently established fact.

ESV terms at <https://www.esv.org/api/> were rechecked for this review on
2026-09-26; the cited storage/query restrictions remain as documented. No ESV
verse text was added. References use the site's ESV links; no Bible wording is
supplied from memory or replaced with another translation in the transcripts.

## Complete short-clip inspection

MZ's full video/audio decode succeeded. Frames at **0, 10, 20, …, 180 and 187s**
cover the full clip, not only its old smoke-test portion:

- **0–70s sampled frames:** ACTS graphic with church branding, no visible speaker.
- **80s:** dark branded layout, not proof of permanent video failure.
- **90–110s:** larger ACTS graphic.
- **120/130s:** empty lectern, microphone and dark monitor.
- **140/150s:** ACTS plus inset empty lectern.
- **160/170/180/187s:** empty lectern/monitor view; no later sermon inferred.

These are sampling anchors, not exact scene-cut times. The clip starts already in
a musical/liturgical-display context and ends without establishing a service
opening, sermon, dismissal or continuity into D. Its precise purpose—preparation,
test capture, excerpt or other use—remains unresolved. A test is a possibility,
**not a classification proven by release date or empty lectern**.

The complete audio was decoded to PCM and divided into consecutive windows:

| MZ interval | Samples at 16kHz | RMS dBFS | Zero-crossing fraction |
| --- | ---: | ---: | ---: |
| 0–30 | 480000 | −32.893 | 0.112890 |
| 30–60 | 480000 | −32.433 | 0.140179 |
| 60–90 | 480000 | −35.096 | 0.124850 |
| 90–120 | 480000 | −32.642 | 0.172923 |
| 120–150 | 480000 | −35.840 | 0.167409 |
| 150–180 | 480000 | −33.453 | 0.172632 |
| 180–188.0351875 decoded audio | 128563 | −40.189 | 0.129906 |

A full 0–188.0351875s spectrogram was inspected. Sustained harmonic bands and
changing musical-looking structure, with quieter transitions around 75–93s and
143–155s, are consistent with music rather than a wholly silent/failed stream.
RMS, zero crossings and spectrograms are **not** a calibrated speech/music
classifier. They do not establish an instrumental-only performance, hymn title,
word accuracy or the absence of all vocals. No audio-listening facility was used.

All seven raw ASR segments were reviewed. The opening purported **`www.fema.org`**
instruction is **uncorroborated suspected hallucination**, not an announcement,
topic or real-content finding. Its first word has probability 0.0028; “more” is
stretched over 1.28–23.08s; three address tokens have zero duration at 29.98s.
The 0–30s frames contain ACTS graphics, not that information. Machine confidence
alone neither verifies nor disproves speech. The two isolated thanks segments,
song-like fragments from 91.70s onward, and repetitive closing words likewise lack
sufficient source confirmation for a published transcript. They are withheld
without inventing prayers, inferring an organization/topic, or naming a hymn from
memory. The entire musical/liturgical interval is still represented for review.

## Relationship comparison: hashes and temporal anchors

No listening, acoustic fingerprint model or new transcription was used. Comparison
is deliberately limited to decoded measurements, visible frames, metadata and
the supplied evidence. Separate source clocks are preserved.

1. Both full audio tracks were decoded once to 16kHz mono signed 16-bit PCM.
   RMS envelopes used complete **0.5s bins**. The full short envelope (188s of
   complete bins) was compared by Pearson correlation against every full-length
   candidate window in D, with **0.5s start steps**. The five strongest separated
   locations were D **6443s, r=0.377926**; **1587s, 0.347889**;
   **675.5s, 0.337801**; **345s, 0.316466**; **5952.5s, 0.313409**.
   Same-start correlation was **0.190837**. None establishes a global match.
2. Six independent 30s short windows were also scanned across D at the same
   cadence. Their highest-scoring starts were not a consistent offset:

   | MZ start | Best D start | RMS-envelope r (0.5s bins) |
   | ---: | ---: | ---: |
   | 0 | 6128.5 | 0.681108 |
   | 30 | 6369 | 0.612508 |
   | 60 | 1301.5 | 0.742860 |
   | 90 | 2249.5 | 0.626398 |
   | 120 | **36.5** | **0.851190** |
   | 150 | 2040.5 | 0.749424 |

3. The possible prelude correspondence **MZ 120–150 ↔ D 36.5–66.5** was
   investigated rather than dismissed. Recomputing at **20ms RMS bins** gives
   **r=0.678879**, including a ±2s lag search in 20ms steps. But the neighboring
   proposed same-offset pair MZ 90 ↔ D 6.5 has r=−0.066845 (maximum **0.100985**,
   MZ adjustment −1.00s); MZ 150 ↔ D 66.5 reaches only **0.187831**, adjustment
   −1.34s. D 0 ↔ MZ 83.5 has r=−0.050103. Thus that isolated envelope similarity
   does **not** establish a continuous prelude excerpt or restart.
4. A separate partial-overlap scan compared D's first 105s against short offsets
   at 20ms steps, requiring at least 60s overlap. Best r was **0.290214** at
   MZ **82.32s**. The envelope self-comparison control returned **1.0**.
   This control checks arithmetic, not an independent audio identity proof.

Different PCM hashes alone cannot exclude transcoded reuse. Envelope correlations
can be high for unrelated quiet/loud patterns; an exhaustive 0.5s-grid scan is not
an exhaustive arbitrary-edit/time-stretch comparison. Repeated background songs
could occur in different captures. Even proof of a shared song would not prove
that the entire videos are duplicates or establish their programme order.

### Derived PCM checksums

Hashes below are over slices of **complete decoded PCM**, not the deleted original
Opus/WebM input and not independently seek-decoded samples. Each listed interval
is 30s / 480000 samples, except the stated MZ tail.

| Video / start | SHA-256 |
| --- | --- |
| D 0 | `15a4ee1751eb2a4cc9b036a479a3fc75f95228f123d04bc753214eacc86f8e6f` |
| D 6.5 | `6b8d723cab20b20c95daf68dd43c0938f9a3fbf4f6c0e51f503029b89e755c3e` |
| D 30 | `6212d21bdf401fb3b578d6c6dc9e559a7bafa3720b859038fe91bb4ac5fe01bc` |
| D 36.5 | `c03498a17dfbb181936b0f2f464e5403b36bdfcbe628deb068eaba94fab3951c` |
| D 60 | `5ad9446d37c49c02b6c48f5b591808eee95fad1268d6876ef83f85a7f59b36f9` |
| MZ 0 | `329b29cec402a348ff4adf50f5d76d7dc1beb921abdab42f63b6044103f56739` |
| MZ 30 | `454875d90b4926f4fda6633c4982c3800060cee1c3c591520e95d0891ea6fdb0` |
| MZ 60 | `702027caf68dcabee7b28c2c68d96b1fcbd01fdeedaa8e840807304e292ea4c3` |
| MZ 83.5 | `9f45b54f20a1a4b59e9870fa8e1542cdb66ce39e340d67f67ed62a3d280084ac` |
| MZ 90 | `70127472dcedc28560d0d3180da82cc64d80316264e3dd0fa62c8e9e52e7d137` |
| MZ 120 | `5732edeacf57179510cf3e05e29243b078e64852ddf6c263db8b54318ed2d465` |
| MZ 150 | `401ba1671d94b48d44c683df0f207e26fa47c89256e8c8ad264adb4964a20cd2` |
| MZ 180, 8.0351875s tail | `36c0d729e606a877701f7a8cf9b110de8e9b276429e2e50e64c0906bbac2ece0` |

### Frame comparison checksums

Frames were independently decoded at the named original seconds, scaled to
**320×180 grayscale**, and hashed over raw pixels. No corresponding pair is
byte-identical. This is not a perceptual-image identity test; different layouts
and encodings can produce different hashes even when a reusable graphic is shared.

| Video / seconds | Grayscale SHA-256 | Visible context |
| --- | --- | --- |
| D 6.5 | `809d16409a5047f64b99fef6f7b368d09106fe7a53138ecc016a62250c0d988d` | Opening sanctuary region |
| D 36.5 | `1b69d8f2201dc83f8bb421bba853884426649db4d4197b1aeeffdc3cdcd39528` | Opening sanctuary region |
| MZ 90 | `1a7eefc62a52508a1b22fcc94a16fdc9544f7ad2afb953753b8602f2e046e057` | ACTS graphic |
| MZ 120 | `d03cc53879d4637cc42c6188fcb8812dddd6f9f5409c442329f4b882d7ceb077` | Empty lectern and monitor |
| D 120 | `e106ee96573e7d873169d4dbe6defd6f080e435ce56ba85f3c80338874f8ca4a` | ACTS with visible leader |
| D 300 | `80308d6d72de92680d5d9678fd068ed016a5fac67e757ea873be82eacdfe9bc8` | ACTS with visible leader |
| MZ 0 | `d13e3bb1e4ce4a92f7b1a78abfc79c01822a5f478fe5d614c25fd2be830c6684` | ACTS without visible leader |
| MZ 60 | `6b7b204e1a168db1e8ccdc1e2949b30f194f5bb40d2a96d52be702d9503cabb0` | ACTS without visible leader |
| MZ 100 | `c4c90513098c683682ba4f6ba60198382204a65d145e15f07b819b79fe55eead` | Larger ACTS graphic |
| MZ 180 | `8cc296ed49e59f11dbd9bd8043dd88e878716b7b9cf0990fc04c2cec5700084b` | Empty lectern |

**Decision:** neither a complete duplicate, constant-offset prelude excerpt nor
multipart restart is established. Preserve the short candidate and its potential
worship content with uncertainty. D's independently proven distinct July 12
programme does not become unassessed merely because the short clip remains open.

## Focused validation and handoff

- `pnpm validate:archive`: **passed**, **9 interpreted services** at this check.
  Initial validation found two unquoted comma-containing flow-YAML chapter titles;
  quoting them fixed both schema errors before the passing run.
- Read-only case assertions passed: correct physical IDs and one-video sequence 1
  per record, strict schema, `complete` / `needs_review`, absent approval fields,
  actual durations, exact receipt projections, whole converted/raw segment equality,
  original language/span, contiguous full-source chapters/passages and containment.
- Actual in-memory archive projection: **94 D passages in preview**, **0 MZ
  passages in preview**, **0 scoped production passages**. Current workspace total
  **629 preview / 0 production**; these totals include other existing services.
  Scoped preview navigation contains only `2026-07-12`.
- In-memory D copies set to each of unassessed/failed/rejected yielded zero preview
  passages. No source disposition was changed for this check.
- Public passage serialization contains no engine provenance, audio hashes or
  private paths. The uncorroborated short-clip web-address phrase is absent from
  public fields. Review notes retain the uncertainty for human inspection.
- No broad tests, search tests, search execution, model evaluation or site build
  was run during this curation. Main owns final integration/browser/search checks;
  no claim of fresh browser playback or milestone completion is made here.
- No schema, application code, search code, manifest, run log or Git commit was
  changed by this case. All interpretation remains unapproved.

### Human review priorities

1. Confirm D's visible July 12 date correction and displayed sermon title.
2. Resolve MZ's title versus July 16 release and intended use through operator
   knowledge/listening; assess possible shared background music without converting
   it into a global duplicate claim. Preserve musical worship even if no lyrics
   can be published. Assign playable only when its intended suitability is resolved.
3. Listen to uncertain wording, Chinese/dialect expressions, names, financial
   quantities, offering designation and announcements. Do not import missing
   details from other dates or treat omitted excerpts as full verbatim transcripts.
4. Review the preacher's strong statements about trials, despair and other groups
   in context, including his explicit rejection of guaranteed wealth/health and
   qualification that joy does not mean constant daily happiness.
5. Review all proposed passage/chapter cuts, music/prayer units and partial ASR
   regions before any human-only approval.

## Verified cleanup

`media.py cleanup` returned **`cleaned: true`** for each sentinel-owned root;
the local wrapper confirmed each root **absent** afterwards. Removed artifacts
include both acquired videos, coarse/refined frames and contact sheets, complete
decoded audio, samples, raw grayscale comparisons, spectrum, metadata, converted
evidence and private import receipts. All **four** external helper/check scripts
were then removed. Final external-parent inspection showed only the pre-existing
model-cache, preflight and browser-cache directories, with no July 12 roots or
helpers. The now-empty former July 5 comparison directory was also removed.

Final original-audio checks:

| Target | Local batch-audio root | Designated Drive audio root |
| --- | --- | --- |
| `D-FyolbxJgk.webm` | Absent | Absent |
| `MZr169xBwrU.webm` | Absent | Absent |

The local batch root was empty; the Drive root's 40 unrelated basenames remained.
**Zero original source-audio files were deleted.** No `cleanup-audio` operation
was run against a false-verification receipt. Both target raw JSON files, README,
SHA256SUMS and unrelated bundle inputs remain present. The exact safe provenance
projections and measurements survive in YAML/this report; full private receipts
and converted evidence were intentionally temporary, as requested.

Final scoped whitespace checks passed for both service files and both review
documents. Git status was inspected without modifying concurrent main/search
work. The four final authored files are the two July 12 `service.yaml` files,
this report and the additive final-disposition link in `july5-comparison.md`.
No commits or editorial approval occurred.
