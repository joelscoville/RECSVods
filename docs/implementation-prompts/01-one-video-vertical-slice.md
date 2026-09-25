# Prompt 1: One-Video Vertical Slice

Read `docs/implementation-prompts/README.md` first and follow its product, record-model, technical, design, and completion contracts throughout this milestone.

Work directly in the repository. Read `docs/run-log.md` if it exists and resume from it. Otherwise inspect existing files and Git history, create the long-lived feature branch for the complete five-milestone run, create `docs/run-log.md`, and preserve unrelated work. Build the first complete vertical slice using only:

```text
RECS 6 September 2026
YouTube ID: ZTDYIJUDb0M
Published duration: 1h 52m 39s
```

The result must turn reviewable YAML/Markdown into a static passage index, browser search results, and timestamped YouTube playback.

Do not invent the sermon title, speaker, scripture, transcript, boundaries, or summaries. Use authorized inspection and trusted metadata. Fictional fixtures may exercise code paths but do not satisfy this milestone. If the media preflight fails, leave only an identifier-level record with `workflow_status: blocked` and a `blocked_reason`, document the objective blocker, add no interpretive fields or `editorial_status`, and do not claim the milestone complete.

## Required Preflight

Before building archive content:

1. Confirm explicit operator authorization using either the operator-set `RECS_MEDIA_AUTHORIZED=1` flag or current-conversation permission recorded in a gitignored local file, as defined in the shared Authorization contract. Never set the flag yourself. If neither is available, stop and report.
2. Create or verify the committed devenv and its lock file, then enter it through the shared bounded `scripts/devenv-run` wrapper. Do not test only the host `PATH`.
3. From inside devenv, verify and record versions for `yt-dlp`, `ffmpeg`, `ffprobe`, and whisper.cpp. Download and hash-verify the shared transcription model into the external model cache.
4. Verify temporary storage and model-cache paths are outside tracked repository content.
5. Run the shared smoke test (first 60 seconds of `MZr169xBwrU`) and the failure-path test (`wh4mCRKRJ-4`) through the bounded wrapper, and prove cleanup works after each.
6. Run the calibration recording (`mw4SAoJRZgo`), record the real-time factor in `docs/run-log.md`, and derive the acquisition and transcription timeouts for `ZTDYIJUDb0M`.
7. Confirm live Penpot access or the complete checked-in exports and `docs/design-reference/penpot/manifest.yaml`.

If live Penpot is available in this harness, refresh the checked-in snapshot before UI implementation; otherwise use the snapshot as described in the shared Penpot contract. If media authorization/tooling or both design sources are unavailable, report the blocker in the draft PR and stop the continuous run rather than replacing real work with fixtures.

Provide repeatable local commands or scripts with equivalent names and behavior:

```text
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:preflight
RECS_DEVENV_TIMEOUT_SECONDS=<calibrated> scripts/devenv-run pnpm media:acquire -- --youtube-id ZTDYIJUDb0M --work-dir <temporary-path>
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:sample -- --work-dir <temporary-path>
RECS_DEVENV_TIMEOUT_SECONDS=<calibrated> scripts/devenv-run pnpm media:transcribe -- --work-dir <temporary-path> --start <seconds> --end <seconds>
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:cleanup -- --work-dir <temporary-path>
```

`scripts/devenv-run` must implement the shared timeout and process-group cleanup contract before any long devenv evaluation or media command is attempted. `media:acquire` must refuse to run without explicit authorization, refuse a work directory inside tracked source paths, invoke `yt-dlp` without printing credentials, and record the video ID, duration, tool versions, and temporary filenames in a local processing manifest. `media:acquire` must also support `--sections` for the 60-second smoke test. `media:sample` must produce the coarse 30-second audio windows and frames used to locate the programme. `media:transcribe` must transcribe only the requested span, use the shared whisper.cpp model and language settings, and preserve absolute recording timestamps across overlapping chunks. `media:cleanup` must remove media, audio, frames, temporary transcripts, and per-run metadata while leaving reviewed repository files untouched. The curator may use a `try/finally` wrapper or signal trap so cleanup also occurs after interruption.

## Repository Foundation

Initialize the shared Astro, React, TypeScript, pnpm, Vitest, and Playwright stack. Read the base path from one configuration value and support a GitHub Pages project path without hardcoding the repository name. Replace the placeholder root `README.md` with a concise RECS Replay overview and setup guide. Add strict type checking, linting, formatting, stable package scripts, and concise setup documentation.

Create the reproducible devenv before installing project dependencies. Include Node.js, pnpm, `yt-dlp`, `ffmpeg`/`ffprobe`, `whisper-cpp`, the Python interpreter used by `scripts/devenv-run` tests, and other required build/test tools. Commit its lock file and the bounded wrapper. If the shared Homebrew last resort is used, add the required `docs/toolchain-fallback.md` report before proceeding and keep the devenv configuration as the intended long-term environment.

Use an understandable structure based on:

```text
devenv.nix
devenv.yaml
devenv.lock
corpus/
services/
bible/
taxonomy/
scripts/
site/
.agents/skills/recs-archive-curator/
.opencode/skills/recs-archive-curator/
.claude/skills/recs-archive-curator/
.github/workflows/
```

Keep editable sources separate from generated indexes and vectors. Generated artifacts must be reproducible.

## Archive Contract

Implement the shared record model exactly as defined in the README. Define typed schemas for:

- Physical videos with YouTube ID, duration, sequence, `workflow_status`, `media_disposition`, disposition evidence, transcription language, and transcribed span.
- Logical services with stable ID, date, title, type, ordered videos, `workflow_status`, `editorial_status`, `reviewed_by`, `reviewed_at`, and review notes.
- Major sections with video ID, absolute start/end seconds, type, title, confidence, and review notes.
- Searchable passages with stable ID, video ID, timestamps, type, title, summary, questions, topics, scripture references, transcript, confidence, and display metadata. Passages inherit publication eligibility from their service and video.
- Speakers and topics.
- The allowed `workflow_status` transitions, the `blocked_reason` requirement, and the rule that never-interpreted records have no interpretive fields.

Implement `pnpm build:preview`, `pnpm editorial:approve`, and the CI `editorial-guard` check in this milestone. The curator may create or update interpreted content only as `editorial_status: needs_review`; it must never assign `reviewed`, even when workflow status is `complete` or media disposition is `failed` or `rejected`.

Store services predictably, for example:

```text
services/2026/2026-09-06/service.yaml
services/2026/2026-09-06/transcript.md
```

Reject invalid YouTube IDs, duplicate IDs, negative or reversed timestamps, passages beyond video duration, missing required fields, and unknown video references. Errors must name the file and field.

## Curator Skill

Create the canonical skill at `.agents/skills/recs-archive-curator/SKILL.md` with valid frontmatter and a precise trigger description. Add thin OpenCode and Claude Code adapters at the shared-contract paths. Add a harness-appropriate command or documented invocation accepting a date, YouTube ID, or manifest path. Document reload or restart behavior for both harnesses without duplicating the canonical procedure.

The skill must direct a person-invoked coding agent to:

- Confirm authorized media access.
- Run the media preflight before downloading.
- Read schemas, taxonomy, manifest, and existing examples first.
- Keep physical uploads separate from logical services.
- Work on one service or explicitly bounded batch.
- Use authorized `yt-dlp` acquisition, `ffprobe` verification, `ffmpeg` audio/chunk/frame extraction, and whisper.cpp transcription with the shared model and language settings.
- Sample coarsely first, then transcribe only the programme span with the shared margin.
- Store temporary media outside tracked paths and remove it after success, failure, or interruption.
- Coarsely identify waiting, setup, legitimate prelude, service, and post-service before detailed analysis.
- Flag ambiguous editorial boundaries instead of deciding church policy silently.
- Analyze roughly ten-minute spans with 30-60 seconds of overlap when chunking is needed.
- Preserve absolute timestamps and adjacent context, then remove overlap duplication.
- Create major sections and coherent 30-90 second passages, generally 100-300 spoken tokens, without splitting completed thoughts merely to meet a limit.
- Record title, summary, questions, topics, scripture references, transcript, confidence, and uncertainty.
- Preserve trustworthy human metadata.
- Never supply Bible text from memory.
- Write all agent-interpreted services with `editorial_status: needs_review` and record upload usability separately as media disposition.
- Never run `pnpm editorial:approve`, write `reviewed`, or add an `Editorial-Approval` trailer. Add the `Curated-by: agent` trailer to every agent commit.
- Update `docs/run-log.md` after each recording.
- Validate, inspect the diff, commit code and archive content separately, push, and open or update the draft PR with uncertainty noted.

The skill is an agent operating procedure, not executable application logic and not an instruction to call an agent or LLM API.

## First Recording

Use the skill and authorized pipeline to process `ZTDYIJUDb0M`. Download to the approved temporary root, verify duration, sample coarsely to locate the programme, transcribe the programme span with whisper.cpp, and extract timestamped frames at coarse intervals and around suspected transitions. Use transcript, audio timing, frames, adjacent context, and trusted metadata together to identify waiting/setup material, the actual programme beginning within a target tolerance of 30 seconds, supported major sections, coherent searchable passages, and uncertain decisions requiring review.

Never commit recordings, extracted audio, frames, large raw outputs, or caches. Add targeted ignore rules without hiding reviewed content.

## Search And Playback

Build passage embedding documents from title, summary, questions, topics, normalized scripture references, and transcript. Verse text from the shared Bible contract is added in Milestone 2. Preserve fields separately for display.

Choose and document one browser-compatible embedding model, including identifier, revision where practical, dimension, normalization, license, and download size. Self-host its weights in the build output. Build and browser query paths must use identical preprocessing. No API key may be exposed.

Implement transparent exact and semantic scoring with centralized weights and truthful match reasons such as transcript, topic, or scripture matches.

Build this complete journey using the shared Penpot contract:

1. Home page with primary search.
2. Passage-level results showing title, date, type, speaker if known, scripture, summary, timestamp range, and match reason.
3. `Play passage` opens a shareable URL and loads the original YouTube video at the passage start.
4. Playback shows active passage, transcript, service metadata, and chapters.
5. The player softly pauses at the passage end.
6. Users can replay or continue beyond the endpoint.

Use the real IFrame API behind a testable adapter. The interface must already work on desktop, mobile portrait, and mobile landscape and meet the shared accessibility requirements.

## Required Tests

Test valid and invalid records, every allowed and forbidden workflow transition, rejection of `pending` or `in_progress` as editorial-status values, editorial-status/media-disposition independence, the `editorial-guard` check (approval without trailer, approval mixed with other changes, approval in an agent-trailered commit, missing `reviewed_by`), `editorial:approve` behavior, production exclusion and preview labelling of `needs_review`, a production build with zero publishable records, duplicate IDs, timestamp bounds, document construction, build/browser model compatibility, deterministic result ordering, match reasons, URL state, player seek/stop/replay/continue behavior, keyboard access, responsive smoke cases, non-root production builds, media preflight failure, timeout exit code 124 and child-process cleanup, cleanup after interrupted processing, and exclusion of media files from Git and build output.

## Completion Gate

Do not complete the checkpoint until, in the local `pnpm build:preview` output, a user can search at least one real `needs_review` passage from the authorized recording, see its preview label, open it, start the correct video at the correct timestamp, encounter the soft endpoint, and continue watching. The local `pnpm build` output must exclude that passage and show an honest empty archive state. Follow the shared completion protocol, open the single draft PR, then load Prompt 2 and continue on the same branch.
