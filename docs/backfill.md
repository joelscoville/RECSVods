# Deterministic historical backfill toolkit

The main agent operates this toolkit. It organizes a person-approved batch; it does
not acquire media, interpret recordings, call models, approve content, or deploy.
Use the existing bounded development wrapper. The first real import is an explicit
main-agent operation after code tests; fixture tests do not count as live acceptance.

## Registry format and authority

`corpus/manifest.yaml` is an optional, human-readable YAML registry, schema version 1.
Its absence is a valid empty registry. Only that exact path is exempt from the
legacy identifier loader. Existing `corpus/<video-id>.yaml` records retain their
schema and are never rewritten by this toolkit.

The registry contains:

- `batches`: stable `batch_id`, repository-relative `discovery_source`, SHA-256 of
  the **exact input bytes**, verbatim `approved_by`, optional `approved_at`, and
  `approved_count`. Approval here bounds processing, not editorial publication.
- `services`: logical `service_id`, `batch_id`, zero-based `source_order`, date,
  canonical `sourceFileRef`, optional operator title/`known` metadata/notes, ordered
  physical `videos`, `workflow_status`, conditional `blocked_reason`, and history.
- `videos`: exact `youtube_id`, RECS `channel_id`, and contiguous one-based sequence.
  One physical upload may be assigned to only one logical service across all batches.
- `history`: append-only `{to, reason?}` transitions, starting implicitly from
  `discovered`. Status/reason must equal the replayed history. This permits several
  legal main-agent transitions in one content checkpoint without losing their edges.

For illustration only, one newly imported fictional entry looks like:

```yaml
service_id: 2026-01-04
batch_id: example-001
source_order: 0
date: 2026-01-04
sourceFileRef: services/2026/2026-01-04/service.yaml
notes: Operator-supplied scope note.
videos:
  - youtube_id: AAAAAAAAAAA
    channel_id: UCLjwcZaIkiFEed1VgQYSsrw
    sequence: 1
workflow_status: discovered
history: []
```

No transcripts, summaries, sections, passages, cached editorial approval, or cached
media judgments are accepted in the registry. Trusted operator metadata is provenance,
not a second copy of the authoritative interpretation. Unknown fields are rejected.
Reports read `editorial_status` live from the referenced service and omit it before
interpretation. Per-video `media_disposition` is `unassessed` before a source exists,
then read live from it, including later failures after processing completes. Registry
workflow describes the main agent's claim; `source_workflow_status` in reports exposes
the independent live source state rather than silently synchronizing it.

`eligible` is derived from service `reviewed` and video `playable`. It says nothing
about an actual deployment. The toolkit never labels material `published`.

## Read-only approved input

Input schema: `schema_version: 1`, `batch_id`, `approved_by`, optional ISO-date
`approved_at`, and `services`. Each service supplies a real ISO `date`, nonempty
ordered `videos: [{youtube_id}]`, and optionally `service_id`, `title`, `known`
(`speaker`, `scripture` references), and `notes`. The default ID is the supplied date.
Same-date logical services require distinct explicit IDs supplied by the operator.

`--input` accepts an absolute path inside the repository or a repository-relative
path. Its safe relative form is recorded, and that file must be included in Git for
CI validation. Paths escaping the repository and symlinks are rejected. Inputs are
never edited, normalized on disk, reordered, copied, or overwritten. Import stores
trusted metadata in input order and creates only `discovered` entries.

Reimporting identical input is a byte-preserving no-op, including after claims.
Changing even a comment changes its byte hash and stops import/validation. A batch
ID cannot be silently reused for changed input. Duplicate logical/physical IDs,
conflicting existing service assignments, mismatched dates or physical-video order,
and legacy identifier date conflicts stop before replacing the manifest. Resolve
approval/input conflicts with the operator; never patch approved inputs to force
the tool through. A new approved scope needs a distinct batch and nonconflicting IDs.

An empty `services` list or blank `approved_by` imports a zero-capacity batch with
no workflow entries. Reports label it `pending_operator_input`, an acceptance
condition **not** a workflow value. Existing blank-input provenance cannot later be
silently replaced under the same batch ID.

## Commands and TypeScript API

```sh
scripts/devenv-run pnpm exec tsx scripts/backfill.ts import --input docs/implementation-prompts/inputs/historical-batch-001.yaml
scripts/devenv-run pnpm exec tsx scripts/backfill.ts next --batch historical-001 --limit 12
scripts/devenv-run pnpm exec tsx scripts/backfill.ts transition --service 2026-08-30 --to registered
scripts/devenv-run pnpm exec tsx scripts/backfill.ts transition --service 2026-08-30 --to in_progress
```

For the current approved twelve-service input, main can register and claim every
entry in supplied order using this single bounded invocation. It performs no
acquisition; main schedules each worker's acquisition start approximately **90
seconds apart** after assigning isolated source/report paths and external workspaces.

```sh
scripts/devenv-run pnpm exec tsx --eval 'import { nextBackfill, loadBackfill, transitionBackfill } from "./site/lib/backfill.ts"; const root = process.cwd(); for (const entry of nextBackfill(loadBackfill(root), "historical-001", { limit: 12 })) { if (entry.workflow_status === "discovered") transitionBackfill(root, entry.service_id, "registered"); transitionBackfill(root, entry.service_id, "in_progress"); console.log(entry.service_id, entry.sourceFileRef); }'
```

IDs, in order: `2026-08-30`, `2026-08-23`, `2026-08-09`, `2026-08-02`, `2026-07-26`,
`2026-07-19`, `2026-06-21`, `2026-06-14`, `2026-06-07`, `2026-05-31`, `2026-05-24`,
`2026-05-17`. Each source is `services/2026/<id>/service.yaml`.

`next` is read-only and preserves supplied order. It skips `complete`, `in_progress`,
and `blocked` entries before applying its limit; skipped entries do not consume
capacity. The default is min(20, approved count), not a fixed worker cap. An explicit
positive integer limit can exceed 20 but cannot exceed the approved input count.
Zero-capacity input returns an empty default selection. Selection does not reserve
work. Main serializes claims; workers never run shared-manifest mutations.

```sh
# Explicit interrupted/blocked-item inspection; no automatic mutation or blocker clearance.
scripts/devenv-run pnpm exec tsx scripts/backfill.ts next --batch historical-001 --resume 2026-08-30
scripts/devenv-run pnpm exec tsx scripts/backfill.ts transition --service 2026-08-30 --to blocked --reason "Source acquisition failed with verified timeout; retry pending."
# Main resolves the blocker before resuming. Reason clears on this edge.
scripts/devenv-run pnpm exec tsx scripts/backfill.ts transition --service 2026-08-30 --to in_progress
# Only after the worker has produced a matching, complete interpreted source:
scripts/devenv-run pnpm exec tsx scripts/backfill.ts transition --service 2026-08-30 --to complete
```

Exact legal edges:

```text
discovered  -> registered | blocked
registered  -> in_progress | blocked
in_progress -> complete | blocked | registered
complete    -> in_progress
blocked     -> registered | in_progress
```

Same-state transitions are errors. `--reason` is required exactly for `blocked`;
it is forbidden for all other targets. Reprocessing `complete -> in_progress` is an
explicit transition, not automatic next-selection. `in_progress -> registered`
records abandonment; main must separately discard uncommitted interpretation as
appropriate, never delete previously reviewed work. The toolkit only writes the
registry and cannot reset editorial status or discard source content for main.

Each mutation validates in memory, uses an exclusive sibling `.lock`, and replaces
the manifest atomically. On ordinary failure it removes its temporary file/lock and
preserves the previous manifest and other claims. After a process kill, a stale
`.lock` may remain: main must confirm no writer is active before removing that exact
lock and retrying. There is no automatic lock stealing. Completion validates the
target source, transcripts and exact ID/date/video sequence, requiring its source
workflow `complete`; it deliberately does not parse other workers' partial output.
Global source-owner conflicts remain a mandatory batch-end validation gate.

Exported API in `site/lib/backfill.ts`:

- `importBackfill(root, inputPath)`, `loadBackfill(root)`, `validateBackfill(root)`
- `nextBackfill(manifest, batchId, {limit?, resume?})`
- `transitionBackfill(root, serviceId, to, reason?)`
- `reportBackfill(root, {batch?, year?, baseline?: Service[]})`
- Pure validators `manifestFromFiles`, `validateManifestReferences`,
  `assertManifestDiff`, plus `editorialReviewAids` and strict schemas.

## Batch-end reports and integration

Run global checks once after the historical batch is assembled, per the operator's
2026-09-26 exception. One content worker per service is allowed without a fixed cap;
workers write only assigned service YAML and review documents. Main owns shared
manifest, taxonomy reconciliation, run log, and final global checks. Weekly curation
remains sequential. Reports below parse live archive sources, so run them after
workers have finished, not against half-written YAML.

```sh
scripts/devenv-run pnpm exec tsx scripts/backfill.ts validate
scripts/devenv-run pnpm exec tsx scripts/backfill.ts report --batch historical-001 --year 2026
# Optional read-only checkout/directory containing baseline services/ and corpus/:
scripts/devenv-run pnpm exec tsx scripts/backfill.ts report --batch historical-001 --baseline /path/to/baseline
scripts/devenv-run pnpm validate:archive
```

All backfill CLI output is deterministic JSON, suitable for main's review evidence.
Reports provide workflow/editorial/year counts, objective blocked reasons, exact
source references, live per-video dispositions and eligibility. Review aids contain
IDs and reasons rather than copies of transcript text. Current heuristic thresholds:

- Section/passage confidence below 0.8; passage length below 15s or above 180s.
- Missing speaker, sermon title or scripture (potential gaps, not required facts).
- Section gaps/overlaps within a video, including coverage edges against its
  transcribed span or duration; unrepresented setup/waiting may be intentional.
- Matching passage suffix/prefix of at least eight normalized words (up to 80),
  or exact normalized transcript duplicates of at least eight words. Repeated
  liturgy is not proof of duplicated ASR overlap.
- More than three videos, more than twelve topics, or more topics than passages
  with a minimum allowance of four.
- Changed or absent previously reviewed records versus an explicitly supplied
  baseline. No baseline means no historical-change conclusion, not “unchanged.”

These are human review aids only: no automatic boundary, metadata, text, taxonomy,
or approval rewrites. Registry validation and reports do not create indexes.
`scripts/archive.ts` validates the manifest before `buildIndex` writes output, and
`validate:archive` validates it when present. This retains CI's full rebuild gate
without introducing an archive/backfill runtime import cycle. `loadArchive` alone
only skips the canonical registry; use the orchestrated command for full validation.
The editorial guard independently validates Git-tree input hashes, references and
append-only history and keeps the existing human approval-only guard intact.
No package script changes are required; call this CLI through `pnpm exec tsx`.

Index performance/incremental tooling and final repository-wide acceptance are
separate integration work; this toolkit provides the manifest gate for the existing
full rebuild. Main runs final search/build/CI checks after assembling actual content.

## Focused fixture checks

```sh
RECS_DEVENV_TIMEOUT_SECONDS=180 scripts/devenv-run pnpm exec vitest run tests/backfill.test.ts tests/editorial.test.ts tests/archive.test.ts
```

Tests use disposable fictional inputs and archives. Editorial tests isolate Git
identity/configuration only inside fixture processes, as already approved for this
repository; no real-repository commits or approval operations are performed.
