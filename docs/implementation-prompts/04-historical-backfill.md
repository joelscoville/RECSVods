# Prompt 4: Historical Backfill

Read `docs/implementation-prompts/README.md` first and follow its shared contracts. Continue from the passing Milestone 3 checkpoint on the same feature branch and draft PR, reading `docs/run-log.md` first.

This milestone remains agent-operated. During this continuous run, process only the first explicitly operator-approved bounded batch. Future batches will each be person-invoked after the implementation PR is reviewed. Do not create a service that calls an LLM, schedule unattended AI interpretation, or bypass pull-request review.

Prepare historical backfill in batches of approximately 20 logical services, using smaller batches when recordings are long or irregular.

## Backfill Manifest

Create a human-readable manifest that uses the shared record model exactly: `workflow_status` with its allowed transitions, service-level `editorial_status`, and per-video `media_disposition`. Do not introduce other status values.

If reports display `published`, compute it from the shared publication rule and a successful default-branch deployment; the curator must not write it.

Distinguish physical videos from logical services. Track discovery source, trusted metadata, batch, status, related service ID, and notes without duplicating authoritative reviewed content.

Add deterministic scripts to validate the manifest, select the next bounded batch, avoid completed/in-progress records, detect duplicate IDs and conflicting assignments, summarize batches, report status/year progress, and rebuild affected indexes while CI retains a full rebuild check.

Scripts may organize work but must not interpret media or invoke an agent.

## Batch Curator Workflow

Extend the curator skill or add a narrowly scoped companion skill. It must direct the agent to:

1. Read and verify the bounded batch.
2. Stay on the continuous-run feature branch and assign a stable batch identifier; do not create a second implementation branch or PR.
3. Run the authorization and media-tool preflight.
4. Apply the operator's 2026-09-26 historical-batch exception: one isolated subagent per logical service may run in parallel without a fixed worker cap. Stagger acquisition starts approximately 1–2 minutes apart. Each worker writes only its service YAML and review document, with its own external workspace; the weekly workflow stays sequential.
5. Reuse taxonomy. Workers put proposed new terms in review notes; only the main agent merges shared taxonomy after reviewing the batch.
6. Preserve trustworthy historical metadata and wording.
7. Workers perform source/import and own-file integrity checks. The main agent performs cross-service consistency review and repository-wide validation once after assembling the batch.
8. The main agent runs search regressions once at the end before committing.
9. Remove all temporary media.
10. Keep interpreted services at `needs_review`. Only the main agent updates `docs/run-log.md`, shared progress, commits and the existing draft PR; keep code and archive content in separate commits.

Stop a batch early when context, time, storage, or review complexity becomes unsafe. Partial work may be proposed only when included services are valid and the manifest truthfully records the remainder.

## Static Search Performance

Measure realistic archive growth. Retain exhaustive browser cosine similarity while it remains responsive. Do not add PostgreSQL, Elasticsearch, HNSW, a vector service, or a search API preemptively.

Use compressed artifacts, lazy loading, exact-first results, separated metadata/vectors, or transparent sharding only when measurements justify them. Preserve cross-archive search.

Define budgets for initial assets, model download/cache, index transfer, exact-result latency, semantic reranking on a representative mobile profile, and memory use. If budgets fail, document evidence and apply the smallest static-compatible adjustment.

## Editorial Review Reports

Report low-confidence boundaries, missing likely metadata, unusual passage lengths, section gaps/overlaps, duplicated overlap text, topic proliferation, suspicious video counts, and changes to previously reviewed records. These are review aids, not automatic rewrite rules.

## First Approved Batch

The operator's approved list is `docs/implementation-prompts/inputs/historical-batch-001.yaml`. Import it into the manifest as `discovered` entries with its trusted metadata, and process only those services. Never add, remove, or reorder entries in the input file, and do not choose other channel videos. If `services` is empty or `approved_by` is blank, complete scripts, skills, fixture tests, and dry-run documentation, mark live-batch execution `pending_operator_input` in the PR evidence, and continue to Milestone 5. `pending_operator_input` is a PR acceptance-condition label, not a `workflow_status` value. This completes only the Milestone 4 implementation-tooling checkpoint, not the live-batch acceptance condition.

The PR must list attempted and `complete` services, `registered`, `in_progress`, or `blocked` workflow items, `needs_review` editorial items, editorial uncertainty, ranking changes, index/performance measurements, and temporary-media deletion.

## Required Tests

Test manifest transitions, batch selection/resume/idempotency, duplicate/conflict detection, partial failure isolation, forbidden curator promotion, preview/production filtering, incremental/full index equivalence, core and edge-case search regressions, compression/shard reconstruction if used, stable performance budgets, editorial reports, interrupted cleanup, and media/cache exclusion.

## Completion Gate

Do not complete the implementation-tooling checkpoint until batch selection, processing, resume, and preview behavior are proven with controlled test inputs without changing the static architecture. Complete one real bounded batch when an approved corpus exists. Otherwise retain `pending_operator_input` as an explicit unpassed live acceptance condition; do not represent fixture execution as historical backfill. Follow the shared completion protocol, create and push the Milestone 4 checkpoint, update the same draft PR, then load Prompt 5 and continue.
