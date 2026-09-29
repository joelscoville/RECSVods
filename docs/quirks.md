# Corrections and recording quirks

Moved from the root README. How correction links are configured, and how per-video playback and audio quirks are recorded and checked.

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

Archive embedding checks use batches of at most 50 uploads with a **shared 600-second
probing budget**, rather than a 50-upload archive limit. Each upload gets at most 20 seconds
across navigation and playback. Use `--budget-seconds N` (1–900) to adjust the total;
browser cleanup may take additional time. A partial run exits with code 2 and reports
`skippedVideoIds` and `nextStartAt` in its JSON output. Unchecked uploads retain their
flags and previous reports. Resume with `pnpm quirks check-embeds --all --start-at VIDEO_ID`;
the order wraps around so a sufficiently quick run still visits every upload. The weekly
workflow explicitly uses 600 seconds and uploads partial results even when the budget is
exhausted. For a growing archive, use its reported `nextStartAt` to check the remaining uploads.

