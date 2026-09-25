---
name: recs-archive-curator
description: Use ONLY when a person explicitly asks to curate RECS Replay recordings by date, YouTube ID, or a bounded manifest. Produces evidence-grounded YAML and Markdown for human review; never approves or publishes interpretation.
---

# RECS Replay archive curator

This is the canonical operating procedure for Codex, OpenCode, and Claude Code.
Use the active coding-agent session; do not add an agent/LLM API, scheduled AI
curation, or an application dependency on a harness. Deterministic tools gather
evidence and validate files; a human alone approves archive interpretation.

## 1. Resolve the request and resume

- Accept an explicit person invocation with a date (`YYYY-MM-DD`), physical
  YouTube ID, or repository-relative manifest path. See `docs/curation.md` for
  harness invocation and actual command syntax. This document is not a CLI.
- At session start/resumption read `docs/run-log.md`, `git status`, and `git log`.
  Preserve unrelated work and resume the recorded step. Inspect existing local
  work before reacquiring media or duplicating a service.
- Read `docs/implementation-prompts/README.md` and the current milestone (for
  milestone 1, `01-one-video-vertical-slice.md` in that directory), then
  `docs/archive-format.md`, `docs/media-tooling.md`, `docs/preflight-evidence.md`,
  and `docs/curation.md`. Read `site/lib/archive.ts`, the supplied manifest,
  existing service/corpus examples, and taxonomy before editing. If `taxonomy/`
  or `services/` is absent, use the schema and documented fictional example for
  structure only; do not invent a taxonomy or recording content to fill the gap.
- Resolve one logical service or an explicitly bounded batch. Treat operator
  input manifests as read-only. A date is a lookup key, not proof that all its
  uploads form one service. A manifest's approval fields do not grant media
  authorization or editorial approval. An empty manifest means no recordings to
  process, not permission to select a batch yourself.
- Only process the RECS channel `UCLjwcZaIkiFEed1VgQYSsrw` (`@recsing`). Use the
  public feed for discovery when needed. Verify channel/video identity through
  the acquisition tool. Do not expand an ID request into an unbounded backfill.
  Milestone 1's real-content target is `ZTDYIJUDb0M`, 6 September 2026; the stated
  6,759-second duration is a baseline to verify, not evidence of its contents.

## 2. Enforce the independent axes

Use exactly these values and workflow edges, independently for service/video
progress where the schema supports them:

```text
workflow_status:
discovered  -> registered | blocked
registered  -> in_progress | blocked
in_progress -> complete | blocked | registered
complete    -> in_progress
blocked     -> registered | in_progress
```

- `blocked` requires an objective `blocked_reason`; clear it when resolved.
  `in_progress -> registered` abandons processing: discard uncommitted
  interpretation and retain registration data. Never erase prior reviewed work
  as an abandonment shortcut. No other edge is allowed; unchanged state is not
  a transition. The guard checks each committed edge, not just the final diff.
- Never-interpreted records contain identifiers and trusted metadata only, no
  interpretive fields or `editorial_status`. Use `corpus/*.yaml` for these records.
  If preflight fails before interpretation, retain an identifier-only blocked
  record with the objective reason. Fixtures cannot satisfy a real-content gate.
- `editorial_status` is absent before interpretation, then `needs_review` for
  every agent-authored interpretation. `reviewed` is human-only. It lives on the
  logical service and covers every video, section, passage, and transcript.
  `pending` and `in_progress` are not editorial values.
- Editing a reviewed service's transcript, boundaries, grouping, classifications,
  summaries, or other interpretation resets it to `needs_review` and removes
  `reviewed_by` and `reviewed_at` in the same change. Only parsed-content-equivalent
  mechanical formatting/schema changes retain approval; describe the mechanical
  change and use the guard's `Mechanical-Change: formatting` or
  `Mechanical-Change: schema-migration` trailer if committing it.
- `media_disposition` is per physical upload: `unassessed`, `playable`, `failed`,
  or `rejected`. Verify playback and expected content before choosing `playable`.
  `failed` means technically unusable and `rejected` means usable but deliberately
  excluded (for example a superseded duplicate); both require timestamped or
  otherwise objective `disposition_evidence`. Rejection is a proposal confirmed
  by human service approval. Duration alone proves neither failure nor duplication.
  Completed media becoming unavailable changes disposition, never
  `complete -> blocked`. Failed/rejected uploads with interpretation still inherit
  the service's editorial status.
- Production eligibility is exactly service `reviewed` **and** video `playable`.
  `complete` is processing completion, not approval. Never write `published` into
  source. Local preview additionally includes playable `needs_review` material
  with visible unreviewed labels; never deploy preview output.
- Never run `editorial:approve`, assign `reviewed`, or create an
  `Editorial-Approval` trailer, even at a person's request. Direct that person to
  the human-only approval instructions in `docs/curation.md`.

## 3. Authorize and preflight before target acquisition

1. Accept either an **operator-set** `RECS_MEDIA_AUTHORIZED=1` or explicit media
   permission in the **current conversation**. Never set the flag yourself or
   infer authorization from public availability, a committed manifest, preflight
   evidence, or a previous run log. If neither method is available, report the
   blocker and stop media processing.
2. For conversational permission, record its actual scope in a gitignored local
   authorization file using the exact fields in `docs/media-tooling.md`. Verify
   it is ignored and untracked, and explicitly pass `--authorization-file` on
   preflight/acquire/sample/transcribe. Permission must cover the selected target
   and applicable smoke/failure/calibration fixtures. Do not reuse the record for
   a new run without current confirmation. Keep its contents and private path
   out of committed documentation, logs, PRs, and build output.
3. Use `scripts/devenv-run` for project/native commands, never an unbounded devenv
   evaluation. Its default outer deadline is 900 seconds and timeout exit is 124;
   record any justified larger finite bound. Check tools inside the pinned devenv,
   not just host PATH. Read the shared bounded retry/fallback procedure if it
   fails: preserve sanitized diagnostics, versions, disk/lock state and elapsed
   time, confirm process-group termination, retry once with a bound, then bounded
   non-global Nix fallback. Homebrew is last resort after both fail and requires
   the full `docs/toolchain-fallback.md` evidence/rollback report. Never wipe locks,
   caches, Nix stores, or globally upgrade packages as an improvised fix.
4. Verify free disk space and a fresh empty external workspace per physical
   upload. Current tools reject repository workspaces, including `.local/`.
   Keep model cache separate. Install cleanup handling before acquisition; the
   validated sentinel-owned workspace must be removed on success, failure, and
   interruption. Clean surviving owned workspaces after a crash/restart too.
5. Verify `yt-dlp`, `ffmpeg`, `ffprobe`, and whisper.cpp versions inside devenv.
   Use only `ggml-large-v3-turbo-q5_0.bin`, from `ggerganov/whisper.cpp`, with its
   authoritative SHA-256/size and commit-pinned source URL. The `media:model`
   command fetches authoritative metadata when provisioning; preflight and
   transcription rehash cached bytes. Record actual provenance, not a guessed
   checksum. Keep the engine/model revision fixed throughout a batch; a necessary
   change requires documenting it and retranscribing the whole batch.
6. Run `media:preflight` with its required work directory and verified cache. It
   downloads/transcribes only the first 60 seconds of `MZr169xBwrU` and removes the
   nested smoke workspace. Also remove the outer evidence workspace after saving
   safe results. Before the first real milestone-1 recording, verify the full
   `wh4mCRKRJ-4` failure-path test and full `mw4SAoJRZgo` calibration, with cleanup
   evidence and RTF in the run log. Existing completed calibration may be reused
   for the same engine/model/platform; it is not permission for another run.
7. Derive finite acquisition/transcription bounds at about three times measured
   expected processing time with a 900-second floor. Distinguish per-native
   `--timeout` from the outer whole-operation deadline; account for all overlaps
   and environment startup. `docs/preflight-evidence.md` records current Intel
   calibration and the 13,260-second full-baseline outer transcription bound.
   The current tool automatically passes whisper's `--no-gpu` on Intel macOS
   (`darwin`, `x86_64`) and records inference options; Apple Silicon retains GPU
   defaults. Do not invent a media CLI `--no-gpu` flag or silently change engines.
8. If required access/tools fail, record the exact safe error and stop the
   real-content workflow. Current tooling has no credential CLI; do not leak
   cookies or bypass its authorization/channel checks. For milestone UI work,
   also verify live Penpot or complete checked-in exports as the shared contract
   requires; a curator-only invocation need not redesign the application.

## 4. Inspect, group, and transcribe evidence

- Acquire through the authorized media command, including `--sections` only when
  deliberately sampling. Inspect `manifest.json`: verified channel/ID, measured
  duration, acquired absolute span, tool versions, and relative temporary files.
  Use ffprobe verification, not transcript length, to establish duration/usability.
- Run coarse sampling first: 30-second audio windows every five minutes and
  timestamped frames. Distinguish waiting, setup, legitimate prelude, programme,
  and post-service. Inspect additional short windows and frames around suspected
  transitions using bounded ffmpeg commands inside devenv; aim to locate the
  programme beginning within 30 seconds. Coarse five-minute samples alone cannot
  establish that precision. Preserve legitimate prelude; put ambiguous boundaries
  and policy choices into review notes rather than silently defining church policy.
- Compare same-date competing uploads through samples, audio/transcript continuity,
  visible transitions, trusted metadata, and repeated content. Group multipart
  recordings into one logical service only with evidence; retain ordered physical
  IDs and explain restarts, gaps, duplicates, and exclusions. Neither shortness,
  length, naming, nor matching dates alone determines grouping or disposition.
  Fully transcribe competing uploads only if they will carry searchable passages.
- Choose the programme interval from evidence, then transcribe with two-minute
  margins on both sides, clipped to the acquired recording bounds. Record the
  requested `transcribed_span` separately from editorial programme boundaries.
  Full-span transcription is justified only when samples support it.
- Use whisper.cpp with `--language en` by default. If samples show substantial
  other-language speech, select the detected original language and record it on
  the video; never silently translate. Captions may supplement evidence, but are
  neither assumed present nor authoritative/complete.
- Analyze roughly ten-minute chunks with 30–60 seconds of adjacent overlap. The
  tool currently uses 600 seconds with a 555-second advance (45-second overlap).
  Preserve original-video absolute timestamps, including acquisition and chunk
  offsets. Do not concatenate multipart videos into a fabricated common clock.
- Review `evidence.json`, `evidence.txt`, raw chunk segments, audio and frames
  together. The merged ASR uses midpoint ownership, not editorial reconciliation.
  Reconcile seam wording/timing against raw overlapping audio, remove duplicated
  overlap text without dropping words or genuine repeated speech, and preserve
  adjacent context. Mark inaudible/uncertain speech rather than completing it
  from model memory. Retain safe timestamped evidence notes before cleanup.

## 5. Write a reviewable service

- Preserve trustworthy human title, speaker, scripture references, date, and
  other metadata. Do not replace them with an inferred sermon title or speaker.
  Record conflicting evidence for review. Leave unknown optional metadata absent;
  use supported neutral descriptions for required titles, never invented claims.
- Write `services/YYYY/<service-id>/service.yaml` using the current strict schema.
  Keep stable service/section/passage IDs, each physical upload's verified duration,
  contiguous sequence, workflow, disposition/evidence, language and transcribed
  span. Keep corpus registration provenance identifier-only.
- Create evidence-supported major sections and coherent passages, usually 30–90
  seconds and approximately 100–300 spoken tokens. Completed thoughts and useful
  context take priority over those targets. Do not bridge videos in one passage.
- Record each passage's video/section IDs, absolute start/end, type, title,
  attributed summary, answerable questions, topics, normalized scripture
  references, transcript, confidence (0–1), and `review_notes`. Preserve display
  metadata and known speaker references. Empty questions/topics/scripture arrays
  are better than speculative tags. Use existing vocabulary where supported.
- Summaries describe what the recording's speaker says, not what the agent thinks
  is doctrinally true. For example, use “The speaker connects…” rather than an
  unattributed theological rule. Put uncertainty about identity, references,
  classification, or boundaries in review metadata; do not smooth it into fact.
- Never supply Bible text from memory. ESV readings remain normalized references
  labelled ESV with esv.org links. Remove verbatim ESV readings/quotations from
  repository transcripts and summaries as well as indexes/build artifacts; use
  an explicit reference-only marker and review note, retaining the video's timing.
  Do not disguise omission as a verbatim transcript. If the reading reference is
  unclear, mark it for review rather than reconstructing verses. Preserve the
  speaker's surrounding commentary without inserting a different translation.
  Only verified, source-attributed public-domain BSB data may supply hidden
  verse-text search under the shared contract; never display it as ESV. Recheck
  ESV terms and record the date before relying on them; report changed terms.
- Use inline passage `transcript` or a passage-specific relative Markdown
  `transcript_file`, exactly one. Do not point every passage at a whole-service
  transcript. Keep raw ASR, audio, frames, caches, cookies, and large temporary
  outputs outside the archive. All new/changed interpretation stays `needs_review`.

## 6. Validate, clean up, and hand off

1. Validate archive schemas, IDs/references, legal workflow changes, positive
   durations, timestamp bounds, passage containment, normalized references, and
   review metadata. Run focused tests and the applicable shared package checks
   through the bounded wrapper; see `docs/curation.md` for actual commands.
2. For milestone completion, build production and local preview with a non-root
   `SITE_BASE_PATH`; inspect desktop, 390px portrait, and 844×390 landscape.
   Demonstrate a real unreviewed passage in local search, its preview label,
   correct original YouTube video/start, soft endpoint, replay, and continuation.
   Verify production excludes it and supports an honest empty archive. Fixtures
   and preflight/calibration outputs are tooling checks, not that acceptance gate.
3. Inspect the complete diff and status without reverting others' work. Check
   sources and generated output for media, secrets, authorization, caches, raw
   outputs, and ESV verse text. Verify every agent interpretation is `needs_review`.
4. Save safe evidence/uncertainty and update `docs/run-log.md` after each recording:
   milestone, service/video IDs, completed/next steps, provenance, spans, grouping
   and boundary decisions, cleanup result, checks and objective blockers. Remove
   owned workspaces in finally/traps even on failure/interruption. Keep only the
   separate verified model cache; confirm no native children remain after timeout.
5. When the person has authorized Git delivery (including an implementation-run
   instruction), inspect status, full diff and recent history; stage only intended
   files. Keep code/tests/docs and editorial content (`services/`, `corpus/`,
   `taxonomy/`) in separate commits on the shared feature branch. Preserve legal
   workflow edges in each commit; do not squash an existing registration directly
   to `complete` or bypass the guard. Include **`Curated-by: agent` on every agent
   commit**, including code/documentation commits. AI coauthor attribution does
   not replace this required trailer. Never create an approval trailer.
6. Run `editorial:guard` across the actual base-to-head commit range; it checks
   committed trees, not uncommitted edits. With authorized delivery, push and open
   or update the single draft PR, keeping Code review and Editorial review
   sections separate and listing uncertain decisions and checks. Do not merge or
   approve. If delivery is not authorized or is expressly excluded, leave edits
   uncommitted and report the remaining delivery step.
7. Return processed scope, files, evidence, validation, cleanup, uncertainties,
   blockers, and PR URL if created. Stop at this service/batch unless the person
   requested the continuous milestone run; then follow its completion protocol
   and load the next milestone only after the current gate passes.
