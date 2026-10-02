# Milestone 5 — local MVP and operations evidence

Evidence collected 2026-09-26 UTC (the Singapore-local run continued after midnight).
This is implementation/local-preview acceptance, **not editorial approval or live
deployment acceptance**. All 22 services remain needs_review; no new service was
interpreted during M5.

## Implemented operations

- Credential-free, channel-verified Atom discovery, recent-feed limits, read-only
  local dry run, scheduled/manual issue reconciliation, all-state ID deduplication,
  managed-block-only updates, preserved human notes, and safe retry after partial
  API failures. No media/AI/interpretation or repository commits in discovery.
- Least-privilege validation/editorial jobs, main-only gated production build and
  Pages artifact/deployment, serialized deployments, cached dependencies/verified
  model assets, and non-root route/asset verification. Workflow syntax was checked
  with `actionlint`; deployment was **not invoked**.
- CI explicitly avoids model inference: 73 exact-only acceptance checks and browser
  worker/model blocking with real-model cases skipped. Full semantic checks remain
  local and person-invoked; builds copy committed vectors.
- Person-invoked original-English caption gate, hash-pinned public-domain dictionary,
  source/track/scope/provenance checks, private canonical evidence, automatic cleanup
  of failed work, and explicit existing-whisper.cpp fallback handoff. No hosted ASR.
- Whole-service outline validation (Title Case, a natural sermon paragraph), current
  weekly curator/runbook, repository administration, human approval, corrections,
  roll-forward recovery and model/Bible/dictionary update procedures.

## Actual checks and bounded observations

- Full default suite: **521 TypeScript passes / 4 optional skips**, **93 Python passes**.
  Focused model/browser/correction suites then passed **103/103**, enabling all four
  optional integrations. After adding explicit accepted-caption hash binding and
  engine consistency, targeted archive/vector/operations/privacy suites passed
  **180 checks with one already-verified model integration skipped**; all 10 caption
  tests passed again. The added regression brings the TypeScript inventory to 526 tests.
- CI-mode browser suite: **72 passed / 6 intentional real-model skips**, across desktop,
  portrait and landscape, including **21 axe scans**. The six real-model browser cases
  then passed **6/6 locally**, establishing complete 78-case coverage.
- Retrieval: **73/73 exact-only** and **110/110 actual local hybrid** checks.
- Lint, Astro/TypeScript, source/outline/vector validation, repository content scan,
  workflow lint, frozen migration verification and both non-root builds passed.
  Production has zero eligible units; preview has 233. Output scans checked 56,108
  private transcript shingles. Production-path verification checked **7 direct pages
  and 55 local references** under `/replay-check/`.
- Live feed dry run found **15 entries, all in the 25-ID archive inventory**, with zero
  proposed actions. It did not read/write live issues without a workflow token.
  The feed's top-level channel ID omits `UC`; the parser now accepts that exact
  canonical variant while still requiring full matching IDs on every entry.
- The pinned dictionary was downloaded externally and verified: 4,234,910 bytes,
  SHA-256 `3ed0c94610d8bcf7c11bbb49c56aa49c7234d32b66824df91f554169e572da48`.
  Its revision, Git blob and Unlicense source are recorded in `scripts/caption-config.json`.
- Authorized caption smoke: existing `QCNrRkiFeKw`, scoped to 2730–5556.66s, returned
  **`fallback_required: missing_en_orig`** from the current extractor. It fetched no
  audio, did not retranscribe the protected M4 service, and removed its owned workspace
  (absence checked afterward). Accepted-caption conversion, rejection and cleanup
  paths are fixture-tested; this smoke does not claim a real accepted-caption run.
- Read-only GitHub settings observations: repository private, default branch `main`,
  Pages not enabled, main not protected, zero Actions artifacts. The prior signed M4
  commit's GitHub validation job passed. No administrator settings were changed.
- UI source files, all services, corpus and taxonomy are unchanged from the signed
  outline checkpoint. M5 carries forward the checked-in Penpot snapshot and M4's
  desktop/mobile visual comparison; fresh browser flows cover the same layout.
  Model first-load/caching and actual browser embeddings were checked locally.

## Definition of done, item by item

“Passed locally” means the specified source/build/test evidence, not human listening
or live-provider verification. The operator's chapter/outline amendments replace
the older passage/transcript presentation requirements.

| # | Condition | Status and evidence / remaining action |
| ---: | --- | --- |
| 1 | Eight core physical uploads | Passed locally: inventory/date/disposition assertions in `evaluate-core.ts`; all eight exact IDs retained. |
| 2 | August 16 is one logical service | Passed locally: three ordered video clocks, cross-upload navigation and reload/soft-stop tests. |
| 3 | Failed June seven-second stream excluded | Passed locally: retained failed source; absent from both ordinary indexes and navigation. |
| 4 | September 6 start within 30 seconds | **Pending human action:** reviewer listens to `ZTDYIJUDb0M` from its true beginning and records the comparison against stored bounds. |
| 5 | Reasonable reviewed outline | **Pending human action:** review descriptions, neutral peer groups, sermon argument and selective cues service by service; then use the human approval command. |
| 6 | Results target chapters/subsections | Passed locally: canonical links, parent context, correct ranges, old-ID resolution and reload tests. |
| 7 | Romans 13 | Passed locally: alias/range matching and source-backed reading/exposition targets; duplicate references cannot inflate coverage. |
| 8 | Government question reaches Authority top three | Passed locally with actual query embeddings and real browser worker; source-backed Authority targets retained. |
| 9 | Abraham/Isaac and living sacrifice | Passed locally: actual retrieval acceptance, BSB match reasons and ESV reference links. |
| 10 | Correct video/time | Passed locally with deterministic IFrame adapters across upload clocks. Live-provider confirmation remains a human observation, not inferred from adapters. |
| 11 | Continue beyond endpoint | Passed locally: pause, replay/continue, no repeated pause after continue and full-recording resume checks. |
| 12 | Reviewed corrections rebuild/deploy | **Pending human action:** make a correction/reset, review and approve, merge, observe required checks/deployment and verify the actual route. |
| 13 | No retained recording media in delivery | Passed for tracked/nonignored candidates, owned processing workspaces and local builds; sole Actions artifact is checked production output. No live artifacts/Pages output exist yet. User-owned unrelated storage was not blanket-audited or deleted. |
| 14 | Honest unresolved edge cases | Passed locally: unassessed/failed media excluded; uncertainties retained internally, not promoted. |
| 15 | Weekly discovery → PR → publication | **Pending human action:** after setup/merge, dry-run/apply discovery, person-invoke curation for a real new upload, review/approve/merge, verify publication, then close the issue. Fixture idempotency and live known-ID discovery are not this end-to-end proof. |
| 16 | September 13 baseline | Preview passed locally. **Production pending human action:** review/approve its service and verify it after successful deployment. |
| 17 | July candidate relationship | Passed locally: `D-FyolbxJgk` remains the distinct July 12 programme despite its title; `OrsN83j3qxE` remains July 5. |
| 18 | Short July 12 recording | Passed locally: `MZr169xBwrU` retained unassessed, not rejected because of duration. |
| 19 | Tripping metadata | Passed locally: exact video, Luke 17:1-9, Matthew 18:5-7 and Rev. Yong Teck Meng retained. |
| 20 | Stumbling question | Passed locally within the declared threshold using the regrouped evidence-backed points. |
| 21 | Metadata isolation | Passed locally: strict video/parent bounds, source-specific metadata, date checks and no cross-service inference. |
| 22 | Non-destructive candidates | Passed locally: every frozen record and transcript remains preserved against `540abab`; classification is independent of workflow and approval. |

## Human observation record

For each pending editorial/live step, record:

```text
Reviewer: pending
Date/time: pending
Commit, service/video and URL: pending
Environment (device/browser/audio/assistive technology): pending
Observed start/end, grouping or publication result: pending
Corrections and approval/deployment commit: pending
```

Repository setup is also pending: enable Pages for an eligible private-repository
plan, select Actions as source, protect main with `validate` and `editorial-guard`,
and configure the deployment environment. Do not change repository visibility merely
to bypass setup. Details: `docs/operations.md` and `docs/weekly-operation.md`.

No human editorial approval, merge, deployment or new weekly-content completion is
claimed here. Final code signing, remote checks and PR readiness are recorded in
`docs/run-log.md` when they actually occur.
