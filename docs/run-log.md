# RECS Replay implementation run

## 2026-09-25 — Milestone 1 preflight blocked

- Branch: `feat/recs-replay-implementation`.
- Read the shared implementation contract and Milestone 1 prompt. Reviewed later milestones for dependencies; none has begun.
- Initial repository state: clean, with implementation prompts and design references but no application scaffold or devenv configuration.
- Confirmed that live Penpot MCP can read Page 1 and locate the named desktop and mobile source frames. No source frames were modified. Live frame exports and snapshot refresh have not yet run.
- Located the checked-in Penpot frame exports and reference metadata under `docs/design-reference/penpot/`.
- **Blocker:** `RECS_MEDIA_AUTHORIZED=1` was not present in the operator-started environment. The shared contract and Milestone 1 preflight require stopping here. The agent did not set or change the authorization variable.
- Added an identifier-only blocked record for `ZTDYIJUDb0M`. No recordings were acquired or processed; no interpretation, transcript, editorial status, or approval was created.
- No dependencies were installed, devenv evaluation attempted, application tests run, or milestone completion claimed. No commits, pushes, or draft PR have been created yet.
- Decisions: preserve Penpot as visual authority; adapt its desktop/mobile compositions responsively rather than inventing a visual direction. All eventual agent-authored interpretation must remain `needs_review`.
- **Next step:** obtain operator-provided authorization in the running environment and recheck its presence. Then create the bounded `scripts/devenv-run` wrapper and reproducible devenv, verify the media toolchain inside devenv, and execute the remaining Milestone 1 preflight. Refresh live Penpot exports before UI implementation. Move the blocked record along the permitted workflow transition once the blocker is resolved.

Milestones 1–5 remain incomplete. The empty historical batch input permits tooling-only Milestone 4 acceptance when that milestone is reached; it does not waive the real-media gates for Milestones 1–3.

## 2026-09-25 — Authorization resolved; toolchain preparation

- The operator explicitly permitted downloading and processing recordings and approved accepting current-conversation permission instead of requiring a terminal flag. Updated the shared and Milestone 1 authorization instructions accordingly; the scoped authorization record is local and gitignored.
- Added the initial devenv configuration and portable process-group timeout wrapper. Host bootstrap tools are devenv 1.11.1, Nix 2.31.5, and Python 3 on x86_64-darwin. Initial available disk space: approximately 76 GiB.
- Next: generate the lock through bounded devenv evaluation, verify native tools inside it, and run the authorized smoke/failure/calibration checks. Milestone 1 remains in preflight.
- First bounded `scripts/devenv-run python3 --version` attempt failed after 76.1 seconds: the rolling Nixpkgs 26.11 source explicitly rejects x86_64-darwin. A lock file was generated. The process exited; no evaluator was left running. Switched the project input to the error's supported `nixpkgs-26.05-darwin` branch for the bounded retry, without deleting the lock or changing global channels/store settings.
- Second evaluation failed after 42.7 seconds: unversioned devenv modules independently imported a rolling 26.11 package source for their task runner. Its process exited normally. Bounded non-global `nix shell` using revision `bd495b825e5c4365131f9b744cce923d42c06158` succeeded: yt-dlp 2026.08.19, FFmpeg/ffprobe 8.1.2, whisper-cpp package 1.8.4 (CLI executable SHA-256 `ca96421296b25286fafcbfa319ad2c749abb9e70f2ed7a719ca45d1a1c0836e3`). No Homebrew installations or global Nix configuration changes were made.
- Identified and applied the targeted primary-environment fix: explicitly pin devenv modules to v1.11.1, matching the installed CLI. Started a bounded verification with that configuration; results pending.
- Rechecked https://www.esv.org/api/ on 2026-09-25. The 500-verse/half-book storage restriction and stated rate limits agree with the prompts; retain reference-only ESV display and no bundled ESV text.

## 2026-09-25 — Media preflight passed; Milestone 1 implementation underway

- Primary devenv evaluation succeeded in 371 seconds after the explicit module pin. Versions match the successful temporary fallback. Subsequent shell entry takes under one second.
- Verified the fixed transcription model against authoritative Hugging Face LFS metadata. See `docs/preflight-evidence.md` for the pinned revision, published SHA-256, and live test evidence.
- Primary smoke, near-empty failed-stream handling, and full calibration passed; 38 Python tests passed. Intel Metal inference aborted during calibration, so the pipeline now uses CPU inference on Intel macOS and records that setting. Calibration RTF: 0.63836.
- Acquired `ZTDYIJUDb0M` from the verified RECS channel, duration 6759 seconds. Captured 30-second audio windows and frames every five minutes. The opening sample explicitly begins preparation for worship; the final coarse frame still contains church announcements. Selected the full 0–6759 span, with margins naturally clipped to recording bounds.
- Started bounded baseline transcription in session `recs-baseline`: per-native timeout 1200 seconds; overall timeout 13260 seconds from calibration. It remains local evidence, not approved archive content. Clean the owned baseline workspace after interpreting or abandoning the run; keep the verified model cache.
- Added archive validation/editorial core and tests; TypeScript dependency installation and checks are next. Frontend has not been implemented yet. No milestone is complete and no service is approved.

## 2026-09-25 — First integrated build

- Implemented Astro/React routes, Penpot-derived responsive components, browser-only search, self-hosted embeddings, and YouTube player adapter. Both empty production and preview builds passed at `/replay-check/`; output verification confirmed zero passages and no private media.
- The live desktop-new frame was exported and inspected by the main agent. A later full-refresh attempt found Penpot suspended; all 13 saved exports were checked against their manifest dimensions, byte sizes, and hashes. Retained original snapshot capture dates. Remaining responsive work uses these complete saved references.
- Search tests: 24 passed, including real Node/Chromium inference agreement with external browser requests blocked. Archive/editorial tests: 134 passed after operator-approved isolation of disposable test repositories from personal Git signing configuration. Real-repository signing is unchanged. Player/local-state tests: 20 passed. Type checking passed; two unused destructuring lint findings were fixed by the underscore-discard convention and await rerun.
- Added canonical curator skill with thin harness adapters, build/output checks, and CI. Browser application tests and final real-content visual review remain pending. Baseline full transcription continues in its bounded session.

## 2026-09-25 — Real-content verification and operator disposition

- Baseline full transcription finished in 4808.914s (RTF 0.711483). Evidence-based curation created 22 sections and initially 72 passages. One bounded same-model short-window recovery pass took 547.255s and recovered major opening/Communion/prayer gaps, producing 77 passages. See `docs/first-recording-review.md` for exact evidence and uncertainty.
- The operator explicitly chose “Flag it and continue” for the remaining 251.08–318.34s quiet-prayer/spoken-lead-in uncertainty. Marked agent workflow complete while retaining needs_review and all uncertainty notes. This is not editorial approval or a claim of a complete verbatim transcript.
- Full tests passed: 178 TypeScript tests (including opt-in real Node/browser embedding checks), 39 Python tests, and 12 browser tests at desktop/portrait/landscape with real preview data and deterministic player adapter. Production excludes all content; preview build now includes 77 passages.
- First visual pass identified an unbounded desktop chapter column, a missing visible passage transcript, reference links lacking ESV labels, and a home card using a chapter description instead of the displayed sermon title. Corrected these in one batch. Actual YouTube embedded playback loaded the correct recording at the requested 3133-second start in the browser; capture shows real video, not the test adapter.
- Next: final visual confirmation and checks, clean owned temporary media, checkpoint code/content separately, open the draft PR, then load Milestone 2. Remaining editorial uncertainty is explicitly deferred by the operator.

## 2026-09-25 — Milestone 1 checks passed; checkpoint preparation

- Final lint, typecheck, archive validation, unit/Python tests, focused search tests and all 12 browser tests passed. The two opt-in real embedding tests passed in the earlier explicit opt-in run; default runs skip them deliberately. Both final build modes at `/replay-check/` passed: 0 production / 77 preview passages.
- Final visual review returned ship at its bounded scope; see `docs/ui-verification.md`. Real YouTube playback started correctly; after seeking the actual video near the endpoint, pause/continue/replay were observed. A prior uninterrupted-playback wait timed out; no full-duration network-playback guarantee is claimed.
- Source Penpot frames and saved image assets remain unchanged. No unreviewed interpretation is published or approved.
- Next: clean the owned baseline media workspace, inspect/stage intended code separately from archive interpretation, create the two milestone commits with agent trailers, push and open the draft PR. Hardware-key commit signing may require operator terminal handoff. Do not bypass signing. Milestone 2 begins after that checkpoint succeeds.

## 2026-09-25 — Checkpoint waiting for operator signing

- Removed the owned baseline workspace with `pnpm media:cleanup`; verified model cache retained externally. Staged only the code/test/documentation checkpoint. A read-only review of all 79 staged diffs found no blocking issues or private artifacts. Archive interpretation remains separate and unstaged.
- Started `git commit -m "milestone 1: build one-video vertical slice" -m "Curated-by: agent"` in session `recs-dev`. Git requested hardware-key signing; handed the session to the operator. A bounded wait returned that the operator had not yet attached. Do not bypass signing, inspect the session while the operator owns it, or assume the commit succeeded.
- **Resume:** wait for the operator to return `recs-dev`, then inspect commit result/status/log. If the code commit succeeded, include this run-log update with the separate archive-content checkpoint, stage only `services/`, `corpus/`, `docs/first-recording-review.md` and the run-log update, inspect the diff and commit with the content checkpoint message plus `Curated-by: agent`. Run the editorial guard across both commits, push, open the draft PR, then begin Milestone 2. If signing failed, preserve files and create a fresh commit after the operator resolves it; do not amend or disable signing.
- Milestone 1 implementation/build/test evidence is ready; its delivery checkpoint is not yet confirmed. Milestones 2–5 have not begun. No archive approval or production deployment has occurred.

## 2026-09-25 — Resumed after signing

- Confirmed code checkpoint `ce86100` (`milestone 1: build one-video vertical slice`). The operator returned the shell; private signing interaction was not inspected.
- Next: commit the separate needs_review archive content and review notes, run the editorial guard over both checkpoints, then push and open the single draft PR before Milestone 2.

## 2026-09-25 — Milestone 1 delivered; Milestone 2 begun

- The operator completed content checkpoint `5b22aa9`; code checkpoint is `ce86100`. Working tree was clean. Editorial guard passed across both commits from `d328f00`.
- Pushed `feat/recs-replay-implementation` and opened the single evolving draft PR: https://github.com/joelscoville/RECSVods/pull/1. Remote CI was pending on first inspection. No merge, editorial approval, or deployment occurred.
- Loaded Prompt 2. Process one logical media case at a time, beginning with the three-upload 16 August service; in parallel, implement deterministic Bible enrichment and static browse/navigation improvements. Preserve the established Penpot components and palette.
- Hardware signing requires operator participation. Future checkpoints must retain normal signing, separate code/content commits, and the same PR.
- Remote Milestone 1 CI passed. Milestone 2 Bible enrichment/reference parsing and browse/local-state/context code are implemented and passed focused tests; integrated build verification remains pending.
- August part 1 was processed and cleaned (7 sections, 8 passages). Part 2 acquisition/sampling verified the displayed sermon title, Hadi Wijaya, and 1 Corinthians 3:1-9, but the new agent-shell version lost acknowledgement of its long-running command. The owned process was terminated and its workspace cleaned; partial service explicitly marked blocked. No denial or unavailable media was observed. Next attempt will use a single ordinary non-interactive command through the existing finite process-group wrapper, with the outer tool wait longer than its deadline; no session approval gate will be bypassed.

## 2026-09-25 — August multipart case completed

- Ordinary bounded non-interactive commands resolved the session-supervision issue. All three 16 August uploads are now processed and playable, in one needs_review service: 41 sections / 72 passages. Part-2 span 0–1802.801s took 2175.501s; part-3 span 0–3003s took 4412.586s. Finite native/wrapper/tool waits and evidence are recorded in `docs/august-multipart-review.md`.
- Verified displayed title From Infant to Instrument, Hadi Wijaya, 1 Corinthians 3:1-9. Restart gaps and uncertain words remain explicit; no reconstructed missing speech or editorial approval.
- Schema checks and 138 focused archive/browse/player tests passed. One exact candidate per upload ranked first with the correct physical ID/timestamps. All owned media workspaces/helpers cleaned; fixed model cache retained. No other logical case was processed concurrently.
- Next: the 28 June failed/full-upload case, followed sequentially by Authority and Sacrifice; complete Milestone 2 acceptance against all five services before its checkpoint.

## 2026-09-25 — June transcription timeout; operator-approved retry

- June's failed upload again measured 6.561s and was rejected cleanly as near-empty. The full upload was verified at 6090s and sampled throughout; no access failure occurred.
- A native invocation exceeded 1200s during the full transcription, after 3193.915s total elapsed. The 27000s outer bound did not expire. Failure cleanup removed partial evidence; no June interpretation was fabricated. Details: `docs/june-stream-review.md`.
- The operator explicitly selected “Increase timeout and retry”: increase the per-native limit to 2400s, retain the 27000s whole-operation bound and the same model/engine. Reacquire only the full upload and retry once; retain verified failed-upload and programme-boundary evidence. Do not repeat previously successful services or remove finite limits.

## 2026-09-25 — Operator supersedes CPU retry with supplied GPU transcripts

- Latest operator decision supersedes both the June CPU retry and all earlier second-worker instructions. No VM dispatch or VM infrastructure is to be added. Local whisper.cpp remains primary, especially for the weekly single-service workflow. Operator-run Colab is an explicitly agreed large-batch exception only, never automated in CI or the app.
- Read the operator bundle README and verified SHA256SUMS for all eight supplied JSON files: June full, Authority, Sacrifice, 13 September, both 5 July uploads, 12 July, and Tripping. The README resolves the garbled IDs in earlier messages; exact IDs match the implementation prompts.
- Supplied engine: faster-whisper 1.2.1 / CTranslate2 4.8.2, large-v3-turbo, float16, Tesla T4, beam 5, word timestamps, no VAD, condition_on_previous_text false. Preserve the distinct original whisper.cpp provenance for September 6 and August 16. No local retranscription of the eight supplied recordings.
- Process inventory found no June media/whisper/ffmpeg job; its retry workspace was absent. Removed the unused retry helper. Earlier timed-out partial evidence had already been cleaned. No active job required termination.
- Next: add strict local-only transcript import/verification and per-recording provenance, verify duration and audio hashes against source, then delete each imported recording's matching audio from both operator-designated storage locations. Retain raw JSON as local evidence only. Continue June curation, then Authority and Sacrifice, followed by the normal Milestone 2 gate. M3 source inspection and competing-upload comparison are still required.
- Import tooling now verifies all eight checksums/engine recipes and scans all 8,473 segments / 89,109 words. Authentic internal word/segment alignment differences are retained and flagged rather than silently repaired. The September 13 file includes a 2.82-second segment-start backtrack requiring regional curation review. Numeric bounds, checksums, source identity and duration/audio checks remain enforced. No source audio has been deleted yet; deletion follows each verified import.

## 2026-09-25 — June completed using verified operator batch evidence

- June now has one complete/needs_review logical service, 42 sections / 87 passages. Both physical uploads are retained: failed `wh4mCRKRJ-4` (6.561s, no passages) followed by playable `k27dmsPvmG8` (6090.161s), selected for ordinary playback. Displayed sermon title Teaching us all things… and references are documented in `docs/june-stream-review.md`.
- Imported the supplied faster-whisper evidence without running inference. Transcript/audio hashes verified; duration delta −0.0080625s. Operator-recorded GPU elapsed 195.947s, RTF 0.03217. Per-video provenance preserves exact engine/settings/hashes and verification results.
- Audio cleanup after successful import removed one matching Drive file; its local batch copy was already absent. Both locations rechecked absent. Owned acquired video, frames, converted evidence and helper were cleaned; original local JSON bundle retained.
- Schema, 159 archive/browse/player tests and 38 importer tests passed. Preview now has 236 passages across three services; production has zero. Failed upload excluded. Next logical case: Authority, then Sacrifice; no local retranscription of supplied inputs.

## 2026-09-25 — Supplied batch audio already removed

- Before Authority import, both operator-designated batch-audio roots were found empty. The externally maintained bundle README now records deletion of the original audio after checking the transcripts. No Authority download or curation had begun; no files were removed by that attempt.
- The shared contract requires verifying original audio hashes where bytes are present, not inventing verification when absent. Continue with the importer's explicit `--allow-missing-audio` path for already-deleted source audio: verify raw JSON checksum, approved engine/schema/timestamps, and independently acquired source identity/duration; preserve the supplied audio SHA-256 with `audio_hash_verified: false`. Do not reconstruct or retranscribe evidence merely to manufacture a matching hash. Future batch audio still must remain until its import is verified.
- The bundle now also lists advance historical transcripts; do not curate those before Milestone 4 verifies the operator input manifest. Preserve operator changes to that input.

## 2026-09-25 — Authority completed

- Authority now has 32 chapters / 63 needs_review passages, with trusted title, date, Rev. Yong Teck Meng, Luke 20:19-26 and Romans 13:1-7 preserved. Fresh source channel/ID and ffprobe duration 3906.841s verified; imported 696 supplied segments / 11,344 words.
- JSON checksum, engine/settings, timestamp bounds and source-duration checks passed. Operator GPU elapsed 128.254s / RTF 0.03283. Original batch audio was already absent, so exact provenance explicitly records audio_hash_verified false. No inference or replacement audio-hash claim.
- Romans 13 / Rom 13 and the government question returned relevant Authority passages at rank 1 in deterministic search. Focused tests passed. Current projections: 0 production / 299 preview passages; semantic/browser milestone acceptance still pending.
- Owned acquired media, samples, frames and imported evidence/receipts/helpers cleaned. Both batch-audio roots remain empty; raw bundle retained. Next: Sacrifice, then integrated Milestone 2 verification and checkpoint.

## 2026-09-25 — Milestone 2 corpus ready for integrated verification

- Sacrifice completed as a pre-trimmed sermon: 21 chapters / 47 needs_review passages, trusted full title/date and Genesis 22:1-19 / Romans 12:1-2 preserved. No invented service portions. Source ffprobe 3104.181s; imported transcript duration 3104.1706875s (delta −0.0103125s), supplied GPU RTF 0.03149. Original audio already absent, explicitly audio_hash_verified false. Source/JSON integrity and other import checks passed; no inference.
- Both named Sacrifice queries ranked first in deterministic search. Schema/focused tests passed. All owned samples/video/frames/import artifacts/helpers cleaned, raw bundle retained.
- All five M2 logical services and eight required physical uploads are now represented. Current preview projection has 346 unreviewed passages; production has zero. Next: full production/preview builds, hybrid and browser acceptance, responsive screenshots, separate M2 code/content commits and PR update.
- The operator has modified `docs/implementation-prompts/inputs/historical-batch-001.yaml`. Preserve that change separately from the M2 checkpoint; validate it when Milestone 4 begins.

## 2026-09-25 — Milestone 2 integrated checks passed

- Both final build modes at `/replay-check/` passed: five services / eight physical videos, seven playable and one failed; 346 labelled preview passages / zero production passages. Public artifacts contain no media or private provenance/authorization records.
- Actual-model core evaluation passed 27/27 checks; all named query targets ranked first in exact and hybrid modes, including the government question. All 27 browser executions passed across desktop, portrait and landscape, including multipart IDs/timestamps, static browse URLs, history/progress, and real-worker search.
- Lint/typecheck/archive/Bible integrity passed. Full default tests: 253 TypeScript passed (3 optional model checks skipped), 77 Python passed. Actual-model evaluation and browser tests independently exercised the model against the full core corpus.
- Final M2 screenshots and fresh scoped Penpot-reference review returned ship. No source frames or reference images changed. Evidence: `docs/milestone2-checks.md`, `docs/ui-verification.md`.
- Next: inspect and stage only intended M2 code/docs/tests, retaining archive content as a second checkpoint and leaving the operator's historical-input edit unstaged. Signed commits, editorial guard and PR update precede Milestone 3.
- All 50 staged code files and the four upcoming service/review pairs received a fresh read-only checkpoint review; no M2 blockers found. Staged BSB bytes match the documented source hash. Only the operator's historical input remains an unstaged tracked edit; M2 content remains untracked for its separate commit.
- Real-model focused search/scripture tests passed 65/65, including all optional Node/browser embedding checks. No app or archive changes followed the passing builds/browser evaluation; later edits only recorded verification and prepared the checkpoint.
- **Signing handoff:** code checkpoint is staged. The gitignored `.local/checkpoint-milestone2.sh` performs the normal signed code commit, stages only the four reviewed M2 service/review pairs, checks their diff, then performs the signed content commit. It does not stage the historical input or push. The operator can run `sh .local/checkpoint-milestone2.sh` from the repository, completing both hardware-key prompts in their own terminal. Do not bypass signing or treat the milestone delivery as complete before verifying both commits.
- **Resume after signing:** inspect status/log and both new commits, run editorial guard from `d328f00`, push the existing branch, update draft PR #1 (Code review / Editorial review), then load Prompt 3. Expand M3 evaluation beyond the current exact five-service/eight-upload inventory. Preserve the operator's historical-input change for M4.

## 2026-09-25 — Milestone 2 delivered; Milestone 3 started

- Operator completed signed checkpoints `8bc9409` (code) and `b1fb74e` (needs_review content). Editorial guard passed across all four implementation commits. Pushed both and updated the same draft PR #1. M2 remote CI was pending on initial inspection.
- Only the operator's historical-input change remains outside the committed checkpoint. Do not overwrite or stage it for M3.
- Loaded Prompt 3. Next cases: September 13 baseline, comparative July 5 pair, short July 12 recording, and Tripping; use the verified supplied Colab evidence, not local transcription. Retain sampled-frame/source-duration checks, per-recording provenance and honest classifications.
- In parallel with one logical curation case at a time, implement correction/edit links and repository templates, broaden the evaluation set to growing corpora, and perform responsive/accessibility/state checks. No source Penpot changes or unreviewed publication.
- September 13 baseline is complete/needs_review with 40 sections / 91 passages, bringing preview to 437 (production zero). Verified supplied transcript/source duration and inspected the flagged 2.82s backtrack region; ASR alignment uncertainty remains explicit. No inference. All owned media/import evidence cleaned; source JSON retained. Evidence: `docs/september13-review.md`.
- Correction links and review templates implemented. A structured Vite build constant fixed an object-valued test-environment mismatch; 46 focused tests including built-artifact acceptance now pass, along with typecheck/lint. The non-root preview exposes 437 passage correction links and edit links only for 346 tracked-source passages; the 91 untracked new passages correctly have no claimed GitHub edit target yet. Next media case: compare the July 5 pair before choosing dispositions.
- M2 remote CI passed. July comparison found distinct dated programmes: D-FyolbxJgk's title says July 5, but its 30s date slide and release metadata say July 12; OrsN83j3qxE is July 5. Distributed content/frame anchors and measured decoded-audio comparisons support separation, not duplicate rejection. The title conflict remains needs_review.
- July 5 B is complete/needs_review with 36 sections / 98 passages. A is temporarily retained as an unassessed comparison record, with full-programme curation deferred to the upcoming July 12 case. No video was erased or falsely rejected. Current preview has 535 passages; production zero. All owned pair-comparison media cleaned.
- Next: fully curate the distinct July 12 programme and inspect its relationship to short MZr169xBwrU, preserving the short clip based on evidence rather than duration. General full-date query matching needs tightening: natural-language exact dates currently admit incidental partial matches from other service dates. Address this in M3 search evaluation, not with query-specific aliases.
- July 12 full programme D-FyolbxJgk is now fully curated (43 chapters / 94 passages) under truthful uncommitted ID 2026-07-12, complete/needs_review/playable. Verified To be Nothing, John 15:1-11 and Matthew 10:40-42. The temporary false-date comparison ID was replaced before its first commit; evidence history remains in the comparison report.
- Entire short MZr169xBwrU inspected and retained separately, complete/needs_review/unassessed, with one reference-only musical/liturgical passage. Its relationship/intended use remains unresolved; title and release-date difference documented, not treated as proof of failure or duplication. Suspect ASR advertising and unreliable lyrics were withheld. Both raw-source identities/durations/imports verified; owned evidence cleaned. See docs/july12-review.md.
- Tripping completed (26 sections / 59 passages), preserving trusted metadata and recording exact supplied Colab provenance. Its stumble-question candidate passages are recorded in docs/tripping-review.md and the evaluation set. All owned evidence cleaned; no inference or unrelated audio deletion.
- Current M3 source totals: 10 services / 13 uploads / 304 sections / 689 authored passages; 688 preview passages / zero production, with the failed June upload and unassessed short July candidate excluded. Next: build/evaluate full M3 corpus, exercise correction/UI states and automated accessibility/keyboard checks, then checkpoint.
- General date-query parsing and growing-corpus evaluation implemented; 108 focused tests passed (3 optional model tests skipped), plus typecheck/lint. Normal evaluation permits future human-approved publication; --implementation checks the current unapproved-only run. Canonical curator instructions condensed and hardened from actual case evidence.
- Full M3 builds passed (688 preview / zero production), and the human-readable actual-model evaluation passed all 74 checks. Tripping's relevant stumble segment ranked first; the new baseline's knowledge-of-God segment ranked second, within its threshold. Full-date queries now restrict results to the exact event date across equivalent formats.
- M3 browser QA passed 69 executions across three viewports; 21 tagged axe scans across seven routes had no violations/incomplete results. Keyboard and DOM-derived ARIA inspection performed; actual screen-reader and physical software-keyboard checks remain unclaimed. Fixed iframe focus after reveal and long overlay-title containment; added standard issue-body fallback before the GitHub template reaches the default branch.
- Added optional structured series metadata and conditional static series browsing to complete the requested capability. No actual archive series was assigned or invented. Focused series/archive/browse/search tests passed (237, with 3 optional model checks skipped), plus typecheck/lint. Final capture/build confirmation and signed checkpoints remain next.

## 2026-09-26 — Milestone 3 final verification

- Final non-root builds passed with 688 preview / zero production passages; nine eligible preview service pages, with the unassessed short clip preserved only in source. Final screenshot/reference review returned ship; all 18 measured route/viewport combinations have no horizontal overflow.
- Full TypeScript suite passed 355/355 with actual-model, real-worker and correction-artifact opt-ins enabled; Python 77/77 passed. Full browser suite passed 69/69, including 21 tagged axe scans, after the final Series support and correction changes. Lint/typecheck/archive validation passed.
- An initial combined verification exceeded its five-minute external tool wait during browser tests, with no failed product assertion. Identified/stopped only its orphaned preview-server process groups. Test server commands now use direct Node plus graceful shutdown; the bounded full rerun passed in 6.4 minutes. Do not mistake the earlier interrupted run for completion evidence.
- All archive interpretation remains needs_review; no inference was performed for the supplied M3 transcripts. Source frames/reference images remain unchanged, and temporary acquired/import evidence was cleaned by each curation case.
- Next: review/stage M3 code and the five new service/review records separately, preserve the operator's historical-batch input unstaged, then obtain normal signed checkpoints. Run the editorial guard, update draft PR #1 and remote CI, then start Milestone 4 from its approved input.
- Fresh checkpoint review read the complete code diff and all five new services/four review reports. It found two browser assertions that would incorrectly fail after future human approval. Both now derive expected production content/badges from source status, with independent fictional empty/reviewed/unreviewed render tests. All 18 targeted unit checks and six affected browser executions passed; the follow-up reviewer scored both findings resolved. No actual source was approved or changed for these checks.
- Code is staged and content remains separate. The gitignored `.local/checkpoint-milestone3.sh` creates the normal signed code commit, stages only the five reviewed M3 service files/four reports, then creates the signed content commit. The historical-input edit stays unstaged. Operator command: `sh .local/checkpoint-milestone3.sh` from the repository; complete both hardware-key prompts privately.
- **Resume after signing:** verify both commits and status, run editorial guard from `d328f00`, push/update draft PR #1, and begin Prompt 4. All previous source content and Penpot assets were preserved; unassessed/failed media remain excluded and production still has zero passages.
