# Operator Decision: YouTube Captions as Chapter Source for Historical Batches

Decided by the operator on 2026-09-26. Applies to historical batches after batch 001 (it does not
change work already in progress). It builds on
[`2026-09-26-chapter-search.md`](./2026-09-26-chapter-search.md) and amends the README rule that
YouTube captions are supplemental evidence only.

## Decision

Under the chapter model, transcripts are private working material used to find chapter
boundaries, keywords, topics and chapter vectors; they are never published. For that purpose,
YouTube's current-generation automatic captions (`en-orig`) are accurate enough. A comparison on
2026-09-26 against faster-whisper transcripts found about 5–10% word differences on normal
services and sermons (mostly filler, hymn lyrics and small slips), but unusable output on
old-generation captions and heavy disagreement on mixed-language services.

1. For historical recordings, a caption-derived transcript that passed the quality gate may be
   used instead of transcribing audio. Precomputed ones are in `~/RECS-colab/transcripts/`
   with `engine.name: youtube-auto-captions`.
2. **Quality gate** (applied when the captions were fetched): `en-orig` track present; word
   count plausible for the duration; at least 90% of words are ordinary English dictionary
   words. Recordings that failed are listed in `~/RECS-colab/caption-failures.json` and are
   transcribed from audio instead (operator-approved batch transcription).
3. The curator still verifies source and duration, still checks programme and sermon boundaries
   against audio samples or frames where the transcript is ambiguous, and records the transcript
   engine per video. If a caption transcript looks wrong for a span (garbled, missing speech,
   another language), sample the audio for that span or request an audio transcription; do not
   guess.
4. Chapter summaries must not quote captions as exact wording. Keywords may use caption words.
5. **Milestone 5 (weekly operation):** combined with the chapter model, the weekly service
   needs chapters, not a publishable transcript. So:
   - Deterministic discovery (unchanged) registers the new upload. YouTube usually publishes
     `en-orig` captions within hours to a day of a livestream ending.
   - The person-invoked weekly curator run first tries the captions with the same quality gate.
     If they pass, it uses them and skips downloading and transcribing the full audio, only
     sampling audio/frames where boundaries are unclear.
   - If captions are missing or fail the gate, it falls back to the existing local whisper.cpp
     pipeline, unchanged. Do not add a hosted transcription API to the weekly workflow.
   - Recommend running the weekly curation a day after the service (for example Monday) so
     captions are usually available; the runbook should say so.
   - Weekly output is chapters only (per the chapter decision), keeping review to about ten
     chapters per week. CI stays deterministic: no captions fetching or AI in Actions.
