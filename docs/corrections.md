# Archive corrections

Each public chapter result/row and each service page offers one **Suggest a
correction** action. Selected playback offers the selected chapter's action, or a
service/video action for full-recording playback. Native links open the configured
public contact destination or GitHub issue draft; they do not submit anything.

The six choices are **chapter time**, **title**, **scripture**, **speaker**,
**topic**, and **other**. There are no transcript-edit links or source editor actions.

## Build configuration

| Variable | Meaning and fallback |
| --- | --- |
| `PUBLIC_CORRECTIONS_URL` | Explicit public HTTPS contact/form URL or `mailto:` address; takes precedence |
| `PUBLIC_REPOSITORY_URL` | Explicit public GitHub correction repository, which may be separate from the private source repository |
| `PUBLIC_SOURCE_REF` | Branch/tag/commit; falls back to CI source branch/ref, local branch, CI SHA, then local HEAD commit |
| `SITE_BASE_PATH` | Existing deployment prefix, including nested previews |

Repository names and refs are resolved at build time, never hardcoded in browser
code. A rename requires an updated environment and a rebuild. Invalid
explicit URLs/refs fail with sanitized messages. Repository validation rejects
credentials, alternate hosts, ports, queries and URL normalization tricks.

`astro.config.mjs` imports build-only `site/lib/source-links.ts` and defines
`__RECS_CORRECTIONS__` as a structured object for server rendering and React
islands. Git is used only for optional ref information, not to infer a public
correction destination. Configure the same-named Actions repository variables for
the Pages build, and verify access while signed out. A private source repository
does not provide a public issue form. Without a destination the UI displays its
unavailable message; a missing ref does not prevent suggestions. Generic contact
URLs are opened unchanged, without attaching browsing state or prefilling context.

## Public context and privacy

`buildCorrectionConfig` applies `publishedServices` first. The public map contains:

```ts
interface CorrectionConfig {
  repositoryUrl?: string;
  correctionUrl?: string;
  sourceRef?: string;
  services: Record<string, { videos: {id: string; duration: number}[] }>;
  chapters: Record<string, {serviceId: string; videoId: string; start: number; end: number}>;
}
```

Only stable public IDs and source bounds are included. Chapter IDs retain the
original IDs; they are not replaced with old segment IDs. No source paths, summaries,
review notes, private provenance, saved playback or search history enter this map.

Draft fields are `service-id`, `video-id`, `chapter-id`, `timestamps` and `page`,
plus the template and ID-only title. An optional supported `problem` preselects a
choice. Chapter pages use `/watch/?chapter=<id>` under the deployment base; exact
fractional bounds remain in `timestamps`. Service reports use the service page,
all eligible uploads and their complete bounds. Service/video reports omit private
seek time. Unknown IDs or invalid/out-of-video bounds produce no link.

GitHub installs issue forms only from the default branch. The standard `body`
parameter therefore retains a Markdown fallback with the same public fields and
six checkboxes. It is generated from the allowlist, never caller-supplied body or
current browser location. `body` is not an issue-form field.

Links set `rel="noreferrer"` and `referrerPolicy="no-referrer"`, suppressing the
referring search/playback URL. Extra caller properties such as query, history,
resume time, private path or free text are ignored.

## Integration API

- `correctionLinks(target, base, config?, kind?)` returns `{issueUrl?}`.
  Targets are `{chapterId}` or `{serviceId, videoId?}`.
- `<CorrectionLinks target={...} base={...} config={optionalConfig} />` uses the
  existing native link, unavailable-note and screen-reader styles.
- `buildCorrectionConfig(services, mode, repository)` creates the public map.
- `loadCorrectionConfig(root?, env?)` resolves build configuration and loads eligible
  services. `resolveRepositoryConfig(env, gitReader)` remains injectable for tests.

Removed APIs: `sourceFileUrl`, `validSourcePath`, `editUrl`, passage/section correction
targets, and the tracked/read-source arguments to `buildCorrectionConfig`.

## Review and verification

Suggestions require human review of chapter metadata and recording boundaries in
`pnpm build:preview`. An issue or merged code change does not approve content.
Editorial approval remains the separate human-only workflow.

The chapter test suite checks canonical IDs, multipart bounds, repository renames,
publication filtering, fallback form fields and privacy. The opt-in artifact test
checks one suggestion per chapter plus one per service in a **fresh non-root
preview**, and rejects Node imports in browser chunks. It no longer inspects Git
tracking or transcript editor URLs.

Current acceptance is recorded in the run log. To repeat the focused checks:

```sh
scripts/devenv-run pnpm exec vitest run tests/corrections.test.ts tests/browse.test.ts tests/player.test.ts tests/publication-ui.test.ts
# After a fresh non-root preview:
RECS_TEST_PREVIEW_CORRECTIONS=1 scripts/devenv-run pnpm exec vitest run tests/corrections.test.ts
```

The integration owner must also adapt browser expectations to chapter rows and
canonical URLs, verify native keyboard navigation/no-referrer behavior, and compare
desktop/portrait/landscape screenshots against the unchanged design baseline.
