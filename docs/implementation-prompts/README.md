# RECS Replay Implementation Prompt Series

This directory contains five milestone prompts for one coding agent to execute continuously and in order. Give the agent this file first, then let it load only the current milestone file when that milestone begins. These files are not inputs to an automated agent API.

The execution order is:

1. [`01-one-video-vertical-slice.md`](./01-one-video-vertical-slice.md)
2. [`02-irregular-archive.md`](./02-irregular-archive.md)
3. [`03-generalization-and-editorial-workflow.md`](./03-generalization-and-editorial-workflow.md)
4. [`04-historical-backfill.md`](./04-historical-backfill.md)
5. [`05-weekly-operation.md`](./05-weekly-operation.md)

Operator-supplied inputs live in [`inputs/`](./inputs/). Treat them as read-only unless the operator edits them.

## Naming

The user-facing product name is **RECS Replay**. Use it in the site, page titles, metadata, documentation, and the root `README.md`. `RECVods`, `RECSVods`, and `RECS VODS` are placeholder repository and design-file names; never show them to users. The GitHub repository may be renamed, so never hardcode the repository name or base path. Read the base path from one configuration value (for example `SITE_BASE_PATH`) so the same build works under a GitHub Pages project path or at a domain root.

## Branch, Pull Request, And Review Model

Use one long-lived feature branch and one evolving draft pull request for the implementation run. Milestones depend on each other, so do not split them into stacked PRs.

Keep code review and editorial review separable inside that PR:

- Put each milestone in two checkpoint commits: one for code, tests, and documentation, and one for archive content under `services/`, `corpus/`, and `taxonomy/`. A reviewer can then review code by commit or path filter without reading transcripts.
- Keep the PR description split into a **Code review** section and an **Editorial review** section.

Merging the implementation PR requires human code review only. It publishes no archive interpretation, because every agent-written record stays `needs_review` and production excludes it. Editorial approval happens afterwards, service by service, through small human approval changes (see [Editorial Approval](#editorial-approval)). This keeps the large PR reviewable and still ensures a human reviews every interpretation before publication.

Recommended checkpoint commits:

```text
milestone 1: build one-video vertical slice
milestone 1: add needs_review archive content
milestone 2: support irregular archive cases
milestone 2: add needs_review archive content
milestone 3: add edge cases and editorial workflow
milestone 3: add needs_review archive content
milestone 4: add historical backfill tooling
milestone 4: add needs_review archive content
milestone 5: add weekly operation and production checks
```

Skip a content commit when a milestone adds no archive content.

## Run Log And Resumption

The run spans many hours and will outlast a single agent context window. Maintain `docs/run-log.md` on the feature branch. After each meaningful step, append the current milestone, completed steps, the next step, recordings processed, open blockers, and decisions made. Never put secrets, cookies, or private paths in it. When a session starts, is resumed, or is compacted, read `docs/run-log.md`, `git log`, and `git status` before doing anything else, and continue from the recorded next step rather than restarting a milestone.

## Operating Model

The application must not call an LLM to maintain the archive. Archive interpretation is performed by a person-invoked coding agent using the repository's curator skill. The agent analyzes authorized media, edits YAML and Markdown, validates its work, commits to a branch, and opens a human-review pull request.

GitHub Actions may run deterministic discovery, validation, testing, index generation, and deployment. It must not invoke an AI model, interpret recordings, or publish unreviewed archive content.

The continuous implementation agent does not approve its own archive interpretation. Human approval is required before any archive content reaches production.

## Record Model

Every archive record has three independent axes. Use exactly these names and values everywhere: schemas, manifests, scripts, tests, the curator skill, and documentation.

### `workflow_status`: processing progress

| Value | Meaning |
|---|---|
| `discovered` | Seen by discovery or listed by the operator; not yet in the archive. |
| `registered` | Identifier-only repository record (YouTube ID, date, trusted metadata). No interpretation. |
| `in_progress` | Authorized processing is underway. |
| `complete` | Agent processing has finished. Says nothing about approval. |
| `blocked` | Processing cannot proceed. Requires an objective `blocked_reason`. |

Allowed transitions:

```text
discovered  -> registered | blocked
registered  -> in_progress | blocked
in_progress -> complete | blocked | registered   (registered = abandoned; discard uncommitted interpretation)
complete    -> in_progress                        (reprocessing or correction)
blocked     -> registered | in_progress           (blocker resolved; clear blocked_reason)
```

Workflow may move backwards, but only along these edges. `complete -> blocked` is not allowed. When a completed recording later becomes unavailable on YouTube, change its `media_disposition`, not its workflow status. Records that have never been interpreted (`discovered`, `registered`, or `blocked` before any interpretation) contain no interpretive fields.

### `editorial_status`: human approval

| Value | Meaning |
|---|---|
| absent | No interpretation exists yet. |
| `needs_review` | The agent added or changed interpretation. Not publishable. |
| `reviewed` | A human approved the interpretation. Only a human approval change may set this. |

The unit of approval is the **logical service**. `editorial_status`, `reviewed_by`, and `reviewed_at` live on the service record and cover all its videos, sections, passages, and transcripts. A reviewer who wants to withhold part of a service edits or deletes that part before approving; there is no per-passage approval.

Any agent change to a reviewed service's transcript, boundaries, summaries, classifications, or other interpretation must set the service back to `needs_review` in the same change. Purely mechanical changes that do not alter interpretation, such as schema migrations and formatting, keep the existing status and must say so in the commit message.

### `media_disposition`: suitability of each physical upload

| Value | Meaning |
|---|---|
| `unassessed` | Not yet inspected. |
| `playable` | Verified to play and contain the expected content. The only publishable value. |
| `failed` | Technically unusable: aborted stream, no audio, removed or private upload. Requires evidence. |
| `rejected` | Usable but deliberately not shown, such as a duplicate or superseded restart. Requires evidence. The agent may propose it; it is confirmed when a human approves the service. |

`media_disposition` is per physical video and independent of the other two axes. A failed or rejected upload with interpretation still carries its service's `editorial_status`.

### Publication rule

A passage is published only when its service is `editorial_status: reviewed` **and** its video is `media_disposition: playable`. `published` is derived deployment state; never write it into source content.

Build modes:

- `pnpm build` (production): includes only publishable records. It must succeed and render honest empty states when zero records are publishable, which is the expected state for the entire implementation run.
- `pnpm build:preview` (local review): additionally includes `needs_review` records with `playable` videos, each visibly labelled as unreviewed preview content. Preview output is for local review and must never be deployed to production hosting.

### Editorial Approval

Provide `pnpm editorial:approve -- <service-id> --reviewer <name>`. It sets `editorial_status: reviewed`, `reviewed_by`, and `reviewed_at` on one service, and creates an approval-only commit with the trailer `Editorial-Approval: <service-id>`. A human runs it after reviewing the service in `pnpm build:preview`. The human can do this in a separate approval PR or by adding the approval commit to an agent's PR before merging.

Enforce the rule in CI with a deterministic `editorial-guard` check on every PR:

- Any change that sets `editorial_status: reviewed` must be in a commit carrying the `Editorial-Approval` trailer for that service.
- That commit must change only approval fields (`editorial_status`, `reviewed_by`, `reviewed_at`).
- That commit must not carry an agent trailer: the curator skill requires agent commits to include `Curated-by: agent`, or the harness's `Co-Authored-By` AI attribution.
- Reviewed records must have non-empty `reviewed_by` and `reviewed_at`.

The curator and the implementation agent must never run `editorial:approve`, write `reviewed`, or create an `Editorial-Approval` trailer, even when their confidence is high. Document in the operator runbook that this guard is a process safeguard, not a security boundary: an agent running with the operator's GitHub credentials could technically bypass it. Stronger isolation, such as a separate bot account without bypass rights, is an optional operator decision.

## Product Contract

- YouTube permanently hosts and plays every video.
- The repository contains the reviewed interpretation of the archive, not downloaded media.
- A physical video is one YouTube upload.
- A logical service may contain one or more ordered physical videos.
- A searchable passage is a timestamped, meaningful segment inside one physical video.
- Search returns passages, not only whole services or videos.
- Search combines semantic similarity with exact transcript, title, speaker, date, metadata, topic, and scripture matching.
- Search runs in the browser against static build artifacts. Do not introduce an application database, search server, vector service, or exposed API key.
- Selecting a passage loads the original YouTube video at its start and softly pauses at its end. Users can replay the passage or continue through the full recording.
- Human review is required before archive content is published.
- Do not build accounts, comments, synchronized watch history, playlists, native apps, a custom transcript editor, or automatic AI publishing.
- Do not generate theological conclusions. Summaries must describe what the speaker says and retain uncertainty.
- Bible text must never come from model memory. See [Bible Text](#bible-text).

## Source Channel

The archive source is the Reformed Evangelical Church Singapore YouTube channel:

```text
Handle:      @recsing
URL:         https://www.youtube.com/@recsing
Channel ID:  UCLjwcZaIkiFEed1VgQYSsrw
Public feed: https://www.youtube.com/feeds/videos.xml?channel_id=UCLjwcZaIkiFEed1VgQYSsrw
```

Use the public feed for discovery. It needs no API key or quota. Re-verify the channel ID from the handle if the feed stops resolving. Only process videos from this channel.

## Bible Text

The church uses the **ESV**. The ESV API terms (https://www.esv.org/api/, checked 2026-09-24) allow non-commercial use but forbid locally storing more than 500 verses or half of any book in total. They also limit queries (5,000 per day, 1,000 per hour, 60 per minute) and require the "ESV" label, a link to www.esv.org, and a copyright notice. A static search index that grows with the archive would soon exceed the storage limit, so:

- **Displayed scripture:** show the normalized reference labelled ESV, with a link that opens the passage on esv.org. Do not commit, bundle, or cache ESV verse text in the repository, build output, or search index.
- **Verse-text search:** to let queries such as `living sacrifice` match referenced passages, index verse text from the public-domain **Berean Standard Bible (BSB)**. Use it only as hidden search input, never display it as the church's translation, and label any match reason as a verse-text match rather than an ESV quotation. Document the BSB source, version, and public-domain status.
- Maintain canonical book names and common aliases as project data. These are facts, not licensed text.
- Before relying on these limits, re-read the current ESV terms and record the date checked in the documentation. If the terms have changed, stop and report rather than guessing.

## Authorized Media Tooling

Real archive milestones require an explicit authorization confirmation and a working local media toolchain. The committed devenv is the primary and expected environment for development, tests, builds, and media processing. Do not conclude that a tool is missing from the host shell before checking inside devenv. Pin and expose through devenv:

- `yt-dlp` to download only recordings the operator confirms RECS is authorized to process.
- `ffmpeg`, including its `ffprobe` executable, to verify streams, extract audio, create overlapping chunks, and capture timestamped frames around coarse samples and suspected boundaries.
- `whisper.cpp` (the nixpkgs `whisper-cpp` package, built with Metal on Apple Silicon) as the transcription engine.
- Available YouTube captions as supplemental evidence when useful, never as an assumed complete or authoritative transcript.

### Transcription settings

- Model: `ggml-large-v3-turbo-q5_0.bin` for all archive transcription. Download it once into a model cache outside the repository, verify its SHA-256 against the value published by the model source, and record the file name, source URL, and hash in documentation.
- Language: `--language en` by default. If coarse sampling shows a recording is substantially in another language, transcribe that recording with the detected language and record it on the video. Never silently translate.
- Do not change the model or engine within a corpus batch. If a change becomes necessary, record it and re-transcribe the whole batch.

### Keeping transcription short

- Before full transcription, coarsely locate the programme by sampling 30-second audio windows every 5 minutes plus frames. Then transcribe only the programme span with a 2-minute margin on each side, not waiting or setup material. Record the transcribed span.
- For competing same-date uploads, compare sampled windows first. Transcribe an upload in full only when it will carry searchable passages.

### Pipeline test corpus

Use these fixed recordings to test the pipeline cheaply. They verify tooling only and never satisfy a real-content completion gate.

| Purpose | Recording | Scope |
|---|---|---|
| Smoke test (every preflight) | `MZr169xBwrU` (12 July 2026, 3m 9s) | First 60 seconds only (`yt-dlp --download-sections "*0-60"`) |
| Failure path | `wh4mCRKRJ-4` (28 June 2026 failed stream, 7s) | Full; verify the pipeline reports near-empty media cleanly instead of crashing |
| Calibration (once, before the first full recording) | `mw4SAoJRZgo` (16 August 2026 part 1, 12m 57s) | Full; measure the real-time factor and record it in `docs/run-log.md` |

Set acquisition and transcription timeouts from the calibration result: about 3 times the expected processing time for the recording's duration, with a minimum of 900 seconds. Discard calibration output; the recording is interpreted properly in Milestone 2.

### Devenv and fallback

Commit `devenv.nix`, `devenv.yaml`, and the generated lock file. Run project commands through `devenv shell -- ...` or a repository wrapper around it. Verify `yt-dlp`, `ffmpeg`, `ffprobe`, and `whisper-cli` (or the packaged whisper.cpp binary name), and record their versions from inside that environment.

Devenv evaluation must never run without a time bound. Add a portable `scripts/devenv-run` wrapper that executes `devenv shell -- <command>` in a new process group, enforces `RECS_DEVENV_TIMEOUT_SECONDS` with a documented default of 900 seconds, terminates the complete process group on expiry, and returns exit code 124. Implement the timeout with Python's `subprocess` and process-group APIs so it works on macOS without assuming GNU `timeout` or `gtimeout`. Use a larger explicit bound for the first cold evaluation when justified, but never remove the bound. The 900-second default is for evaluation, setup, and preflight; acquisition and transcription use the calibrated finite values above.

If devenv times out or fails to evaluate:

1. Preserve the exact command, elapsed time, safe error output, `devenv --version`, `nix --version`, free disk space, and lock-file state.
2. Confirm the wrapper terminated its child process group. Do not leave an evaluator or build running in the background.
3. Retry once with a documented bounded timeout because completed downloads may now be cached. Do not loop indefinitely, delete the lock file, wipe `.devenv`, modify the Nix store, or run global garbage collection as an improvised fix.
4. If devenv still fails, try a temporary non-global environment: a bounded `nix shell` for the native tools when Nix evaluation still works. Record exact versions and keep media behavior equivalent to devenv.
5. Use Homebrew only when both devenv and the non-global fallback have failed. Install only the minimum missing formulae (`yt-dlp`, `ffmpeg`, `whisper-cpp`); do not run a blanket `brew upgrade`.

If any Homebrew installation is used, create or update `docs/toolchain-fallback.md` in the same change. Include the date and platform, each failed non-global approach, timeout values and elapsed times, sanitized errors, why another bounded retry would not help, exact Homebrew commands, formulae installed or changed, before/after versions, the fact that `ffprobe` is supplied by the `ffmpeg` formula, global side effects, rollback commands, and a follow-up for restoring devenv as the sole supported path. Never include credentials, cookies, private paths, or authorization data in that report.

### Authorization

Require the operator assertion `RECS_MEDIA_AUTHORIZED=1` before `yt-dlp` runs. Only the human operator may set it. The agent must never set, export, prepend, or suggest setting this variable in its own commands, and must never write it into scripts, configuration, `.env` files, or documentation examples that the agent then runs. If it is absent, stop and report the blocker.

Authentication cookies or credentials must come from an operator-approved environment or local browser profile. They must never enter Git, logs, issue bodies, build artifacts, or the website.

Before Milestone 1, verify the tools from inside devenv, record their versions, confirm sufficient temporary disk space, and run the smoke test through the bounded wrapper.

Store downloaded media, extracted audio, frames, temporary transcripts, and model caches outside the repository or under an explicitly ignored temporary root. Use cleanup handling that runs after success, failure, and interruption. Deletion reduces storage exposure but does not replace the authorization requirement.

Fictional fixtures and the pipeline test corpus may validate schemas, tooling, search, and UI behavior, but they never satisfy a real-recording completion gate. If authorization, required tools, credentials, or media access are unavailable for the core or edge-case corpus in Milestones 1-3, mark the work blocked, do not invent archive content, and stop the continuous run. Milestone 4 may complete its tooling checkpoint without a live historical batch only when the operator's batch input is empty; record live-batch acceptance as pending rather than pretending fixtures completed it.

## Cross-Harness Curator Skill

Supported agent harnesses are Codex, OpenCode, and Claude Code. Do not add adapters for other harnesses such as Pi.

Keep the authoritative curator instructions in:

```text
.agents/skills/recs-archive-curator/SKILL.md
```

Codex reads `.agents/skills/` directly. Add thin harness adapters at `.opencode/skills/recs-archive-curator/SKILL.md` and `.claude/skills/recs-archive-curator/SKILL.md`. Each adapter should contain valid harness metadata, direct the agent to read the canonical skill, and add only genuinely harness-specific invocation or reload instructions. Do not maintain independent copies of the procedure.

When the canonical skill or an adapter changes, start a new Claude Code session or reload skills as required by that harness, and restart OpenCode before expecting an existing OpenCode session to discover the change. The application itself must not depend on any particular agent harness.

## Archive Summary Safety

Summaries must attribute claims to the recording and avoid adding doctrine that the speaker did not express.

Good:

> The speaker connects Romans 13:1-7 with Christian responsibility toward civil government and says that earthly authority remains accountable to God.

Bad:

> Christians must obey every government unless it becomes evil.

The bad example turns a possible interpretation into an unattributed rule and may add a conclusion not stated in the passage.

When evidence is uncertain, write the uncertainty into review metadata rather than smoothing it into the public summary. For example: `The speaker appears to connect this section with Romans 13, but the verse range and section boundary require review.`

## Technical Direction

Use this stack unless the repository already contains an equivalent implementation that should be extended rather than replaced:

- Astro for static site generation.
- React and TypeScript for interactive search and player islands.
- Node.js TypeScript scripts for validation and index generation.
- pnpm for package management.
- YAML and Markdown as editable archive sources.
- Zod or an equivalent typed schema validator.
- Vitest for unit and integration tests.
- Playwright for browser and responsive tests.
- YouTube IFrame Player API behind a testable adapter.
- One browser-compatible embedding model used by both index generation and browser queries. Self-host its weights in the build output so the site does not depend on a third-party model CDN at runtime, and keep each file within the host's file-size limits.
- GitHub Actions for CI and GitHub Pages for production hosting. Keep the build host-agnostic through the configurable base path so it could move to another static host without code changes.

Choose focused libraries where they reduce risk, but retain the static architecture. Keep derived indexes reproducible and never hand-edit generated vectors.

Establish and retain these package scripts:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm validate:archive
pnpm test:search
pnpm test:e2e
pnpm build
pnpm build:preview
pnpm editorial:approve
```

## Penpot Design Contract

The source design is the Penpot file `RECVods`, file ID `d8ac01df-6646-81d2-8008-a541da18e21b`. Treat source frames as read-only.

Live Penpot access requires the Penpot design skill and Penpot MCP connection. They are currently available in Codex and OpenCode but not in Claude Code. In a harness without them, use the checked-in snapshot under `docs/design-reference/penpot/` and follow its offline verification language. Do not report that as a blocker, because the snapshot is complete.

When live access is available, export the named frames and update `docs/design-reference/penpot/manifest.yaml` following `docs/design-reference/penpot/REFRESH.md`. If neither live access nor complete exports are available, UI implementation is blocked; the prose description alone is not sufficient to claim visual fidelity.

Penpot is the design source of truth. Do not use general-purpose visual-design or critique skills, including Impeccable, to establish or alter the visual direction. The repository has Impeccable hooks that run after file edits and at session stop. Treat their output as advisory accessibility and state-completeness findings only, and ignore any suggestion to change the palette, typography, layout direction, or motion established in Penpot. Such skills may be used only to verify accessibility, responsive behavior, spacing, and state completeness against the live frame or checked-in export. They must not generate alternative concepts, initialize a competing design system, change the approved palette or typography, or introduce new styling or motion not supported by Penpot.

| Screen | Shape ID | Reference size |
|---|---|---:|
| Home, desktop, returning | `b2c9ceb5-f0e9-5d6b-b95f-5a1275a567cd` | 1728 x 1470 |
| Home, desktop, new | `55888863-4675-8006-8008-a5e3f99c9577` | 1728 x 1470 |
| Home, mobile, returning | `88049aca-346e-50bb-a7b9-6f3a52558e7d` | 390 x 2320 |
| Home, mobile, new | `7bcecdaf-67b6-80d9-8008-a70e786c821b` | 390 x 2320 |
| Home, mobile landscape, returning | `7bcecdaf-67b6-80d9-8008-a70f4eaf02d2` | 844 x 1367 |
| Home, mobile landscape, new | `a8acd6cb-e23f-8012-8008-a7f5208582e1` | 844 x 1367 |
| Search, mobile portrait | `e32dcc5b-b27c-807d-8008-a723c5d4dc38` | 390 x 844 |
| Search, mobile landscape | `e32dcc5b-b27c-807d-8008-a72695758aa7` | 844 x 390 |
| Search keyboard demonstration, portrait | `e32dcc5b-b27c-807d-8008-a7244553be1c` | 390 x 844 |
| Search keyboard demonstration, landscape | `85acc997-f6ae-808a-8008-a73732baab94` | 844 x 390 |
| Playback, desktop | `85acc997-f6ae-808a-8008-a7384efacd1b` | 1728 x 1331 |
| Playback, mobile portrait | `e2e985d2-8411-8025-8008-a8747a84ba01` | 390 x 844 |
| Playback, mobile landscape | `e2e985d2-8411-8025-8008-a8762ff945b6` | 844 x 390 |

Use the established visual language. Token values in `docs/design-reference/penpot/tokens.json` take precedence over this summary:

- Interface typeface: Atkinson Hyperlegible Next.
- Editorial display typeface: Domine, reserved for the large desktop call to action.
- Off-white `#FAFAFF`, on-surface text `#1D1B20`, periwinkle `#E4D9FF`, burgundy `#6C0000`, bright indigo `#273469`, dark navy `#1E2749`, gold `#FFAA5A`, and black `#000000`. Gold lacks text contrast on light surfaces; use it only on dark surfaces or as a non-text accent.
- Default radius: 12px; search fields and compact controls may use the pill treatment shown in Penpot.
- Desktop navigation combines the wordmark and wide burgundy search field with a periwinkle search action.
- Desktop home uses an indigo call-to-action panel, video grid, category tiles, and dark footer.
- Mobile home uses a compact header, horizontally scrolling category chips, featured card, single-column feed, and mobile footer.
- Mobile search uses a 44px back control, burgundy search field, history chips, category tiles, and trending chips.
- Desktop playback uses a 16:9 player beside chapters, followed by metadata and summary.
- Mobile portrait stacks player, details, and chapter rows. Landscape prioritizes the player and keeps Back reachable.

The wordmark text is `RECS REPLAY`. Do not render the keyboard artwork from the Penpot demonstration; test with a real focused input instead. Do not ship placeholder labels such as `Video Title`. The design has no complete desktop results frame, so derive it from the existing navigation, cards, chapter rows, typography, colors, and spacing rather than inventing a new style.

Target WCAG 2.2 AA with semantic controls, keyboard access, visible focus, adequate contrast, reduced-motion behavior, descriptive labels, and at least 44 x 44px primary mobile targets. Do not rely on color alone for state or meaning.

## Shared Completion Protocol

At the end of every milestone, the coding agent must:

1. Run focused tests and every relevant package script from this file.
2. Build both `pnpm build` and `pnpm build:preview` with a non-root base path.
3. Inspect affected UI in the local preview build at desktop, 390px portrait, and 844 x 390 landscape sizes.
4. Inspect `git status` and the complete diff without reverting unrelated work.
5. Confirm that no media, secrets, model caches, ESV verse text, or temporary files are tracked or published. If Homebrew was used, confirm `docs/toolchain-fallback.md` contains the required failure evidence, package inventory, side effects, and rollback commands.
6. Confirm every agent-interpreted service remains `editorial_status: needs_review`, the production build excludes it, and the `editorial-guard` check passes. Confirm that never-interpreted records contain no interpretive fields.
7. Update documentation made inaccurate by the change, and update `docs/run-log.md`.
8. Commit only intended files to the long-lived feature branch using the milestone checkpoint messages, keeping code and archive content in separate commits.
9. Push the branch. After Milestone 1, open one draft PR; after later milestones, update that same draft PR's Code review and Editorial review sections with implementation changes, editorial uncertainty, tests, and manual checks.
10. Continue to the next milestone when checks pass. Do not wait for human review or merge between milestones.

If a required check fails, fix it and rerun the checks. If it cannot be fixed, do not proceed; update the draft PR and `docs/run-log.md` with the blocker and exact failing command. Missing media authorization or tooling, or missing both Penpot access and design exports, are blockers, not permission to substitute invented production content.

After Milestone 5, run the full suite, update the PR with the final evidence, and mark it ready for human code review. Do not merge it and do not approve any service. After a human merges it, editorial approval proceeds service by service through `pnpm editorial:approve`, and each approval becomes public on the next production deployment.
