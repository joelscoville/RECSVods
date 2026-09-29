# RECS Replay

A static, chapter-searchable archive of Reformed Evangelical Church Singapore
recordings. YouTube hosts playback; reviewable chapter YAML holds the archive
interpretation. Search runs in the browser, with exact matching available while
the self-hosted semantic model loads.

## Editing and reviewing services

Start with [the human editing guide](docs/editing-services.md). `service.yaml` has
one title, quoted clock times, defined type choices, and optional per-video quirk flags.
Genuine review questions are nearby YAML comments. Checks, measurements and processing
provenance live in `docs/checks/`, not in the authoring metadata.

```sh
pnpm author types
pnpm author check 2026-06-28
pnpm author check --all
```

The schema comment in each service file enables editor completion from
`schema/service.schema.json`. The guide covers adding chapters;
`pnpm author --help` prints the complete command syntax. Existing chapter IDs stay stable.

## Corrections and recording quirks

The correction destination is explicitly configured in `site/config/corrections.json`.
It currently points to this repository's issue form, which requires repository access
while the repository is private. `PUBLIC_REPOSITORY_URL` or `PUBLIC_CORRECTIONS_URL`
can override it at build time (the latter accepts an HTTPS form or `mailto:` address).

Each video's optional `quirks` list in `service.yaml` records its active playback flags.
It does not change editorial approval or remove a recording from search. A known embedding
restriction shows a timestamped YouTube link immediately, with an optional embedded
retry. Human audio flags show recording notes; automatic sample findings stay in the
diagnostic report until someone listens and chooses to add a flag.

```sh
pnpm quirks report
pnpm quirks flag --video VIDEO_ID --kind audio_choppy --note "Dropouts during speech"
pnpm quirks flag --video VIDEO_ID --kind audio_left_only
pnpm quirks clear --video VIDEO_ID --kind audio_choppy
pnpm quirks check-embeds --all             # write reports only; needs Playwright Chromium
pnpm quirks check-embeds --all --apply     # add confirmed restrictions only
pnpm validate:quirks
```

`clear` explicitly removes a flag. `--note` adds a human YAML comment. There are no
separate manual/automatic flag lists or required timestamps. Checks write dated reports
to `docs/checks/<service-id>.md`. A timeout, player error 153, silent sample, missing tool
or network failure is **inconclusive** and never changes flags. Successful checks
suggest reviewing existing restrictions for removal, but never silently erase them.
An absent flag does not certify a healthy recording. Results reflect the checker's
browser/network/location, not every region.

Optional audio sampling works with a full-length local source or short YouTube downloads:

```sh
scripts/devenv-run pnpm quirks check-audio --video VIDEO_ID --file /path/to/source.mkv
scripts/devenv-run pnpm quirks check-audio --video VIDEO_ID --youtube
# Results go to docs/checks/; audio guesses never automatically become flags.
```

It checks three 6-second candidates around the middle of the sermon (or recording),
selects audible speech-band content, then analyses up to 30 seconds. This is not speech
recognition: music/noise can also be audible. Later checks can revisit the previous report's sample.
It detects channel imbalance, possible brief dropouts and clipping; listening remains
necessary to confirm choppy/distorted sound. A clean sample elsewhere cannot clear
an earlier fault. Silence produces an inconclusive result. Audio is temporary and
removed after checking; no audio or signed media URLs are stored in Git or reports.
The `--youtube` option explicitly enables these bounded downloads; ffmpeg, ffprobe and
yt-dlp are supplied by devenv. Audio checks never run during a site build.

The separate **Recheck video embedding** workflow runs weekly or on manual dispatch.
Embedding checks briefly stream muted playback to verify it advances; no media files are saved.
It uploads diagnostic reports; it does not edit/commit service metadata,
download audio samples, approve content or deploy the site. To update the website,
apply verified flags locally, commit the service changes when ready, and rebuild. Ordinary
PR tests use deterministic fixtures; live YouTube availability is not a merge gate.

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

- [Current authoring format and human review](docs/editing-services.md)
- [Historical archive-format reference](docs/archive-format.md)
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
