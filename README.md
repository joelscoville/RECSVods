# RECS Replay

Find and replay the part of a Reformed Evangelical Church Singapore (RECS) service you are
looking for. Each recording has named chapters and subchapters, with timestamped notes supporting
search. Recordings are
searchable by topic, Bible passage, date and what was said, and browsable by Bible book, topic,
series and year. Selecting a chapter or subchapter plays it from the church's YouTube channel,
starting at the right moment, even when a livestream was split across several uploads.

> **Independent project.** RECS Replay is a volunteer project. It is not run, reviewed or
> endorsed by Reformed Evangelical Church Singapore or any of its branches. Videos are played
> from the church's public YouTube channel; RECS Replay does not host them.

## How it works

- **YouTube hosts and plays every video.** The website shows the outline of each service:
  chapters, subchapters, special items such as Communion or a Q&A, Bible references, topics and
  a short description of the sermon. Each service is one small YAML file in `services/`. The
  repository also keeps transcripts of the first recordings (`transcripts/`), which the site
  never uses, and the public-domain Berean Standard Bible text used for search.
- **A person reviews every service before it appears on the site.** Chapters can be drafted
  with help from tools, but nothing is published without human approval.
- **Search runs entirely in your browser.** There are no accounts and no server. Exact and
  Bible-reference matches appear immediately; "similar in meaning" results are added once a
  small search model has loaded.
- **ESV passages are linked to [esv.org](https://www.esv.org), not reproduced.**
  Public-domain Berean Standard Bible text supports verse-text search and is not displayed
  as ESV.

## Found a mistake?

Every recording has a **Suggest a change** button. It opens an editor where you can fix a time,
title, Bible reference or topic while listening, and send the change. You can also
[open an issue](../../issues/new/choose) directly.

## Contributing

Corrections and code improvements are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how
recording files are organised and how changes are reviewed.

## Running it locally

The project uses [Nix](https://nixos.org) and [devenv](https://devenv.sh) to provide the same
tools on every machine. With both installed:

```sh
scripts/devenv-run pnpm install --frozen-lockfile
scripts/devenv-run pnpm dev          # local development server
scripts/devenv-run pnpm test         # unit tests
scripts/devenv-run pnpm build        # production build in dist/production
```

`pnpm build:preview` also includes drafts, clearly labelled. It is for checking your work
locally and is never published.

More detail for maintainers (testing, archive format, weekly operation, deployment) is in
[`docs/`](docs/README.md).

## Licence

- **Code:** [MIT](LICENSE).
- **Archive content** (titles, times, descriptions, key points, topics and related metadata
  written for this project): [CC BY-SA 4.0](LICENSE-CONTENT.md), credited to
  "RECS Replay contributors".
- **Not covered:** the recordings and sermons themselves, which belong to their speakers and
  the church, and third-party material such as ESV references and Berean Standard Bible text,
  which have their own terms. See [LICENSE-CONTENT.md](LICENSE-CONTENT.md).
