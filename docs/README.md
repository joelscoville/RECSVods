# Maintainer documentation

Everything needed to run, test, operate and extend RECS Replay. Start with the root [README](../README.md) for an overview.

## Development

Install Nix and devenv, then run commands through the bounded environment wrapper:

```sh
scripts/devenv-run pnpm install --frozen-lockfile
scripts/devenv-run pnpm dev
scripts/devenv-run pnpm test
scripts/devenv-run pnpm typecheck
scripts/devenv-run pnpm lint
```

The default environment timeout is 900 seconds; see [development setup](development.md).
The pinned environment supports Intel macOS. Native media preflight, calibration,
and model provenance are recorded in [preflight evidence](history/preflight-evidence.md).

### Testing

Use `pnpm test:search` for focused search feedback, `pnpm test:watch` while editing,
and `pnpm test` for parallel unit/Python checks. `pnpm check` runs the full validation
groups, reports failures independently, and prints focused rerun commands. Browser
checks default to two workers; responsive/accessibility checks retain three viewports.
See [testing workflow, worker limits and regression contracts](testing.md).

### Developer tools (`/dev`)

Every build has an unlisted, `noindex` page at `<base>dev/`. It is hidden, not private.
- **Switches** force the search model's data and device modes in this browser. They can also add an **Unapproved** category to the home page, loaded live from GitHub (`github-archive.ts`). Those recordings open in a dev-only player at `<base>dev/watch/`: the normal watch page, fed from GitHub. On the home page the loader downloads only while the switch is on.
- **This browser** shows what the browser reports and what was measured. It can delete the downloaded model.
- **Waiting for approval** loads every recording file live from the public GitHub repository, flags format problems, and opens a draft in the editor. It works on production because nothing is built into the page; production output still contains only published recordings.
- **Saved in this browser** lists and removes the site's local storage.
- **This build** shows the build mode, base path and repository.

To add a section, write a component in `site/components/DevTools.tsx` and add it to `SECTIONS`.

## Build and review

```sh
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm build:preview
SITE_BASE_PATH=/replay/ scripts/devenv-run pnpm preview
```

`SITE_BASE_PATH` is the sole path-prefix setting; use `/` at a domain root.
Production is written to `dist/production`; only recordings with `status: published` are
included. An empty production archive is intentional until a person publishes one. `dist/preview`
includes clearly labelled drafts and is **local review output, never a deployment artifact**.


## Guides and references

- [The recording format](editing-services.md): the one file per service, and the rules
- [Drafting a recording](curation.md): how a new recording is drafted and checked
- [Corrections](corrections.md) and [recording quirks](quirks.md)
- [Static search, model provenance, and budgets](search.md), [search artifacts](chapter-search-artifacts.md) and [search evaluation](search-evaluation.md)
- [Browse categories](browse.md) and [the BSB text](bible.md)
- [Authorized media tooling and cleanup](media-tooling.md)
- [Weekly discovery](weekly-operation.md)
- [Repository settings, production deployment and recovery](operations.md)
- [Penpot design references](design-reference/penpot/README.md)
- [History](history/): reviews, acceptance records and the earlier `service.yaml` format, kept as a record

The coding agent never approves its own interpretation. There are no accounts,
server-side search services, or automatic AI publishing jobs. ESV references link
to esv.org; ESV verse text is not bundled or cached.
