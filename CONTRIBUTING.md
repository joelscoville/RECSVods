# Contributing to RECS Replay

Thank you for helping. The most useful contributions are corrections to chapters: a wrong
start time, a better title, a missing Bible reference or speaker. Code improvements are
welcome too.

## Reporting a problem

Use the **Suggest a correction** link on the site, or
[open an issue](../../issues/new/choose). Please include the service date and, if you can,
the time in the video where the problem is.

## Changing chapters yourself

Each service lives in `services/<year>/<service-id>/service.yaml`. It holds the title, date,
speakers and the list of chapters with their clock times. The
[editing guide](docs/editing-services.md) explains every field, and your editor can
autocomplete the file from its schema.

After editing, check the file and preview the site locally:

```sh
scripts/devenv-run pnpm author check <service-id>
scripts/devenv-run pnpm build:preview && scripts/devenv-run pnpm preview
```

Then open a pull request. Keep one service (or one kind of fix) per pull request so it is easy
to review.

## How review works

- Every change is reviewed before it is merged.
- A service only appears on the public site after a person has reviewed and **approved** it.
  Approval is a separate, deliberate step recorded with `pnpm editorial:approve`; see the
  [editing guide](docs/editing-services.md). Changing an approved service's chapters sends it
  back for review.
- Automated tools and AI assistants may draft chapters, but they never approve their own work.

## Code changes

See [`docs/`](docs/README.md) for development setup, tests and architecture. Before opening a
pull request, run:

```sh
scripts/devenv-run pnpm check
```

## Licensing of contributions

By contributing, you agree that your contributions are licensed under the project's
licences: [MIT](LICENSE) for code and [CC BY-SA 4.0](LICENSE-CONTENT.md) for archive content.
Only contribute material you have the right to share. Do not paste transcripts, song lyrics
or other people's copyrighted text into chapter summaries.
