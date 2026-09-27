# Sacrifice — final Milestone 2 logical case

## Result and scope

Processed **2 November 2025**, physical upload **`94fynFHtreg`**, as the
pre-trimmed sermon **The Death That Brings Life: Sacrifice**. The archive record is
`services/2025/2025-11-02/service.yaml`: **21 sermon chapters / 47 passages**,
one playable video, service/video processing `complete`, editorial status
**`needs_review`**. All passage durations are **32.98–86.60 seconds**. Sparse
reading-dominant excerpts are intentional; no word-count padding or reconstructed
Bible text was added.

The trusted date, full displayed title and **Genesis 22:1-19 / Romans 12:1-2**
are preserved. Both `title` and `sermon_title` retain the supplied full title.
Opening frames at 0, 10 and 70 seconds confirm title and references. No
preacher-name caption was found: speaker remains **unknown**. Opening speech says
Reverend Yong is away and mentions Brother Hadi; neither name identifies the
person delivering this sermon. No identification was made from appearance.

This is a case-level content completion, not the integrated Milestone 2 browser,
semantic-ranking or delivery checkpoint. No app code, other services, shared
documentation, corpus records or run log were edited by this case. No commits,
approval or publication were performed. This review is the scoped handoff record.

## Source verification and import

Current operator-confirmed authorization was passed explicitly to acquisition,
sampling and import. Its local record passed Git ignore checking and remains
untracked. Commands ran sequentially in the primary pinned environment through
`scripts/devenv-run`, with **900-second outer bounds** and **900-second media
native bounds**. An external stage helper installed failure/interruption cleanup
before acquisition and used an additional finite 850-second subprocess deadline.
No concurrent case or devenv evaluation was started. Initial free disk space was
approximately **64 GiB**.

The canonical curator procedure, shared README, Milestone 2 prompt, run log,
archive/import/media documentation, schema, existing service example and supplied
bundle README/checksums were read before authoring. No local or remote ASR,
whisper preflight, model inference, Colab execution or VM dispatch occurred.
Previously documented toolchain evidence was reused; acquisition checked native
versions without inference.

| Verification | Result |
| --- | --- |
| Requested/verified video | `94fynFHtreg` |
| Verified channel | `UCLjwcZaIkiFEed1VgQYSsrw` |
| Acquisition | Full recording, no `--sections`; usable audio and video |
| Recording metadata duration | 3104 seconds |
| Acquisition ffprobe / independent repeat ffprobe | **3104.181 seconds**, both |
| Manifest acquisition span | 0–3104 seconds; metadata is integer-floor |
| Supplied transcript duration / imported full span | **3104.1706875 seconds / 0–3104.1706875 seconds** |
| Transcript minus actual source | **−0.01031250000005457 seconds**; inside 2-second importer tolerance |
| Source minus recording metadata | +0.181 seconds |
| JSON checksum | Verified against exact `SHA256SUMS` entry |
| Engine/settings, metadata and timestamp scan | Passed, complete scan |
| Segments / words | **758 / 6,152** |
| Original language | `en`, preserved; no translation |
| Converted correspondence | All 758 segment text/start/end/word arrays equal supplied JSON |
| Segment overlaps / backward starts / tail clamps | **0 / 0 / 0** |
| Zero-duration words | **1**, retained |
| Original-audio verification | **False**; zero verified copies, both designated roots empty |

Safe bundle identifier: **operator-supplied 2026-09-25 Colab bundle**, relative
file `94fynFHtreg.json`. Original JSON was retained unchanged. SHA-256 values:

- **Verified transcript:**
  `e3ef25792ddfea1f8cc53a277548f95a6da8e492e1b87e5473a0734a369942c0`
- **Supplied original audio, not reverified:**
  `64d38620b9dd4da1be134cebd3c9ae51e3d067a27bf5624a864471459350f37a`

Import used the documented `scripts/import_transcript.py import`, with source
JSON, `SHA256SUMS`, acquired owned workspace, explicit authorization, **both**
operator-designated `--audio-root` arguments and **`--allow-missing-audio`**.
Both root directories were accessible and empty; the operator bundle README
records deletion on 2026-09-25. Reacquired inspection media is not substituted
as proof of the original audio bytes. No restoration was requested and
`cleanup-audio` was not called because `audio_hash_verified` is false.

Exactly `receipt.archive_provenance`, not the private receipt, is stored in the
video’s **`transcription_provenance`** field. A read-only assertion compared the
parsed object to the receipt and passed. Strict schema rejection of an extra
private-path key passed. Hashes/engine provenance are excluded from frontend
display/search projections by their existing allowlists.

### Recorded engine and timings

- **faster-whisper 1.2.1 / CTranslate2 4.8.2**; **large-v3-turbo**;
  **Tesla T4 / float16**.
- Beam size **5**, word timestamps **true**, VAD **false**,
  `condition_on_previous_text` **false**.
- Operator-recorded inference elapsed: **97.754 seconds**;
  **RTF 0.03149**. Importer verified elapsed/duration consistency within the
  documented five-decimal rounding tolerance. These are supplied GPU timings,
  not local processing timings.
- Supplied transcription date: **2026-09-25T11:10:07.695862+00:00**.
- Measured local stages: acquisition **34.743s**, coarse sampling **6.195s**,
  import **0.570s**, repeat-probe/correspondence/refined sampling **6.251s**.
  These exclude environment startup and editorial reading/writing time.
- Primary native versions: yt-dlp **2026.08.19**;
  ffmpeg/ffprobe **8.1.2**. The checked whisper executable fingerprint agrees
  with prior pinned package evidence; it was not used for transcription.

## Evidence, programme and chapters

Read all **758 lines of canonical `evidence.txt`**, including adjacent context
around chapter and passage cuts; reviewed the full 0–51:40 speech progression.
The imported recording is not labelled as local 600/555-second inference chunks.
Passage boundaries follow completed source thoughts, not fixed-size ASR blocks.
Transcripts are edited ASR-derived excerpts with omission/uncertainty markers,
not complete verbatim transcripts.

**Eleven 30-second coarse audio windows** were extracted at 0, 300, …, 3000
seconds, with frames at each start. **Eighteen refined frames** were inspected
at 10, 55, 70, 940, 960, 980, 1000, 1460, 1475, 2165, 2175, 2190, 2416, 2435,
3046, 3075, 3100 and 3103 seconds. **Five additional 30-second audio windows**
were decoded at 940, 1450, 2160, 2400 and 3074 seconds. All **29 frames** were
visually inspected. Audio files were extracted/decoded but **not listened to**;
there is no claim of listening-verified wording, silence or word-level alignment.

Playability is supported by channel/ID verification, successful full media
acquisition, usable stream probing, repeated sample decoding, visible sermon
content and matching transcript subject matter. It is not based on duration
alone, original-audio byte verification or a live browser playback claim.

| Recording interval | Chapter treatment / evidence |
| --- | --- |
| 0–86.60s | Greeting, the sermon’s own prayer and title; no waiting prelude inferred |
| 86.60–188.80s | Sacrifice versus loss and everyday examples |
| 188.80–461.52s | Earlier tests of Abraham’s faith |
| 461.52–840.22s | Isaac as promise, joy and treasure; Genesis slides corroborate topic |
| 840.22–1031.56s | Moriah, child-sacrifice objection and the speaker’s interpretation of the test |
| 1031.56–1294.90s | Obedience, contrast with Sodom and mature trust |
| 1294.90–1640.72s | Journey, imagined emotional cost and Isaac’s possible age |
| 1640.72–1882.36s | Father-son exchange, interpreted submission and divided loyalties |
| 1882.36–2165.94s | Provision, blessing and comparisons between Isaac and Christ |
| 2165.94–2399.24s | Song introduction, response to mercy, journaling and remembered dedication |
| 2399.24–2713.78s | Daily surrender, everyday worship, renewed priorities and fruitfulness |
| 2713.78–2947.64s | Trials, muscle-training analogy and ordinary service |
| 2947.64–3045.02s | Reflection questions and conclusion |
| 3045.02–3104.181s | Closing prayer and short visual tail; final ASR Amen ends 3100.14s |

These interval groups summarize **21 actual chapters**, distinct from 47 smaller
searchable passages. Service, chapters and passages are all `type: sermon`.
Embedded prayers are described within the sermon, not invented full-service
programme sections. Earlier responsive reading and worship are mentioned but not
presented as contents of this upload. At **3103s** a creed slide appears after
the closing Amen; no creed speech or chapter is fabricated. Full imported span
is retained, and ordinary two-minute context margins clip to recording bounds.

## Editorial uncertainty retained

1. **Speaker identity remains unknown.** Trusted date comes from operator
   metadata, not a visible date/name caption.
2. **Source alignment:** 14 word-boundary warnings on source IDs 30, 87, 167,
   210, 216, 227, 229, 432, 488, 490, 655, 658, 663 and 749, maximum **0.36s**.
   No overlap/backtracking or broad timestamp normalization was needed. The
   region around **16 minutes** retains a specific caution: frames at 940/960s
   show Leviticus 20:1-3; 980/1000s return to the test-of-sacrifice argument.
   This corroborates topic progression, not exact audio alignment.
3. **More-than-16-second gap:** no ASR segment at **1460.08–1477.46s**
   (**17.38s**). Frames at 1460/1475s show Genesis 22:5-6. It is explicitly a
   source-ASR gap, not verified silence, and its words are not reconstructed.
4. **Stretched segment:** the short clause at **2416.24–2435.92s** spans
   **19.68s**. The daily-surrender passage retains that source-alignment warning
   without shifting timestamps. Human listening should verify the passage cut.
5. **Song transition:** the 2175s slide reads *Sacrifice / By Bob Fitts*, supporting
   correction of ASR “Fitz”. The speaker asks for the song, then returns to slides
   within seconds. No full song performance, lyrics or missing-song duration is
   invented. Its apparent editing/transition needs human review.
6. **Uncertain wording remains marked**, including cost/cause, garbled early
   narrative names, witness/weakness, rested/wrestled, “only present”,
   feeling/failing and the final place-name wording. Obvious punctuation and
   limited word-form normalization are documented; no silent translation.
7. **Interpretive claims remain attributed:** Isaac called “firstborn” despite
   the later Ishmael discussion; Abraham’s imagined private feelings and three
   nights; distance/age estimates; Josephus attribution; Isaac’s relative strength
   and voluntary submission; historical/geographical claims and theological
   comparisons. The archive does not resolve these by doctrinal or Bible memory.
8. Original Colab audio bytes are unavailable. JSON integrity and independently
   acquired source checks do not erase that limitation. Confidence scores and
   processing completion are not human editorial approval.

## Scripture and quotation handling

Rechecked <https://www.esv.org/api/> on **2026-09-25**. The recorded storage and
rate limits remain consistent with the shared contract; reference-only links
remain the chosen approach. No ESV verse text was requested or copied into the
archive. Direct readings, embedded quotations and conservative narrative omissions
have explicit markers retaining their recording intervals. Unannounced references
are left uncertain rather than reconstructed from memory. No song lyrics are
stored. The original spoken English is retained.

Existing source-pinned **BSB** enrichment was called **read-only** for search
verification through `enrichPassages`, using the same enrichment function as
`scripts/archive.ts`’s `buildIndex`. No query-specific code or score adjustments
were added. BSB text remains hidden search input, not a displayed substitute for
the church’s ESV reading. A control with authored lexical text removed still
matched `living sacrifice` solely with **`Verse-text match (BSB)`**.

## Validation and exact search candidates

Commands ran sequentially via the bounded wrapper:

```sh
scripts/devenv-run pnpm validate:archive
scripts/devenv-run pnpm exec vitest run tests/archive.test.ts tests/browse.test.ts tests/player.test.ts tests/search.test.ts tests/scripture.test.ts
scripts/devenv-run python3 -m unittest discover -s tests -p test_import_transcript.py
```

- Archive validation passed: **5 logical services / 8 physical videos**.
- **221 TypeScript tests passed**, **3 optional inference tests skipped**;
  5 files passed, runner **4.95s**. The opt-in inference environment variable
  was explicitly unset for the run.
- **38 importer tests passed**, runner **0.583s**; synthetic fixtures only.
- Read-only real-content checks passed: exact receipt equality, strict extra-key
  rejection, full title on home display, unknown speaker, all-sermon structure,
  physical video identity, preview labelling and provenance exclusion.
- **Production projection: 0 passages. Preview projection: 346 passages**, of
  which **47** belong to this case. Failed `wh4mCRKRJ-4` is absent from results.
- Initial validation caught three unquoted commas in flow-style chapter titles;
  quoting them resolved the strict-schema errors. An external `.ts` verification
  helper initially hit CommonJS/top-level-await incompatibility; using `.mts`
  resolved it. Both fixes are included in successful final checks.

Exact queries against the whole preview projection with BSB enrichment, using the
existing deterministic search and **no embeddings/inference**:

| Query | Rank | Passage ID | Original video | Start–end seconds |
| --- | ---: | --- | --- | --- |
| `Abraham and Isaac` | **1** | `p1102-abraham-isaac` | `94fynFHtreg` | **1640.72–1706.96** |
| `living sacrifice` | **1** | `p1102-living-sacrifice` | `94fynFHtreg` | **2399.24–2444.22** |
| `living sacrifice` | 2 | `p1102-remembering-mercy` | `94fynFHtreg` | **2224.24–2298.86** |

Canonical passage routes are
`/replay-check/watch/?id=p1102-abraham-isaac` and
`/replay-check/watch/?id=p1102-living-sacrifice`. Their IDs resolve to the physical
video and exact passage bounds above; ID-based navigation retains the soft endpoint.
Plain YouTube links use integer-second starts. Live embedded playback and responsive
production/preview builds were not rerun in this bounded content task. The main
Milestone 2 integration pass still owns those checks; current checked-in content
projections are not a claim that an old generated preview was rebuilt.

## Cleanup and handoff

The separate sentinel-owned curation workspace was removed after final receipt and
content verification (`media.py cleanup` returned `cleaned: true`), including
acquired media, all 16 audio windows, all 29 frames, manifest, converted evidence
JSON/text and private receipt. External
inspection, lifecycle and verification helpers were removed as well. Failure and
interruption handling was installed before acquisition; no media/import stage
failed in this run. The formatting and helper-runtime failures above did not
create separate failed media workspaces.

Both designated original-audio roots are recorded **already absent/empty**, not
“deleted by this run”; zero original files were deleted and no audio-cleanup
success is claimed. The supplied raw JSON bundle and separate model cache are
retained; the raw JSON SHA-256 was rechecked unchanged immediately before cleanup.
Final directory inspection confirmed the case workspace and all three helpers
absent, both original-audio roots empty, and the model binary/receipt retained.
Process inspection found no surviving media native, case-helper or devenv-shell
process. Whitespace checks passed; final Git status showed only the two intended
case additions beyond the pre-existing worktree changes.
Next main-agent step: integrate the five-case Milestone 2 build/browser
acceptance and human review workflow; this case itself remains `needs_review`.
