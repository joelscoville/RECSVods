# Archive corrections

Every passage card (including static browse and interactive search), service page,
selected playback passage, surrounding transcript segment and expanded playback
passage list offers **Suggest a correction**. Links open GitHub's new-issue page in
the same tab. They do not submit an issue automatically. The form offers
`transcript`, `timestamp`, `scripture`, `speaker`, `section` and `other` choices.

**Edit this transcript** opens the source file's GitHub editor when the build can
identify a tracked source. GitHub handles authentication, forks and proposed
changes; RECS Replay has no custom transcript editor or GitHub API client.

## Build configuration

Set these in the build process environment (for example shell exports or CI `env`):

| Variable | Meaning and fallback |
| --- | --- |
| `PUBLIC_REPOSITORY_URL` | HTTPS `https://github.com/<owner>/<repository>`. Defaults to `GITHUB_REPOSITORY`, then the local `origin` remote. No repository name is hardcoded. |
| `PUBLIC_SOURCE_REF` | Source branch, tag or commit. Defaults to `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, the current local branch, `GITHUB_SHA`, then local `HEAD`'s commit ID. Local feature branches are preserved. |
| `SITE_BASE_PATH` | Existing deployment prefix, such as `/review/` or `/nested/review/`; still the sole base-path setting. |

Example (substitute the repository's actual URL and pushed source ref):

```sh
PUBLIC_REPOSITORY_URL=https://github.com/your-org/your-archive \
PUBLIC_SOURCE_REF=feat/editorial-workflow \
SITE_BASE_PATH=/review/ scripts/devenv-run pnpm build:preview
```

Explicit invalid repository/ref settings fail with a sanitized configuration
error. Repository URLs reject credentials, alternate hosts, ports, queries,
fragments and extra path segments. A local SSH GitHub remote is converted to its
HTTPS repository URL; credential-bearing HTTPS remotes are rejected. Repository
renames require only updated environment configuration or a renamed local remote.
When no safe repository is available, the UI states that correction links are
unavailable in this build. Without a source ref, issue links still work but edit
links are absent.

`astro.config.mjs` imports `site/lib/source-links.ts` **only at build time**. Its
Git reads use `execFileSync` argument arrays, no shell, a 5-second timeout per
invocation, bounded output and suppressed stderr. It computes the JSON constant
`__RECS_CORRECTIONS__`, shared by server rendering and React islands.
This is generated configuration, not an operator environment input.
The constant is a structured Vite `define` value, not a string-valued
`import.meta.env` entry. Unit tests use `vi.stubGlobal` with a JSON-round-tripped
object to exercise the same default-config path without mocking link generation.
Restart the dev server/rebuild after source, tracking, branch, publication or configuration
changes. No `child_process` or filesystem implementation belongs in client code.

## Stable context and privacy

The build applies `publishedServices` before creating its allowlist. Production
contains only reviewed services and playable videos; local preview additionally
contains `needs_review` services with playable videos. Unresolved, failed and
rejected uploads never enter the correction map.

The map contains only service, physical video, passage and section IDs, archive
timestamp bounds, video durations and safe repository-relative source paths.
Correction URLs prefill issue-form fields named `service-id`, `video-id`,
`passage-id`, `section-id`, `timestamps` and `page`, plus `template` and an ID-only
`title`. `problem` can optionally preselect one of the six supported choices.
The standard GitHub `body` parameter also carries a Markdown draft with those
same public fields, all six named problem checkboxes (and the selected choice,
if supplied), and a suggested-correction prompt. GitHub only installs issue forms
from the default branch; this fallback keeps suggestions usable before the new
form is merged. The existing form-specific parameters are retained. `body` is a
reserved GitHub parameter, not an issue-form field. It is generated solely from
the allowlisted fields, never caller-supplied body text or browser state.

- Passage pages use canonical `/watch/?id=<passage-id>` paths under the deployment
  base and exact source start/end seconds (including fractions).
- Whole-service reports list each eligible upload and its full recording bounds.
  They use `/services/<service-id>/` and explicitly say no passage or section was
  selected; no ID is invented.
- Full-video playback reports use a canonical service/video target and archive
  bounds. An exact known chapter-start selection includes that section's ID and
  bounds. The existing watch route uses whole-second seek links; the issue's
  timestamp field retains exact fractional source bounds.
- No correction helper accepts a current-page URL, search query, history, saved
  playback position, free-form archive note or provenance hash. Extra properties
  on caller objects are ignored. A private seek/resume time is never serialized.
- Both external actions set `rel="noreferrer"` and
  `referrerPolicy="no-referrer"`, preventing the referring search/playback URL
  from accompanying the request.
- Source parsing and local filesystem paths stay build-side. Transcripts,
  summaries, reviewer notes, disposition evidence and provenance are not copied
  into the correction map or issue URL.

## Source files

The normalized archive loader resolves Markdown text and drops `transcript_file`.
The build helper therefore re-parses the original YAML through
`ServiceSourceSchema` to recover the pointer:

- Inline transcript: `services/YYYY/<service-id>/service.yaml`.
- Markdown transcript: that passage's actual `transcript_file`, resolved inside
  the same service directory. There is no guessed Markdown filename or fallback
  to YAML when a Markdown source is untracked.

Both the service YAML and candidate transcript must appear in `git ls-files`.
Filesystem reads reject symlinks, traversal, absolute paths and paths outside the
service directory. Untracked M3 files still get issue links; their edit actions
can appear after tracking and rebuilding. Existing tracked M2 inline sources
resolve to their YAML files on the current branch.

Tracking is a local availability gate, **not a network verification that a ref or
file has been pushed**. Publish the source branch before sharing its build, or
explicitly configure a pushed ref containing the source files. No GitHub network
request runs during generation/tests. A service-wide edit action appears only
when all eligible passages share one known source; otherwise use each passage's
edit action. Services without transcript passages offer suggestions only.

Refs are encoded as one URL component (including branch slashes), and source path
segments are encoded independently. Links use durable GitHub `/edit/<ref>/<file>`
URLs without line anchors; `sourceFileUrl` also supports `/blob/`.

## Integration API

- `correctionLinks(target, base, config?, kind?)` in `site/lib/corrections.ts`:
  returns `{ issueUrl?, editUrl? }`; target is `{ passageId }` or
  `{ serviceId, videoId?, sectionId? }`. Unknown/mismatched targets or invalid
  bounds produce no links. Default config comes from the generated build constant.
- `<CorrectionLinks target={...} base={...} config={optionalConfig} />`: native
  anchors using existing `text-link` styles. Place inside an existing `action-row`.
- `loadCorrectionConfig(root?, env?)` in build-only `site/lib/source-links.ts`:
  resolves configuration, tracks source files and constructs the allowlist.
  `buildCorrectionConfig` and `resolveRepositoryConfig` have injectable read/Git
  boundaries for offline tests.

Shared configuration covers existing `PassageResult` callers without new source
props or edits to search/browse pages. No changes to the search-index schema,
archive loader or editorial approval implementation are required.

## Human review

The issue form has no required repository-label dependency. The PR template
separates **Code review** from **Editorial review**, with evidence and uncertainty
kept explicit. Human review uses `pnpm build:preview`; preview artifacts must not
be deployed. Interpretation changes to reviewed content reset the entire logical
service to `needs_review` and clear its approval fields.

Only a human, after reviewing all videos/sections/passages/transcripts of that
service, runs:

```sh
scripts/devenv-run pnpm editorial:approve -- <service-id> --reviewer <name>
```

Agents must never run approval, write `reviewed`, or create an
`Editorial-Approval` trailer. The approval-only commit and editorial guard remain
separate from code review. An issue, proposed edit or merged code change grants no
editorial approval.

## Verification handoff

Fresh verification on **2026-09-26 local / 2026-09-25 UTC** supersedes the initial
437-passage artifact result. Commands ran sequentially through the bounded
environment wrapper, after media processing had stopped:

- **46 correction tests passed**, including the opt-in real-artifact check.
  Default runs contain 45 passing tests and deliberately skip the artifact check.
- Fresh preview: **87 pages / 688 eligible passages**. Production: **7 pages /
  zero passages**. Both use `/replay-check/` and pass output/privacy validation.
- Artifact acceptance: **688 passage suggestions, 346 tracked-source edits,
  342 untracked-source suggestions without edits, nine service suggestions,
  795 topic-browse passage cards**. Expected counts and source pointers are
  derived from publication filtering, original YAML and actual Git tracking.
- Every artifact passage suggestion has exact IDs/bounds/canonical paths in
  both form fields and the Markdown fallback body, plus all six named choices.
  The client correction chunk contains all eligible passage IDs, no unresolved
  build-global identifier and no filesystem/child-process imports.
- Browser checks cover service, selected passage, full-video, exact chapter,
  transcript context, search and topic-browse links at all three configured
  viewports. Private query/history/resume sentinels do not enter the issue draft.
  An intercepted native Enter navigation has no Referer header; GitHub receives
  no request. No issue is created and no account action is performed.
- Project lint/typecheck pass; typecheck retains one existing ESLint
  `ts.config` deprecation hint, with zero errors/warnings.

Run the built-artifact test immediately after a fresh non-root preview build;
normal runs skip it so stale build artifacts cannot affect unit-test results:

```sh
RECS_TEST_PREVIEW_CORRECTIONS=1 scripts/devenv-run pnpm exec vitest run tests/corrections.test.ts
```

The acceptance check independently reads original source pointers and Git
tracking, so absent edit links on tracked files fail rather than being excused
by the generated map. Rebuild after tracking changes. Browser expectations also
derive edit availability from Git; the new M3 source has no edit link in this
untracked checkpoint and will acquire one after tracking and rebuilding.

Frontend QA is recorded in [milestone3-ui-checks.md](milestone3-ui-checks.md):
69 full-suite browser executions passed, including 42 M3 executions, plus scoped
follow-ups for persisted accessibility evidence and tracking-aware expectations.
The broader milestone validation/evaluation/editorial-guard/CI checkpoint stays
with the integration owner. Useful reproduction commands:

```sh
scripts/devenv-run pnpm exec vitest run tests/corrections.test.ts tests/browse.test.ts tests/player.test.ts
scripts/devenv-run pnpm lint
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm validate:archive
scripts/devenv-run pnpm test
SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay-check/ scripts/devenv-run pnpm build:preview
scripts/devenv-run pnpm test:e2e
```

UI implementation reuses the incumbent `action-row`, `text-link`, `sr-only` and
`transcript-note` styles, with native navigation rather than simulated buttons or
unnecessary live feedback. The checked-in Penpot snapshot was captured
2026-09-23; its desktop, portrait and landscape playback references were inspected
for the narrow fixes. Fresh screenshots and visual-fidelity comparison are
reserved for the integration owner's batched capture; this report makes no
screen-reader, physical-keyboard or formal conformance claim.
