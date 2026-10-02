# Tripping — 19 July 2020

## Result and scope

`services/2020/2020-07-19/service.yaml` contains **26 sections and 59 passages**
for `Z-vRVB-WucA`. Processing is `complete`; interpretation remains
`needs_review`; the physical upload is `playable`. This follows the operator’s
flag-and-continue instruction and is not editorial approval.

Preserved trusted metadata:

- Title and sermon title: **Tripping**.
- Date: **19 July 2020**.
- Preacher: **Rev. Yong Teck Meng**.
- Main references: **Luke 17:1-9; Matthew 18:5-7**.

The opening frames independently confirm the title and both references. Date and
preacher name remain operator-attributed; no identity is inferred from appearance.
The source is a sermon-focused upload, so its source `type` is `sermon`, not an
invented complete worship service. It includes a greeting, discussion of restricted
worship, recap, prayers, exposition and an embedded illustration.

Only this service and this review document were authored for the case. No run-log,
evaluation, application, unrelated service, registration or input-manifest edits,
commits or approval changes are part of this handoff.

## Acquisition, import and integrity

Authorized full acquisition used `scripts/media.py acquire`, explicitly passing
the current confirmed, ignored authorization record. The workspace was a fresh
sentinel-owned child of the approved external temporary root. Native/project
commands ran sequentially through `scripts/devenv-run`, with **900-second native
and wrapper limits** and a **940,000ms tool wait**. Media tooling checked at least
2 GiB free before downloading and verified the exact RECS channel
`UCLjwcZaIkiFEed1VgQYSsrw` and video ID before acquisition.

The existing primary-devenv toolchain evidence was reused. Fresh acquisition
reported yt-dlp **2026.08.19**, FFmpeg/ffprobe **8.1.2**, and the same whisper.cpp
executable fingerprint documented in `preflight-evidence.md`. No inference was
run: no media preflight, local ASR, remote ASR, Colab execution or VM dispatch.

| Measurement | Verified value |
| --- | --- |
| Recording metadata duration | 4006 seconds |
| Acquired source duration, ffprobe | **4005.801 seconds** |
| Independent repeat ffprobe | **4005.801 seconds** |
| Full acquired span | 0–4005.801 seconds |
| Supplied transcript duration | **4005.778875 seconds** |
| Transcript minus source, receipt float | **−0.022124999999959982 seconds** |
| Source minus metadata | −0.199 seconds |
| Original language | `en` |
| Complete timing scan | **753 segments / 11,457 words** |
| Converted identity/text/timing/word correspondence | All segments equal to raw input |
| Tail clamps / backtracking / segment overlaps | **0 / 0 / 0** |
| Word-boundary warnings | **18 on 18 segments; maximum 0.28 seconds** |

Imported with `scripts/import_transcript.py import`, using the operator bundle’s
`Z-vRVB-WucA.json`, `SHA256SUMS`, both designated audio roots, the acquired owned
workspace, the explicit authorization record and **`--allow-missing-audio`**.
Checksum, approved engine/settings, finite numeric bounds, original language,
elapsed/RTF consistency, source identity and duration all passed. A second
field-by-field comparison confirmed every raw/imported segment’s ID, start, end,
text and full word array were identical. Timestamps were not rescaled, rounded,
sorted or silently repaired.

The warnings are genuine source word/segment alignment differences, not integrity
failures: segment IDs **27, 78, 87, 271, 298, 318, 353, 376, 385, 416, 417, 520,
556, 592, 610, 646, 728 and 729**. The largest offset is on segment **592** in the
dress/protest discussion. These remain editorial uncertainties rather than fatal
import errors or permission to invent new word timing.

### Safe per-recording provenance

`videos[0].transcription_provenance` exactly equals the importer receipt’s
`archive_provenance`; this equality was asserted against the local receipt before
cleanup. The whole receipt, root identities and private paths are not copied into
the archive. Safe source identifier: **operator-provided RECS Replay Colab bundle,
2026-09-25; relative input `Z-vRVB-WucA.json`**.

| Field | Value |
| --- | --- |
| Engine | faster-whisper 1.2.1 |
| Backend | CTranslate2 4.8.2 |
| Model | large-v3-turbo |
| Compute / device | float16 / Tesla T4 |
| Settings | beam size 5; word timestamps true; VAD false; condition_on_previous_text false |
| Operator GPU elapsed | **131.099 seconds** |
| Operator GPU real-time factor | **0.03273** |
| Transcribed at | `2026-09-25T11:25:45.022549+00:00` |
| Transcript SHA-256 | `fcee2e5cb423e6e347445bb7aab1882f83bc65a2df8a669b75f194a2c356a1bb` |
| Supplied original-audio SHA-256 | `9ebb1d6a7faebb8607b365f0d1c30fbd04903560ab5ef9fb0fa95837706d36fd` |
| Original audio hash independently verified | **false** |

The original target WebM was already absent from **both** `$BATCH_AUDIO_ROOT` and
`$DRIVE_AUDIO_ROOT`, consistent with the operator’s updated bundle README. No
re-encoded sample or reacquired video is represented as proof of those original
audio bytes. GPU elapsed and RTF are the operator’s recorded inference results,
not local import/acquisition timings. The full supplied span is retained rather
than being described as locally chunked or trimmed inference.

### Bounded refinement retry

The first refined-frame extraction attempt returned the safe native error
`Native tool failed (exit 234); raw output suppressed`. Its installed failure
handler removed the owned workspace, including acquired media and imported
evidence. The exact failing timestamp was not recorded in that attempt, so a
cause is not claimed.

One bounded reacquisition/import/sampling retry succeeded with the same hashes,
source duration and transcript. The final requested frame was moved from 4005.7s
to **4005.0s**; all requested refined frames then decoded, as did the **entire
audio stream**. This is successful source decoding and usable media evidence, not
a claim that the earlier error proved corruption or was definitively diagnosed.

## Programme, frame and audio evidence

Coarse sampling extracted **14 thirty-second audio windows** and frames at
`0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 3900s`.
All coarse frames were visually inspected. Refinement added **29 inspected
frames** at:

```text
0, 10, 40, 290, 295, 870, 930, 1188, 1347, 1696, 1705, 1912,
2105, 2140, 2558, 2895, 2935, 2985, 3143, 3365, 3525, 3560,
3593, 3648, 3706, 3878, 3937, 3998, 4005
```

Seven further audio windows covered **0–60, 1680–1725, 1890–1935, 2890–2970,
3520–3610, 3635–3695 and 3930–4005.801s**. The entire source audio stream also
decoded to a null sink successfully. **Audio was decoded/extracted, not listened
to.** Do not upgrade these checks into a listening-verified transcript or a claim
that every untranscribed moment is silent.

| Original time | Observed evidence and decision |
| --- | --- |
| 0 / 10 / 40s | Title slide: Tripping, Luke 17:1-9, Matthew 18:5-7. Preacher present; supplied greeting starts 1.84s. Programme starts at physical 0, with no invented waiting/prelude cut. |
| 290 / 295 / 300s | Title changes into the previous-sermon recap. 300s slide gives Where the sun does not shine, Luke 16:19-31 and Matthew 8:11-12. Recap starts at speech boundary 291.72s. |
| 600s | Slide discusses hell and absence of God; matches the recap rather than a separate reading. |
| 870 / 900 / 930s | Prayer image and preacher posture, with supplied prayer at 872.26–approximately 930s. Next speech discusses interpreting Luke. |
| 1188 / 1200s | Series of Teachings slide and Romans 1:17. |
| 1347 / 1500s | Link to the rich man and Lazarus, followed by Of Trials and Temptations. |
| 1696 / 1705 / 1800 / 1912s | Marshmallow-test setup slide, clip title, then children in the embedded clip. Sermon introduction ends 1695.72s; preacher resumes at 1915.7s. |
| 2100 / 2105 / 2140s | Genesis 3:17-18 and then 1 Peter 5:8 visible, supporting the additional references even where ASR misses part of a reading. |
| 2400s | Slide attributes the trials/growth formulation to Rev. Dr. Stephen Tong. |
| 2558 / 2700 / 2895s | John 8:31-32 slide; matches exposition about knowing truth and resisting temptation. |
| 2935 / 2985s | Matthew 18:6 warning, then millstone illustration. |
| 3000 / 3143 / 3300s | Direct Causes: Sin Industries, then Direct Causes: Sinful Lifestyles with the protest image. |
| 3365s | Subtle, indirect Causes; supplied discussion turns to hypocrisy and neglect. |
| 3525 / 3560 / 3593 / 3600s | Millstone image followed by How far should we go? with 1 Corinthians 8:8-9 and 13. |
| 3648s | Instead of causing others to sin — Recover them. |
| 3706 / 3878s | Back to Faith, then Luke 18:8b. |
| 3900 / 3937s | Take your faith seriously concluding slide; supplied speech moves into prayer at approximately 3937s. |
| 3998 / 4005s | Apostles’ Creed slide while preacher and supplied speech remain at the closing prayer. Final Amen ends 4004.64s; physical duration is 4005.801s. No creed recitation invented. |

All raw/imported speech was reviewed in overlapping chronological windows, with
the adjacent context retained across the approximately ten-minute boundaries.
The only intersegment gaps of at least 30 seconds are **1758.98–1796.26s** and
**1820.88–1878.94s**, both inside the visually confirmed embedded clip. Its
three passages retain those visual/waiting intervals and supplied dialogue with
role labels, without assigning clip speech to Rev. Yong Teck Meng. They do not
claim direct listening verification of silence or background sound.

Sections and passages both cover **0–4005.801s contiguously**, on the original
upload clock. Section boundaries reflect major thoughts; passages generally run
30–90 seconds. Three modest exceptions preserve complete comparisons/thoughts:
the research discussion (90.72s), growth paradox (94.04s), and Luke/Matthew warning
(95.62s). Short pauses, greetings, original commentary and the closing prayer are
represented. The 930s and 3937s within-segment prayer cuts remain approximate.

## Editorial treatment and uncertainties

- Text is **edited ASR-derived speech**, not a verbatim certified transcript.
  Punctuation/capitalization are normalized and excessive fillers/repetitions
  reduced. Unclear words, names and short clauses have explicit markers. The
  complete source JSON remains available externally for further review.
- All summaries attribute interpretations to the preacher or, for the embedded
  video, to its unnamed participants. Questions are answerable from the actual
  argument rather than asserting new doctrine.
- Scripture quotations, repeated readings and close retellings are replaced by
  explicit reference-only markers. Surrounding commentary is retained, including
  his explanations of temptation, judgment, practical safeguards, hypocrisy,
  rights and forgiveness. No Bible wording was supplied from memory. No song
  lyrics are stored; the wedding song is named only.
- Trusted **Luke 17:1-9** remains intact although the speaker says he ends the
  exposition at verse 6. The Matthew parallel actually quoted is 18:6-7 within the
  trusted **Matthew 18:5-7**. Prior readings mentioned in speech are not fabricated
  as independent sections of this upload.
- Additional reference evidence includes the recap slide, explicitly cited
  Matthew 25 and Romans 1:16-17, displayed Genesis 3:17-18, 1 Peter 5:8,
  John 8:31-32, 1 Corinthians 8:8-9 and 13, spoken Psalms 119, and spoken/displayed
  Luke 18:8. Exact unspoken references for Isaiah, James and other allusions were
  not guessed.
- ESV API terms were rechecked at <https://www.esv.org/api/> on **2026-09-26**:
  the 500-verse/half-book local-storage limits and stated request limits remain.
  This case uses **reference-only ESV links** through the existing site formatter;
  no ESV text is added to repository or generated artifacts.
- Historical and research assertions remain unverified: the shellfish/dye count
  (which the preacher himself questions), claims about liberal commentators and
  personal prayer, media bias, the marshmallow study, casino policy, generalized
  church scandals, and the Gandhi quotation/anecdote. The ASR’s recently deceased
  theologian name is not silently corrected from biography or memory.
- The dress/assault argument is attributed without concealing its victim-blaming
  implications or turning it into an archive causal finding. Political opinions,
  denominational criticism and strong language remain the speaker’s claims.
- The closing phrase transcribed as “being displeased by God” is grammatically
  uncertain and retained with a review note. No correction from imagined audio.
- Missing original audio-byte verification and all 18 alignment warnings remain
  explicit under `needs_review`; processing completion does not resolve them.

## Candidate passages for main-agent evaluation

No search scoring, aliases, evaluation thresholds or acceptance cases were changed.
These are evidence-backed targets for the main agent’s passage-specific evaluation.
Times are absolute seconds of **`Z-vRVB-WucA`**.

| Passage ID | Start–end | Why it is a candidate |
| --- | --- | --- |
| `p0719-think-beyond-self` | **3586.02–3639.54** | Strong practical answer: consider our impact on others instead of insisting on rights; application of 1 Corinthians 8:13. |
| `p0719-rights-stumbling` | **3521.68–3586.02** | Explains how exercising a legitimate right may harm a weaker believer and requires wisdom. |
| `p0719-restore-forgive` | **3639.54–3696.88** | Positive alternative: recover, love and forgive people rather than cause them to fall. |
| `p0719-hypocrisy-stumbling` | **3363.8–3436.96** | Identifies hypocrisy, meanness, hurtful conduct and neglect as indirect stumbling blocks. |
| `p0719-direct-stumbling` | **2984.46–3055.92** | Direct application to occupations and activities the preacher says harm others. |
| `p0719-luke-matthew-warning` | **2888.84–2984.46** | Best direct comparison for the two trusted main references and the millstone warning. |
| `p0719-take-faith-seriously` | **3883.92–3937** | Concluding appeal to practice faith and avoid becoming a source of temptation. |

Three bounded deterministic source-search checks, with no model inference, found:

- **How can we avoid causing others to stumble?** — ranks 1–3:
  `p0719-rights-stumbling`, `p0719-think-beyond-self`, `p0719-restore-forgive`.
- **Luke 17:1-9** — rank 1 `p0719-faith-to-faith`, rank 2
  `p0719-luke-matthew-warning`; both belong to Tripping. The second is the stronger
  direct text-comparison candidate for passage-level evaluation.
- **Matthew 18:5-7** — rank 1 `p0719-luke-matthew-warning`.

These are source-projection exact-search observations, not full hybrid-model,
built-artifact or browser acceptance. The main agent owns those checks and the
final passage-specific acceptance set.

## Focused validation and actual inventory

`pnpm validate:archive` passed. A bounded read-only source check also passed:

- Trusted metadata and both references; actual duration and full-span coverage.
- Strict archive loading, globally unique IDs, bounds and containment.
- Contiguous sections and passages, from 0 to the measured physical end.
- Exact equality of authored provenance and the receipt’s safe projection.
- Existing core inventory assertions, dynamic media exclusion, all services
  `needs_review`, and **zero production services/passages**.
- Preview projection contains no audio/transcript hashes, engine provenance,
  private local paths or account identifiers.

The temporary TypeScript checker initially used a `.ts` filename outside the
repository’s ESM package scope, causing a CJS/top-level-await loader error before
assertions ran. Renaming that owned helper to `.mts` resolved it; the assertions
and three source searches then passed. No application/tooling change was made.

Counts below were computed from the **actual current archive**, not assumed from
earlier run-log totals:

| Service | Physical uploads | Sections | Authored passages |
| --- | ---: | ---: | ---: |
| 2026-09-13 | 1 | 40 | 91 |
| 2026-09-06 | 1 | 22 | 77 |
| 2026-08-16 | 3 | 41 | 72 |
| 2026-07-12 | 1 | 43 | 94 |
| 2026-07-12-mzr169xbwru | 1 | 1 | 1 |
| 2026-07-05 | 1 | 36 | 98 |
| 2026-06-28 | 2 | 42 | 87 |
| 2025-11-02 | 1 | 21 | 47 |
| 2020-09-27 | 1 | 32 | 63 |
| **2020-07-19 — Tripping** | **1** | **26** | **59** |
| **Total** | **13** | **304** | **689** |

The six-service corpus before the July additions and Tripping remains intact.
The current projection has **9 preview services / 688 preview passages**, and
**0 production services / 0 production passages**. Eleven uploads are playable;
failed `wh4mCRKRJ-4` and unassessed `MZr169xBwrU` are excluded from both ordinary
projections. The latter’s one authored passage explains the difference between
689 authored and 688 preview passages; this case does not change its disposition.

No broad test suite, build, embedding evaluation or browser run was undertaken for
this bounded content task. Main-agent milestone verification remains separate.

## Cleanup

- Sentinel-validated media cleanup removed the entire owned workspace: acquired
  video, 14 coarse samples/frames, seven boundary audio windows, 29 refined frames,
  contact sheets, imported evidence, local receipt and derived review text.
- The original supplied JSON remains unchanged. A final byte rehash still equals
  `fcee2e5cb423e6e347445bb7aab1882f83bc65a2df8a669b75f194a2c356a1bb`.
- Target `Z-vRVB-WucA.webm` is absent from **both** designated source-audio roots.
  No `cleanup-audio` call was made because `audio_hash_verified` is false; no
  claim is made that this run deleted the already-missing original audio.
- The local batch root had **0 entries** and the Drive audio root **37 unrelated
  entries** at final cleanup. Names, sizes and modification timestamps of those
  entries were unchanged across workspace cleanup. No root sweep or unrelated
  audio deletion occurred.
- The separate verified whisper model cache remains present. Both owned external
  helper files were removed after use. No media, raw JSON or local receipt was
  added to the repository.
- Final process inventory found no running `yt-dlp`, `ffmpeg`, `ffprobe`,
  `whisper-cli` or `whisper-cpp` executables. Both owned repository files passed
  whitespace/diff checks; unrelated working-tree edits were preserved.
