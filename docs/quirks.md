# Corrections and recording quirks

How upload playback and audio quirks are recorded and checked. For the recording
editor and its GitHub destination, see [corrections](corrections.md).

Each upload's optional `uploadQuirks` list in `services/<id>.yaml` records known playback problems,
shown as recording notes. It does not change approval or remove a recording from search.
Embedding needs no flag: the player always tries the embedded video, and only if YouTube
refuses or fails does it show "Watch on YouTube" with a timestamped link. Automatic audio
findings stay in the diagnostic report until someone listens and chooses to add a flag.

```sh
pnpm quirks report
pnpm validate:archive
```

Add or remove flags by editing `uploadQuirks` on the matching upload, after listening.
For example, `uploadQuirks: [audio_choppy, audio_left_only]`; use a YAML comment for
additional context. There are no separate manual/automatic flag lists or required
timestamps. Audio checks write dated reports to `docs/checks/<recording-id>.md`.
An absent flag does not certify a healthy recording.

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
