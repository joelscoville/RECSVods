---
name: recs-archive-curator
description: Use ONLY when a person explicitly asks to curate RECS Replay recordings by date, YouTube ID, or a bounded manifest. Produces evidence-grounded YAML and Markdown for human review; never approves or publishes interpretation.
---

# RECS Replay archive curator

Canonical procedure for Codex, OpenCode and Claude Code. Work in the person-invoked
session; this is not application logic, an LLM API integration or automatic AI publishing.

**Current model:** read the 2026-09-26 chapter-search decision first. Chapters are
the only new interpretation/search/review unit. Transcripts are private working
evidence; never rewrite or reproduce them in the repository. Frozen legacy material
is immutable. The later caption-source decision applies after historical batch 001
and to M5; do not replace the recorded evidence of work already in progress.

Then read the newer concise-service-outline brief and `docs/concise-outlines.md`:
it supersedes the older density/boundary/presentation rules. Outline the whole
service with neutral peer groups and a few sermon movements based on its actual
argument, often 3–6. Write one holistic attributed sermon description, not a list
of summaries. Every public chapter/cue title uses Title Case. Keep per-unit synopses
for retrieval/review only; never render them. Meaningful selective subsections are
an integrated chapter tree expanded by a button within the parent row, with smaller
title/time entries. Do not recreate the old event inventory as children.
The operator's `docs/implementation-prompts/decisions/2026-09-26-sermon-outline.md`
supersedes chapter granularity and display guidance for the current migration and
weekly work: outline the whole service with neutral peer groups, identify the sermon
thesis and its major supporting movements, and use Title Case for every chapter and
subsection title. Group routine service material rather than giving every item a
separate chapter; do not imply that non-sermon material is less important.
Show one holistic sermon description beneath the video; keep chapter/subsection
descriptions internal for search and review, never visible in the public interface.

## 1. Resume and bound the task

- Read `docs/run-log.md`, Git status/history, the shared
  `docs/implementation-prompts/README.md` and only the current milestone prompt.
  Preserve unrelated work; resume rather than repeating completed acquisition.
- Read `docs/curation.md` for commands/case lessons, `docs/archive-format.md`,
  `site/lib/archive.ts`, existing examples, taxonomy and the selected input manifest.
  Absent taxonomy/examples are not permission to invent content.
- Accept a date, physical YouTube ID or manifest path; work on one logical service
  or explicitly bounded batch. Only channel `UCLjwcZaIkiFEed1VgQYSsrw` (`@recsing`)
  is in scope; use its public feed for discovery and verify each source ID/channel.
- Operator input manifests are read-only. M4's approved historical input and twelve
  advance Colab transcripts are for that batch when requested/reached, not an M3
  task expansion. Approved read-only bundle verification is not curation permission
  for every file. Never automatically import/process the whole bundle.
- Keep physical IDs exact. Establish date-backed service IDs before first commit.
  An uncommitted placeholder may be renamed with evidence and audit notes; never
  cosmetically rename published IDs or break stable correction/source links.
- Penpot remains the visual authority. Do not change source frames or invent an
  alternative design. UI work follows the shared live/export contract; curation
  does not introduce styling or override the design through general design advice.

### Historical batch parallelism — operator decision 2026-09-26

- M4 batch 001 and future approved historical batches may use one subagent per
  logical service in parallel, with no fixed worker cap. Scope is still the exact
  approved batch; weekly single-service curation stays sequential.
- Main staggers acquisition starts about 1–2 minutes apart and assigns each worker
  an isolated external workspace, service YAML and review-document path.
- Workers write chapter metadata and their review report, with per-service committed
  vector sidecars generated from private transcript windows. They never author passage
  transcripts. During the existing-content migration, metadata-only workers change
  only summary/keywords; main generates/validates vectors and preserves internals.
  They do not change taxonomy, shared manifests, application code or the run log.
  Reuse existing terms; propose necessary new terms in review notes for main to merge.
- Workers verify their source/import and own-file integrity and perform their own
  media cleanup. Main alone updates shared progress/run log, merges taxonomy,
  reviews consistency across services and runs repository-wide validation/search
  regressions once at batch end, before separate signed code/content checkpoints.
- Authorization, finite bounds, needs_review, source checks and cleanup still apply.
  Parallelism is person-invoked development work, not app/CI agent infrastructure.

## 2. Keep all three axes independent

Use these exact `workflow_status` edges on applicable service/video records:

```text
discovered  -> registered | blocked
registered  -> in_progress | blocked
in_progress -> complete | blocked | registered
complete    -> in_progress
blocked     -> registered | in_progress
```

- `blocked` requires objective `blocked_reason`; clear it on resolution. Abandoning
  `in_progress -> registered` discards uncommitted interpretation, not prior reviewed
  work. Unchanged state is not an edge. Each committed transition must be legal.
- Never-interpreted records are identifier/trusted-metadata-only in `corpus/`, with
  no interpretation or `editorial_status`. Real access/tool/integrity failure before
  interpretation leaves a blocked identifier record, never invented fixture content.
- Service-level `editorial_status` is absent before interpretation, `needs_review`
  for agent interpretation, or human-only `reviewed`. Never use `pending` or
  `in_progress` as editorial values. Approval covers all videos, chapters and vectors.
- Any change to reviewed interpretation resets `needs_review` and removes
  `reviewed_by`/`reviewed_at` in the same change/commit. Only interpretation-equivalent
  mechanical changes retain approval, with the guard's documented `Mechanical-Change`
  trailer. See `docs/archive-format.md`; there is no semantic-migration bypass.
- Per-upload `media_disposition`: `unassessed`, `playable`, `failed`, `rejected`.
  Verify expected content/usability for playable. Technical failure and deliberate
  exclusion respectively require objective `disposition_evidence`; proposed rejection
  is confirmed only by human service approval. Shortness is not technical failure.
- Keep unresolved relationships/intended suitability `unassessed`, outside search.
  Do not downgrade an independently established programme because another candidate
  remains unresolved. Later unavailable media changes disposition, not `complete -> blocked`.
- `complete` describes the finished declared processing scope, not approval, a full
  service, listening verification or a complete verbatim transcript. State bounded
  comparison/excerpt scope and remaining human review honestly; do not mark unfinished
  work complete. Reviewable uncertainty is not automatically a processing blocker.
- Production requires service `reviewed` AND video `playable`. Preview additionally
  includes labelled playable `needs_review` records; never deploy preview. Never
  write `published` into source. Never run `editorial:approve`, assign `reviewed`,
  or create `Editorial-Approval`, even at high confidence or a person's request.

## 3. Authorize, bound tools, and own cleanup

- Accept an operator-set `RECS_MEDIA_AUTHORIZED=1` OR explicit current-conversation
  permission recorded in an ignored, untracked local file. Never set the flag or
  infer permission from public access, committed manifests or old logs. Pass the
  scoped file explicitly; follow `docs/media-tooling.md` and import-specific requirements.
  Honor sufficient current permission without repeated approval loops; stop only
  when required permission/scope is genuinely missing. Never log credentials/grants.
- Read `docs/media-tooling.md` and `docs/preflight-evidence.md`. Use pinned devenv via
  `scripts/devenv-run`: finite outer default 900s, process-group termination, exit 124.
  Check tools inside devenv. Keep native and whole-operation bounds finite, calibrated
  at roughly 3× expected time with 900s floor, allowing startup and all overlaps.
- Follow the shared bounded fallback sequence: preserve safe failure evidence,
  confirm children stopped, retry once, then non-global Nix; Homebrew only as last
  resort with `docs/toolchain-fallback.md`. Never wipe locks/stores or globally upgrade.
- Verify space and fresh external sentinel-owned workspaces. Install success/failure/
  interruption cleanup before acquisition; recover surviving owned roots after crashes.
  Keep model cache and operator source-audio roots separate. Never delete batch source
  audio before verified import or on a hash mismatch; see the import gate below.
- Audio-transcription fallback engine: whisper.cpp, verified external
  `ggml-large-v3-turbo-q5_0.bin`; record authoritative hash, source URL and versions.
  Keep engine/settings consistent within each approved processing batch.
  Default original language `en`; record detected alternatives, never silently translate.
  Intel macOS automatically uses `--no-gpu`; Apple Silicon retains GPU defaults.
  Reuse applicable calibration, not guessed timings. Local preflight's 60s smoke,
  failure test and first-full-recording calibration follow the linked tooling docs;
  fixtures never satisfy real-content gates. Approved imports require no new ASR.

## 4. Import approved evidence without rewriting its history

- Read `docs/transcript-import.md` and `$TRANSCRIPT_BUNDLE/README.md`/`SHA256SUMS`.
  Colab is operator-run for agreed large batches (roughly 3+ full services), never
  CI/app infrastructure, a hosted API or automatic VM dispatch. For future batches,
  obtain agreement before staging authorized audio only in `$DRIVE_AUDIO_ROOT`;
  ask the operator to click **Run all**. Reuse completed notebook outputs, collect
  small batches, bound failures/retries. Keep local copies in `$BATCH_AUDIO_ROOT`.
- No new inference/local retranscription for supplied M2/M3 IDs: `k27dmsPvmG8`,
  `W2IZ6MUX-Yk`, `94fynFHtreg`, `GkmB_KeBlBw`, `D-FyolbxJgk`, `OrsN83j3qxE`,
  `MZr169xBwrU`, `Z-vRVB-WucA`. Preserve exact faster-whisper 1.2.1/CTranslate2 4.8.2
  settings from the approved receipt. Never replace earlier whisper.cpp provenance
  or reprocess a batch merely to erase the approved engine difference.
- Use `scripts/import_transcript.py` per its documented `verify-bundle`, `import`,
  `cleanup-audio` interfaces. Import requires authorized acquired source/manifest in
  an owned external root. Verify full JSON checksum, schema/engine, ID/channel,
  actual ffprobe duration and timing/RTF; prefer hashing original audio in both
  designated roots before import. Reacquired video/PCM cannot verify original bytes.
- When the operator already deleted originals, use documented `--allow-missing-audio`
  and retain `audio_hash_verified: false`. Still pass both roots and verify JSON/source
  identity/duration. A present hash mismatch cannot be bypassed. Do not reconstruct
  audio, change engines or demand redundant permission to manufacture verification.
- Preserve raw JSON, source segment order/IDs/times and zero-duration words. Word
  containment inside ASR segments is NOT required: outside-segment words, overlaps
  and backward segment starts are documented warnings, not automatic corruption.
  Do not sort, clamp internal boundaries or silently retime; only the importer's
  documented recording-tail normalization is allowed and must be counted.
- Inspect flagged regions with adjacent text, words, frames and source samples;
  avoid editorial cuts inside unresolved alignment. `GkmB_KeBlBw` 974→975 backtracks
  2.82s around 4540–4544s; preserve it and flag the wider region for human listening.
  See `docs/september13-review.md`. Warning acceptance does not relax real checksum,
  identity, duration or numeric-bound failures: stop/report those blockers.
- Check converted evidence correspondence and record per-video engine/settings,
  hashes, elapsed/RTF, safe import source and verification outcomes. Copy ONLY
  `receipt.archive_provenance` to `videos[].transcription_provenance`; never copy
  private receipt paths/tokens or expose provenance/review notes in client output.
- Raw/imported JSON and full receipts stay external, local-only. After a verified
  import, receipt-based cleanup checks both roots before deleting only that video's
  matching audio. Never call `cleanup-audio` with false audio verification; report
  already-absent originals honestly, not files deleted. Preserve the raw bundle,
  save safe provenance/review notes, then clean owned curation media/evidence.

## 5. Inspect the programme and isolate metadata

- Verify acquisition manifest, source ID/channel, measured duration and absolute
  span. Use coarse samples and frames at suspected boundaries, not exhaustive
  frame review; refine uncertain transitions. Separate waiting/setup, legitimate prelude,
  programme and post-service; ambiguity goes to review, not invented church policy.
- For new ASR, select only programme plus clipped 2min margins. Local chunks are
  600s advancing 555s (45s overlap). Review roughly 10min windows with 30–60s adjacent
  context for either engine. Preserve each physical upload's absolute clock; reconcile
  actual overlap duplication without deleting genuine repetitions. Imported full spans
  remain full spans, never fabricated local chunks. For future historical/weekly
  work, quality-gated `en-orig` captions may supply private chapter evidence under
  the caption decision. Missing/failed captions use the existing local whisper.cpp
  fallback; record the actual per-video `transcript_engine`. The implemented commands,
  pinned dictionary, quality thresholds, provenance and failure/cleanup contract are
  in `docs/weekly-operation.md`. CI/discovery never fetch captions or run inference.
- Compare candidate dates, release metadata, frames and distributed content together.
  A YouTube title is fallible, a release date is not automatically the service date,
  and recurring prayers/hymns/creeds are not duplication proof. Group multipart uploads
  only with supported continuity/order; never from duration or shared date alone.
- Read `docs/july5-comparison.md` with its superseding `docs/july12-review.md`:
  `D-FyolbxJgk` is a distinct July 12 programme despite its July 5 title, not a duplicate
  of July 5 `OrsN83j3qxE`. Short `MZr169xBwrU` remains a separate unassessed musical/
  liturgical clip; no verified hymn title, failed/no-audio verdict or forced restart.
- Describe evidence methods literally: ffmpeg decoding, PCM hashes, RMS/correlation
  and spectrograms are measurements, not actual listening, speech accuracy or calibrated
  identity probabilities. State their limits. Similar envelopes do not prove duplication;
  different hashes do not exclude transcoding. Do not claim listening without doing it.
- Preserve trustworthy human titles, speakers and scripture; resolve conflicts through
  convergent evidence and notes. Distinguish today's title from “Last Session” recap.
  Never borrow names, scripture, announcements or passages from another service/date,
  or identify people by appearance. Unknown optional metadata stays absent.

## 6. Write reviewable interpretation and corrections

- Follow strict service/chapter schemas and existing taxonomy. Keep ordered
  physical videos, stable IDs, measured durations, original language/spans and evidence.
  Group routine activities into neutral peer chapters and identify the sermon’s
  major argumentative movements, preserving coherence and uncertainty over quotas.
  Existing original boundaries remain immutable internally; new public grouping
  follows the approved concise-outline amendment, with stable mappings and vectors.
- Include chapter title, type, optional supported speaker, topics, normalized scripture,
  a short internal synopsis where useful and at most ten distinctive spoken keywords.
  Write one separate service-level sermon_description, naturally conveying direction,
  supporting ideas and application without Thesis/Points labels or a fixed template.
  Uncertainty belongs in review notes, not fabricated detail. No questions, confidence
  scores or new transcript fields are required. Never fill missing speech from memory.
- Compute committed chapter vectors with `scripts/chapter-vectors.ts generate`, using
  the pinned model and overlapping private transcript windows. Verify with `verify`.
  Never embed summaries as substitute speech. Empty evidence produces an explicit
  zero row and remains metadata-searchable. See `docs/chapter-vectors.md`.
- In the frozen migration, derive metadata only from existing passage summaries and
  spoken keyword evidence; verify against `540abab`. Preserve every internal passage,
  transcript byte, original ID/boundary, service/video metadata and provenance.
- Attribute historical, medical, theological and other claims to the speaker; retain
  their qualifications. Recording a doctrinal statement does not endorse it as doctrine.
- Never supply Bible text from memory. ESV readings/quotations remain reference links,
  not bundled verse text, including inside transcripts. Keep omission markers/timing;
  do not substitute another translation. Verified public-domain BSB is hidden search
  input only per the shared Bible contract; recheck terms before relying on them.
- Correction links carry stable service/video/chapter/timestamp/page identifiers and
  chapter time, title, scripture, speaker, topic or other categories. No private state,
  transcript editing or passage correction links. Old URLs resolve via minimal ID maps.
  Preserve review resets; correction affordances never grant agent approval.

## 7. Quick checks and delivery

- For weekly work, follow `docs/weekly-operation.md` and `docs/operations.md`: start
  from the latest default branch after implementation, register identifiers, try
  original-English captions in an authorized fresh external workspace, and invoke
  existing local ASR only when the declared fallback requires it. Unfinished live
  recordings wait. Copy only safe source provenance; preserve private evidence until
  vector verification, then clean owned temporary work. Never alter old engine history.
- Run `pnpm validate:outlines`, `pnpm index:verify`, `pnpm verify:tracked` and both
  build modes alongside the existing checks. Keep the discovery issue open until
  actual publication or explicit rejection. A weekly draft PR stops for human review;
  agents do not approve or deploy to finish the checklist.

- Check: metadata isolated by video/date; unknown speakers honest; short clips retained;
  failed/rejected/unassessed absent from ordinary results; truthful workflow/coverage;
  warning regions flagged; source/edit links valid; no media, credentials, private paths,
  raw evidence, reviewer/provenance leakage or ESV text tracked/published.
- Follow `docs/curation.md` and the milestone's validation/completion gate: schemas,
  timestamps/IDs, search/date isolation, correction URLs, editorial guard, non-root
  production/preview and responsive playback. Distinguish lexical/projection checks
  from actual semantic/browser acceptance. Never invent query-specific fixes or claim
  the whole milestone passed from one case. Real access failure stops real-content work;
  reviewable uncertainty can remain flagged without redundant approval loops.
- Update the run log after each recording with safe evidence, scope, uncertainties,
  checks, cleanup and next step. In parallel historical batches, workers report these
  to main; only main writes the log and runs the final global checks. Preserve unrelated
  edits and read-only future inputs.
- Only with authorized Git delivery: inspect full diff/status/history; separate
  code/tests/docs and archive-content commits on the shared feature branch, maintaining
  legal edges. EVERY agent commit includes `Curated-by: agent`, also when a human
  executes the prepared commit. Never create an approval trailer or bypass signing/hooks.
- For hardware signing, use the operator's normal terminal/helper handoff documented
  in `docs/curation.md`; never capture credentials/private prompts. Verify actual commits,
  run guard on the real range, then authorized push/update of the one draft PR with
  separate Code review/Editorial review. Never merge/approve. Report blockers and stop
  at the requested scope; continuous milestone work advances only after its gate passes.
