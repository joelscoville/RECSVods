# Person-invoked RECS Replay curation

The authoritative procedure is
[`.agents/skills/recs-archive-curator/SKILL.md`](../.agents/skills/recs-archive-curator/SKILL.md).
It produces evidence-grounded archive interpretation for human review. The
application and CI do not call an agent or LLM API to curate recordings. Native
whisper.cpp transcription is local evidence gathering, not editorial approval.

## Invoke it in the repository

| Harness | Invocation | Loading changes |
| --- | --- | --- |
| Codex | `$recs-archive-curator ZTDYIJUDb0M`, or explicitly ask it to read and follow the canonical skill for that ID | Reads project `.agents/skills/` directly; use a fresh session if its skill list is stale |
| OpenCode | `Use recs-archive-curator to curate 2026-09-06.` The agent loads the project skill adapter | Quit and restart OpenCode after canonical skill or adapter changes |
| Claude Code | `/recs-archive-curator ZTDYIJUDb0M` | Start a new Claude Code session or use supported skill reload after changes |

All three accept an ISO date, YouTube ID, or a manifest path as conversational
scope. For a bounded batch, for example:

```text
Use recs-archive-curator with docs/implementation-prompts/inputs/historical-batch-001.yaml.
Process only the logical services listed there; preserve its trusted metadata.
```

That checked-in manifest is currently empty: it does not authorize selecting or
inventing a batch. These invocations are skill requests, not a new executable
`curate` package command. Date resolution may discover multiple candidates;
grouping requires content evidence. The person should state whether Git delivery
is wanted; “edit only; do not commit” remains a valid invocation.

OpenCode and Claude Code adapters only point at the canonical procedure. Claude's
adapter disables autonomous model invocation. Nothing is installed globally, no
personal harness configuration is required, and the application does not depend
on a specific harness.

## Authorization is separate from invocation and approval

Before any yt-dlp call, accept either the operator's already-set
`RECS_MEDIA_AUTHORIZED=1` or explicit permission in the current conversation.
The agent must never set that flag itself. A request to use the skill without
media permission, public availability, a manifest, or old run-log evidence is
not authorization.

For conversational permission, record the actual scope in an ignored local file
and pass `--authorization-file "$AUTHORIZATION_FILE"` on each preflight, acquire,
sample, and transcribe command. Follow the exact record fields in
[media tooling](media-tooling.md#authorization-and-channel-scope): `authorized`,
`source`, `operator_confirmed_local_record`, `channel_id`, `scope`,
`operator_statement`, and `recorded_at`. Verify it is untracked and passes
`git check-ignore`; never commit its contents or copy it into a build. Confirm
current permission for a new run and include required test recordings in scope.
An explicitly supplied invalid file fails even if the environment flag exists.

Only RECS channel `UCLjwcZaIkiFEed1VgQYSsrw` is accepted. Current tooling refuses
live/upcoming uploads and has no authentication-cookie CLI; report access failure
rather than exposing credentials or inventing a workaround.

## Actual media commands

Run from the repository root through `scripts/devenv-run`. See
[development](development.md) for its finite process-group timeout and
[media tooling](media-tooling.md) for full options and workspace ownership.
`$WORK` and `$PREFLIGHT_WORK` below mean different fresh, empty external child
directories; `$MODEL_CACHE` is a separate external cache. `$AUTHORIZATION_FILE`
denotes the current ignored local record, not a committed example grant.
Verify the external parent exists before creating directories.

### pnpm separator compatibility

Current package scripts map `media:*` directly to `python3 scripts/media.py
<subcommand>`. **Use `pnpm media:acquire --youtube-id …`, without an extra `--`,
with the current parser.** pnpm forwards the extra separator in `pnpm
media:acquire -- --youtube-id …`; Python argparse treats it as the end of options
and does not parse the required arguments. The same applies to other media scripts.
The direct Python form below is also valid. The milestone prompt's separator form
requires the pending parser normalization; verify it with a help-only command
after that change, before adopting it. This is different from `editorial:*`, whose
TypeScript CLI explicitly filters the separator.

| Package script | Backend | Required options |
| --- | --- | --- |
| `pnpm media:model` | `python3 scripts/media.py model` | None; use external `--cache-dir` |
| `pnpm media:preflight` | `python3 scripts/media.py preflight` | `--work-dir`; provision model first |
| `pnpm media:acquire` | `python3 scripts/media.py acquire` | `--youtube-id`, `--work-dir` |
| `pnpm media:sample` | `python3 scripts/media.py sample` | `--work-dir` |
| `pnpm media:transcribe` | `python3 scripts/media.py transcribe` | `--work-dir`, `--start`, `--end` |
| `pnpm media:cleanup` | `python3 scripts/media.py cleanup` | `--work-dir` (valid ownership sentinel) |

```sh
# Provision only if needed; do not change the model revision mid-batch.
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:model \
  --cache-dir "$MODEL_CACHE" --timeout 900

# Includes the authorized MZr169xBwrU first-60-seconds smoke download.
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:preflight \
  --authorization-file "$AUTHORIZATION_FILE" \
  --work-dir "$PREFLIGHT_WORK" --cache-dir "$MODEL_CACHE" --timeout 900

RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:acquire \
  --authorization-file "$AUTHORIZATION_FILE" \
  --youtube-id ZTDYIJUDb0M --work-dir "$WORK" --timeout 900

RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:sample \
  --authorization-file "$AUTHORIZATION_FILE" --work-dir "$WORK" --timeout 900

# Inspect samples and refine boundaries before setting START and END.
# 13260/1200 are the measured-host full-baseline bounds, not universal defaults.
RECS_DEVENV_TIMEOUT_SECONDS=13260 scripts/devenv-run pnpm media:transcribe \
  --authorization-file "$AUTHORIZATION_FILE" --work-dir "$WORK" \
  --cache-dir "$MODEL_CACHE" --start "$START" --end "$END" \
  --language en --timeout 1200

# Equivalent direct interface, for example:
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run python3 scripts/media.py cleanup \
  --work-dir "$WORK"
```

For the environment-flag authorization method, omit `--authorization-file`; do
not set the flag in an agent command. `media:model` and `media:cleanup` need no
media authorization. Cleanup both work directories after copying only safe
evidence to the run log. `preflight` cleans its nested smoke directory but retains
its outer safe report until cleanup.

### Preflight and safe lifecycle

Install an EXIT/finally cleanup handler **before** running this sequence, with
INT/TERM handling as shown in `docs/media-tooling.md`. Call cleanup only on a
surviving sentinel-owned workspace. Keep all acquisition, samples, raw ASR and
processing manifests there, never unrelated files. Errors/handled interruptions
clean owned processing workspaces; a crash/SIGKILL requires cleanup after restart.
Keep the verified model cache separate and retained. If devenv becomes unavailable
during cleanup, the documented standard-library Python cleanup operation needs no
native tools; still use a finite bound and validate ownership.

Before milestone 1 real content, also run the full `wh4mCRKRJ-4` acquisition as
the expected near-empty rejection and acquire/sample/transcribe all of
`mw4SAoJRZgo` for calibration. Use the same command interfaces with separate work
directories, read the acquired span rather than assuming a duration, record RTF,
and discard calibration output. The smoke runs at every preflight; full calibration
is required before the first full recording and again if engine/model/platform
changes. Reuse valid existing evidence rather than claiming to have rerun it.

[Preflight evidence](preflight-evidence.md) records the actual 2026-09-25 primary
devenv smoke, failure-path, cleanup, and calibration results. It establishes tool
readiness on that platform, neither authorization for a new run nor milestone
editorial completion. Its verified model is `ggml-large-v3-turbo-q5_0.bin`, revision
`5359861c739e955e79d9a303bcbc70fb988958b1`, SHA-256
`394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`.
Rehash local bytes against the authoritative receipt before use.

The current `scripts/media.py` adds whisper.cpp `--no-gpu` automatically on Intel
macOS after a reproduced Metal abort. This is an internal inference option, not
a media CLI argument. It preserves the engine/model, defaults to original English
speech, and records the option in evidence. Apple Silicon retains GPU behavior.
The documented calibration RTF is `0.638364609045`; the full 6,759-second baseline
uses a 900-second acquisition bound, 1,200 seconds per transcription native call,
and 13,260 seconds for the complete transcription operation. Recalculate for
different programme spans/platforms, accounting for overlaps and startup, keeping
approximately three-times expected time and the 900-second floor.

## What the curator delivers

Follow the canonical skill for the full procedure: sample 30 seconds every five
minutes plus frames, refine suspected boundaries, identify legitimate prelude,
choose the programme with clipped two-minute margins, and inspect approximately
ten-minute chunks with overlap. Current tools use 600-second chunks and 45-second
overlaps; their merged transcript is evidence, not a fully reconciled editorial
transcript. Remove seam duplication against raw audio while preserving absolute
timestamps and genuine repetitions.

A logical service contains ordered physical uploads, each with its own clock.
Use evidence for multipart continuity and duplicate/restart disposition, never
duration assumptions. Preserve trusted human titles, speakers and references.
Write attributed, cautious summaries and explicit uncertainty notes. ESV readings
and quotations remain reference-only links, including in committed transcripts;
mark omissions honestly, retain timing, and never reconstruct verses from memory.

The schema and [archive format](archive-format.md) define exact fields. Production
requires service `editorial_status: reviewed` and physical video
`media_disposition: playable`. All agent-written interpretation remains
`needs_review`; a correction to reviewed interpretation resets that status and
clears reviewer fields in the same change. Workflow `complete` never approves
content. Uninterpreted records have no editorial status or interpretive fields.

## Validation and Git delivery

Use the current package interfaces through bounded devenv:

```sh
scripts/devenv-run pnpm validate:archive
scripts/devenv-run pnpm lint
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm test
scripts/devenv-run pnpm test:search
scripts/devenv-run pnpm test:e2e
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build:preview
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm preview
# Replace BASE and HEAD with the actual ancestor and review head revisions.
scripts/devenv-run pnpm editorial:guard -- BASE HEAD
```

Run relevant focused checks on each change and all required milestone checks at
its completion. A script's presence is not proof that its checks pass. Local
preview must demonstrate real-passage search, unreviewed labelling, original-video
seek/soft stop/replay/continue at desktop, 390px portrait and 844×390 landscape.
Production must exclude that unreviewed passage and support zero publishable
records. Preview output is `dist/preview`; only production output is deployable.

Update `docs/run-log.md` after every recording with scope, evidence, uncertainty,
checks, cleanup, blockers and next step. Inspect status and full diffs, preserving
unrelated work. When the person authorizes Git delivery, keep code/tests/docs and
archive-content changes in separate commits on the shared feature branch. Every
agent commit carries `Curated-by: agent`. Keep workflow transitions legal in each
commit; the guard validates committed history and cannot certify uncommitted work.
Push and maintain one draft PR with separate Code review and Editorial review
sections, safe evidence and unresolved uncertainty. Never merge or approve it.

## Human-only approval

After reviewing the entire logical service in the local preview, a human edits or
removes anything to withhold and commits corrections as `needs_review`. With a
clean repository and a tracked needs-review service, **the human, not the agent**,
runs:

```sh
scripts/devenv-run pnpm editorial:approve -- <service-id> --reviewer 'Human Name'
```

The command sets only `editorial_status`, `reviewed_by`, and `reviewed_at`, and
makes an approval-only commit with `Editorial-Approval: <service-id>`. It must not
carry an agent trailer. Approval covers the entire service, not individual
passages. The next production deployment includes only its playable uploads.
The deterministic guard is a **process safeguard, not a security boundary**:
an agent using an operator's credentials could technically bypass it. Separate
bot credentials without bypass rights are an optional operator decision.

## Interface differences observed while adding this skill

- Milestone 1 shows `pnpm media:* -- …`; the inspected Python entry point does
  not yet normalize that separator. Working no-separator/direct commands are
  documented above; the main implementation owns the parser correction.
- The milestone's abbreviated `media:preflight` example omits `--work-dir`, which
  the actual parser requires. It also requires an already-provisioned verified
  model; preflight does not download the model itself.
- `docs/media-tooling.md` still describes native acceptance as pending and does
  not mention the Intel CPU workaround. The later `docs/preflight-evidence.md`
  supplies live acceptance/provenance and `scripts/media.py` implements the
  recorded workaround. Reconcile those docs with current evidence when updating
  tooling; offline tests alone still do not establish live acceptance.
- `docs/archive-format.md` calls its script mappings suggested, but `package.json`
  already wires validation and editorial scripts. Its optional `build:index`
  package mappings are not present: current `pnpm build`/`pnpm build:preview`
  own index generation. Use those builds for acceptance rather than inventing a
  package script.
