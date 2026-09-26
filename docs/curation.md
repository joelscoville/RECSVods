# Person-invoked RECS Replay curation

The [canonical skill](../.agents/skills/recs-archive-curator/SKILL.md) is the concise
agent procedure. This runbook supplies interfaces and case-derived review checks.
Curation is a person-invoked workflow, not application logic or an LLM API integration.

## Invocation and scope

| Harness | Explicit invocation | Loading changes |
| --- | --- | --- |
| Codex | `$recs-archive-curator ZTDYIJUDb0M`, or ask it to read the canonical skill | Reads `.agents/skills/` directly; refresh the session if its list is stale |
| OpenCode | `Use recs-archive-curator to curate 2026-09-06.` | Quit and restart OpenCode after skill changes |
| Claude Code | `/recs-archive-curator ZTDYIJUDb0M` | Start a new session or use supported skill reload |

All accept a date, physical YouTube ID or bounded manifest path. Thin adapters
point at the canonical skill; no global installation or personal config is needed.
Read the run log and current milestone before resuming. Preserve unrelated work.

Operator input files are read-only. `historical-batch-001.yaml` now contains twelve
approved M4 services; the operator bundle has their advance transcripts alongside
the original eight M2/M3 files. This supersedes the former empty-batch note. The
approved bundle may be verified read-only in its agreed scope, but its inventory
is not an instruction to curate everything. M3 curation does not start M4. At M4,
verify the current input manifest and process only its approved bounded batch.
An actually empty future input means no live batch, not permission to select one.

## Authorization and tooling references

Accept the operator-set `RECS_MEDIA_AUTHORIZED=1` or explicit current-conversation
permission recorded in an ignored, untracked local authorization file. Never set
the flag yourself or infer permission from old logs, public media or a committed
manifest. Honor sufficient current permission without repeatedly asking for it.
The grant must cover the actual recordings/actions; missing permission is a blocker.
Approval to process media never approves editorial interpretation.

Read these before the relevant operation:

- [Shared contract](implementation-prompts/README.md): exact axes, authorization,
  bounded fallback, Bible policy and milestone completion.
- [Media tooling](media-tooling.md): authorization-file fields, native options,
  channel checks, model verification, sentinel ownership and cleanup traps.
- [Preflight evidence](preflight-evidence.md): actual tool versions, authoritative
  model hash, Intel CPU workaround, smoke/failure/calibration and finite timeouts.
- [Transcript import](transcript-import.md): current CLI, source alignment policy,
  receipt projection, missing-audio exception and verification-gated deletion.
- [Archive format](archive-format.md): strict schema, Markdown sources, publication
  projections, legal workflow edges and human-only approval/guard behavior.

Run project/native commands sequentially through `scripts/devenv-run`, with finite
`RECS_DEVENV_TIMEOUT_SECONDS` (default 900s; process-group timeout exit 124).
Native media `--timeout` is per invocation, not a multi-chunk total. Calibrate about
three times expected processing time with a 900s floor and account for startup and
overlap. Follow the shared retry/fallback sequence rather than modifying global
toolchains. Use fresh external owned workspaces and retain the separate model cache.

## Current local media interface

Local whisper.cpp remains the primary engine, especially weekly single-service
operation: `ggml-large-v3-turbo-q5_0.bin`, authoritative hash verification, original
English by default, no silent translation. Intel macOS automatically uses the
documented `--no-gpu` option; it is not a media CLI flag. Keep batch settings stable.

`pnpm media:* -- …` is supported: `media.py` normalizes the forwarded separator.
Options without that extra separator also work. Direct Python calls do not need it.

| Package script | Required options / prerequisite |
| --- | --- |
| `media:model` | External `--cache-dir` when overriding the default |
| `media:preflight` | `--work-dir`; verified model provisioned first |
| `media:acquire` | `--youtube-id`, `--work-dir`; optional `--sections '*0-60'` |
| `media:sample` | `--work-dir` |
| `media:transcribe` | `--work-dir`, `--start`, `--end`; verified cache |
| `media:cleanup` | `--work-dir` with valid ownership sentinel |

`$WORK` and `$PREFLIGHT_WORK` are separate fresh external directories; verify their
parent before creation. `$MODEL_CACHE` is separate. `$AUTHORIZATION_FILE` is the
current local grant. Install the documented cleanup traps before acquisition.

```sh
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:preflight -- \
  --authorization-file "$AUTHORIZATION_FILE" \
  --work-dir "$PREFLIGHT_WORK" --cache-dir "$MODEL_CACHE" --timeout 900

RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:acquire -- \
  --authorization-file "$AUTHORIZATION_FILE" \
  --youtube-id "$VIDEO_ID" --work-dir "$WORK" --timeout 900

RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:sample -- \
  --authorization-file "$AUTHORIZATION_FILE" --work-dir "$WORK" --timeout 900

# Local ASR only: choose programme plus clipped two-minute margins from samples.
# These bounds are the measured Intel full-baseline example, not universal defaults.
RECS_DEVENV_TIMEOUT_SECONDS=13260 scripts/devenv-run pnpm media:transcribe -- \
  --authorization-file "$AUTHORIZATION_FILE" --work-dir "$WORK" \
  --cache-dir "$MODEL_CACHE" --start "$START" --end "$END" \
  --language en --timeout 1200

RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run pnpm media:cleanup -- \
  --work-dir "$WORK"
```

The local pipeline preflight includes the first-60s smoke; the first-full-recording
failure/calibration gates and cleanup evidence are in the linked docs. Reuse valid
calibration for the same engine/model/platform. Approved evidence imports do not
trigger new inference or transcription preflight. They still require source inspection.
Ordinary owned-workspace cleanup covers success, failure, interruption and recovery
after a crash. Operator batch-audio roots are excluded from unconditional traps.

## Operator-run Colab exception

The 2026-09-25 decision approves operator-run Colab for large agreed batches,
roughly three or more full services taking many CPU hours. It is not app/CI
infrastructure, a hosted API or automated VM dispatch. For a future batch, propose
the service list and obtain agreement before staging authorized audio only in the
designated Drive `audio/` folder. Ask the operator to click **Run all** manually;
the notebook skips completed outputs. Collect and verify small batches, bounding
waits/retries. Batch agreement does not imply editorial approval.

No new inference/local retranscription for the eight supplied M2/M3 IDs:
`k27dmsPvmG8`, `W2IZ6MUX-Yk`, `94fynFHtreg`, `GkmB_KeBlBw`, `D-FyolbxJgk`,
`OrsN83j3qxE`, `MZr169xBwrU`, `Z-vRVB-WucA`. Use approved advance M4 evidence when
that batch is in scope. Preserve earlier whisper.cpp records; do not rewrite a
batch merely to erase the approved engine difference.

The exact imported engine/settings are faster-whisper 1.2.1, CTranslate2 4.8.2,
`large-v3-turbo`, float16/Tesla T4, beam 5, word timestamps enabled, VAD disabled,
`condition_on_previous_text=False`. Do not invent absent model-weight/runtime hashes.

### Import and missing originals

Use `$TRANSCRIPT_BUNDLE` for the external README/checksums/raw JSON bundle,
`$BATCH_AUDIO_ROOT` for designated local batch audio and `$DRIVE_AUDIO_ROOT` for
the designated Drive audio directory. Keep private absolute paths/account emails
out of repository docs. Prefer verification against actual original bytes when present.

The importer exists; use the complete [CLI contract](transcript-import.md#cli).
It requires an already-acquired owned workspace and an explicit authorization file;
unlike media commands it does not fall back to environment-only authorization.
Create that file only from actual operator permission, never infer its required
current-conversation assertion from a flag alone. Keep commands sequential/bounded.

```sh
# Read-only bundle verification, only when its scope has been agreed:
scripts/devenv-run python3 scripts/import_transcript.py verify-bundle \
  --bundle-dir "$TRANSCRIPT_BUNDLE"

# Import only the selected recording, not every file in the bundle:
scripts/devenv-run python3 scripts/import_transcript.py import \
  --transcript "$TRANSCRIPT_BUNDLE/$VIDEO_ID.json" \
  --checksums "$TRANSCRIPT_BUNDLE/SHA256SUMS" \
  --work-dir "$WORK" --authorization-file "$AUTHORIZATION_FILE" \
  --audio-root "$BATCH_AUDIO_ROOT" --audio-root "$DRIVE_AUDIO_ROOT"
```

Before import, verify the full JSON checksum and all present original-audio copies.
Verify source ID/channel, actual acquired ffprobe duration, schema/settings, numeric
bounds and elapsed/RTF. `verify-bundle` alone cannot establish source/audio identity.

The operator recorded deletion of supplied originals. Where all matching originals
are already absent, append **`--allow-missing-audio`** to import and retain
**`audio_hash_verified: false`**. Both roots are still explicit. JSON integrity and
independent source identity/duration must pass. A present wrong hash cannot be
bypassed. Reacquired video, decoded PCM or similar duration cannot verify deleted
input bytes; no reconstruction or engine change is needed to manufacture a match.

### Alignment warnings are not evidence corruption

Follow the [timestamp policy](transcript-import.md#validation-and-timestamp-policy),
not generic forced-alignment assumptions. Preserve raw bytes and incoming segment
IDs/order/times. Outside-segment words, overlaps, zero-duration words and backward
segment starts can be authentic backend output. Internal word containment was an
earlier false-positive validation rule; do not reinstate it, sort segments, widen
them or clamp internal word boundaries. Only documented small recording-tail
normalization is permitted and counted. Genuine checksum, source identity/duration,
reversed/nonnumeric/out-of-bounds timing errors still block import.

Review warning regions with neighboring segment text, word arrays, samples and
frames; do not imply that accepted input is repaired or approved. In September 13,
IDs 974→975 move from 4543.58s to 4540.76s, with overlap through 976. The reviewed
4504.58–4564.5s passage encloses the uncertain transition, avoids cuts inside it,
and still needs human listening. See [the regional review](september13-review.md#alignment-receipt-and-regional-review).

### Provenance and cleanup

Verify converted correspondence; record per-recording engine/settings, source-audio
and transcript hashes, durations, elapsed/RTF, safe bundle identifier/relative file,
and verification outcomes. Copy only `receipt.archive_provenance` into
`videos[].transcription_provenance`; keep warnings in review notes, never add private
receipt keys. Public projections exclude provenance and review metadata. Raw JSON,
converted evidence and full receipts remain external/local-only, not Git or build assets.

For future retained originals, after successful import and receipt verification,
use `cleanup-audio` with the same owned workspace and both designated roots. It
checks all matching bytes before deleting only that recording's audio. Never delete
before verification, on hash mismatch or through a broad recursive sweep. If
`audio_hash_verified` is false, **do not call cleanup-audio**: report target originals
already absent and zero deletions, without claiming unrelated roots are empty.
Preserve raw operator JSON. After saving safe provenance/review notes, clean the
separate owned source/samples/frames/import evidence and helpers; do not delete
other cases' media or unverified original batch audio.

## M3 case lessons and quick checks

Read current final reports, including superseding notices, rather than treating an
earlier comparison's status as the latest classification.

| Case / check | Evidence-led action |
| --- | --- |
| [July 5 comparison](july5-comparison.md), [July 12 final review](july12-review.md) | D's YouTube title says July 5, but dated frames and release metadata converge on July 12; B remains July 5. Distinct programmes, not duplicate/restart/language variants. Keep metadata and original clocks separate. |
| Uncommitted IDs | D's comparison placeholder became `2026-07-12` before first commit, with audit history preserved. This does not authorize cosmetic renaming of published IDs. |
| Short `MZr169xBwrU` | Full clip inspected beyond the former smoke limit; retain musical/liturgical content as a separate unassessed candidate. No verified hymn title, invented prayer, duration-based failure or forced multipart relationship. Its July 12 title versus July 16 release remains explicit uncertainty. |
| Repeated wording | Hymns, prayers, creeds and dismissal recur across distinct services. Transcript repetition is neither duplicate-upload proof nor permission to remove genuine worship content. |
| PCM/correlation evidence | ffmpeg decoding, hashes, RMS, envelope correlation and spectrograms are measurements, not listening. Similarity is not an identity probability; different bytes do not exclude transcoding. State method/limits and unresolved audible questions. |
| [September 13](september13-review.md) | Current title is Simple but Demanding; Last Session / Eternal Life is a recap. Keep alignment warnings and incomplete names, not borrowed full names or silently reordered evidence. |
| Metadata isolation | Title, date, speaker, scripture, announcements and passage text require this recording's evidence. Do not infer a full name from appearance or another date. Keep unknown optional fields absent. |
| Uncertain versus failed | Real access, hash, identity or duration failures block real-content work. Flagged wording, source-alignment and historical-claim uncertainty can remain for human review. Unresolved suitability/relations stay unassessed; separately proven playable programmes need not be withheld. |
| Truthful scope | `complete` can describe a finished bounded comparison or full clip review, not necessarily full programme curation. State actual coverage; edited ASR excerpts and omission markers are not a full verbatim transcript. Do not mark unfinished work complete. |
| Attribution | Archive what the speaker says, retaining qualifications; historical, medical and theological statements are not independently verified facts or doctrine endorsed by the archive. |
| Bible and lyrics | ESV remains linked normalized references, never model-memory verse text or substituted translations. Mark omitted readings/lyrics/uncertain speech honestly and preserve timing/context. |
| Result isolation | Check ISO and natural-language full dates against acceptable service/video IDs; failed/rejected/unassessed records stay out of ordinary results. Do not conceal cross-date false positives with query-specific aliases or unrelated content edits. |
| Corrections/source editing | Correction URLs include stable service/video/passage/section/timestamp/page IDs and problem categories, no private state. Show Edit this transcript only for a stable GitHub source file; use durable file URLs rather than inaccurate line anchors. |

These lessons harden the operating procedure, not application special cases.
Penpot remains the design authority; no curation-driven palette, layout or visual
direction changes or source-frame edits. ESV/public-domain search and publication rules remain
those of the shared contract.

## Validation, delivery and normal signing

Use the milestone's relevant checks through bounded devenv when it is time to
validate, coordinating with active media work. Markdown-only handoffs do not require
running the project. Standard interfaces are:

```sh
scripts/devenv-run pnpm validate:archive
scripts/devenv-run pnpm lint
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm test
scripts/devenv-run pnpm test:search
scripts/devenv-run pnpm test:e2e
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build:preview
scripts/devenv-run pnpm editorial:guard -- BASE HEAD
```

Use actual ancestor/head revisions. Check schemas, IDs/timestamps, multipart order,
metadata/status isolation, warning notes and correction/edit URLs. Milestone gates
also require actual semantic/browser evaluation and desktop/390px/844×390 review,
correct seek/soft stop/replay/continue and labelled preview. Lexical/projection
checks alone do not prove browser acceptance. Production must exclude unapproved
content and support an honest empty archive; `dist/preview` must never be deployed.

Update `docs/run-log.md` after each recording with safe evidence, uncertainty,
cleanup, actual checks and next step. Inspect complete diffs and preserve unrelated
operator edits, especially future input manifests. With Git delivery authorized,
keep code/tests/docs and archive content in separate checkpoint commits on the
shared branch, with separate Code review and Editorial review PR sections.
**Every agent commit carries `Curated-by: agent`**, including a prepared commit
executed by the operator. Keep legal workflow edges in every commit.

For hardware signing, preserve normal Git signing and hooks. The established
pattern is a reviewed gitignored `.local/checkpoint-milestone<N>.sh` helper that
the operator runs in their **own normal terminal**. It performs normal signed
code/content commits, uses explicit intended-file allowlists and checks each diff;
it must not sweep future input changes, approve services or push implicitly. See
the M2 handoff in the run log as precedent, not a script to rerun blindly. Never
disable signing, change credentials, capture PINs/private prompts or put secrets in
logs. Verify status/history and both actual commits after the operator returns;
do not assume signing succeeded. Run the guard across the real range, then perform
authorized push/update of the existing draft PR. No merge or agent approval.

## Human-only approval

All agent interpretation stays `needs_review`. A correction to reviewed content
resets that status and clears reviewer fields **in the same change/commit**.
Service approval covers every video, passage and transcript. Production eligibility
is exactly reviewed service plus playable video, independent of workflow completion.

After whole-service preview review and committed corrections, the human uses a
clean repository to run:

```sh
scripts/devenv-run pnpm editorial:approve -- <service-id> --reviewer 'Human Name'
```

Only the human runs this command. It creates an approval-only change to
`editorial_status`, `reviewed_by`, `reviewed_at`, with `Editorial-Approval: <service-id>`
and no agent attribution. Agents never invoke it or manufacture the fields/trailer.
The guard is a process safeguard, not a security boundary against an agent holding
operator credentials; separate bot credentials are an optional operator choice.
