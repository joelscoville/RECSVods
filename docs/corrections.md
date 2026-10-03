# Recording corrections

**Suggest a change** opens the recording editor at `edit/<recording-id>/`, optionally
at the current recording time. It is a native link. The editor lets a person check
chapter boundaries, key points, special parts, scripture, topics and the description
while playing the uploads on one recording clock.

See [Contributing](../CONTRIBUTING.md) for the walkthrough and
[the recording format](editing-services.md) for field rules.

## Sending a change

When a person chooses **Review & send**, the editor fetches the current recording file
from GitHub, applies the edits and validates the result. It guides the person through
copying the YAML into GitHub's file editor and proposing a pull request. There is no
automatic repository write or merge. Sending a reviewed change sets
`status: published`; a maintainer reviews and merges the PR before deployment.

Transcripts opened in the editor stay in the browser and are not sent. Local
markers are private unless **Send with my changes** is selected. Once saved in the
recording file, those notes are visible to anyone using the editor. They do not
appear on watch pages or in search.

## Build configuration

| Variable | Meaning and fallback |
| --- | --- |
| `PUBLIC_REPOSITORY_URL` | Public GitHub source repository; defaults to `site/config/corrections.json` |
| `PUBLIC_SOURCE_REF` | Branch/tag/commit; falls back to CI source branch/ref, local branch, CI SHA, then local HEAD |
| `PUBLIC_CORRECTIONS_URL` | Optional HTTPS contact/form URL or `mailto:` address in the correction configuration |
| `SITE_BASE_PATH` | Deployment prefix, including nested previews |

`astro.config.mjs` imports build-only `site/lib/source-links.ts` and supplies
`__RECS_CORRECTIONS__` to server rendering and browser islands. Its
`CorrectionConfig` contains only optional `repositoryUrl`, `correctionUrl` and
`sourceRef` strings. It does not serialize a service/chapter lookup map.

Invalid explicit URLs or refs fail with sanitized messages. Repository validation
rejects credentials, alternate hosts, ports, queries and normalization tricks.
Git supplies optional ref information, never an inferred public destination.
Configure the corresponding Actions variables for deployment and verify public
repository access while signed out. **Suggest a change** always opens the local
editor; a contact override does not replace that link.

## Verification

```sh
scripts/devenv-run pnpm exec vitest run tests/corrections.test.ts tests/recording-editor.test.ts tests/publication-ui.test.ts
# Fresh non-root production and preview output, then built-artifact acceptance:
scripts/devenv-run pnpm build:test
scripts/devenv-run pnpm test:built
```

The built-artifact suite checks one suggestion link per recording page, the correct
base-aware editor URL, and exclusion of build-only Node code from browser chunks.
Browser editor tests cover navigation and the editing workflow; run them as part of
`pnpm check browser`.
