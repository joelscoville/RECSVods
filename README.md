# RECS Replay

A static, chapter-searchable archive of Reformed Evangelical Church Singapore
recordings. YouTube hosts playback; reviewable chapter YAML holds the archive
interpretation. Search runs in the browser, with exact matching available while
the self-hosted semantic model loads.

## Development

Install Nix and devenv, then run commands through the bounded environment wrapper:

```sh
scripts/devenv-run pnpm install --frozen-lockfile
scripts/devenv-run pnpm dev
scripts/devenv-run pnpm test
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm lint
```

The default environment timeout is 900 seconds; see [development setup](docs/development.md).
The pinned environment supports Intel macOS. Native media preflight, calibration,
and model provenance are recorded in [preflight evidence](docs/preflight-evidence.md).

### Testing

Use `pnpm test:search` for focused search feedback, `pnpm test:watch` while editing,
and `pnpm test` for parallel unit/Python checks. `pnpm check` runs the full validation
groups, reports failures independently, and prints focused rerun commands. Browser
checks default to two workers; responsive/accessibility checks retain three viewports.
See [testing workflow, worker limits and regression contracts](docs/testing.md).

## Build and review

```sh
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build:preview
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm preview
```

`SITE_BASE_PATH` is the sole path-prefix setting; use `/` at a domain root.
Production is written to `dist/production`; only human-reviewed services with
playable videos are included. An empty production archive is intentional until
human approval. `dist/preview` includes clearly labelled unreviewed material and
is **local review output, never a deployment artifact**.

The local MVP and weekly-operation tooling cover Milestones 1–5. Final signed
delivery, human code/editorial review and repository/Pages setup are tracked in the
[run log](docs/run-log.md) and [acceptance evidence](docs/milestone5-checks.md).
Passing local checks is not a claim of human approval or live deployment.

## Archive operation

- [Archive schemas and human editorial approval](docs/archive-format.md)
- [Authorized media tooling and cleanup](docs/media-tooling.md)
- [Static search, model provenance, and budgets](docs/search.md)
- [Chapter migration and unchanged internal preservation](docs/chapter-migration.md)
- [Private transcript-window processing and committed vectors](docs/chapter-vectors.md)
- [Weekly discovery and person-invoked curation](docs/weekly-operation.md)
- [Repository settings, production deployment and recovery](docs/operations.md)
- [Final local acceptance and pending human actions](docs/milestone5-checks.md)
- [Penpot design references](docs/design-reference/penpot/README.md)
- [Ordered implementation prompts](docs/implementation-prompts/README.md)

The coding agent never approves its own interpretation. There are no accounts,
server-side search services, or automatic AI publishing jobs. ESV references link
to esv.org; ESV verse text is not bundled or cached.
