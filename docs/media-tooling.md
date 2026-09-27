# Local media tooling

`scripts/media.py` provides the Python-standard-library backend for RECS Replay's
media commands. Run native media operations **inside devenv**, through
`scripts/devenv-run`. Package-script wrappers can invoke
`python3 scripts/media.py <command>` and forward their arguments unchanged.

This tool produces local evidence, not archive interpretations or editorial
approval. Live preflight, the model hash, and calibration measurements are recorded
in [preflight-evidence.md](preflight-evidence.md); offline tests are separate evidence.

Local whisper.cpp remains primary. For an explicitly operator-approved large batch,
the manual [Colab transcript importer](transcript-import.md) verifies supplied JSON,
source duration and audio hashes, records per-recording provenance, and cleans the
matching batch audio after import. It does not run Colab or replace weekly local
transcription. Do not locally retranscribe the eight supplied M2/M3 recordings.

## Command interface

Options follow the subcommand. All commands accept an explicit
`--authorization-file <path>`. Authorization is required for `preflight`,
`acquire`, `sample`, and `transcribe`; `model` and `cleanup` do not require it.
Package scripts accept the documented `pnpm media:acquire -- --youtube-id ...`
separator form as well as options passed directly.

| Command | Required arguments | Other arguments / behavior |
| --- | --- | --- |
| `model` | None | `--cache-dir`; fetch authoritative metadata, download and verify the fixed model |
| `preflight` | `--work-dir` | `--cache-dir`, `--min-free-gib`, `--whisper-binary`; verify tools/model/space, acquire and transcribe the first 60 seconds of the fixed smoke recording, then delete the smoke workspace |
| `acquire` | `--work-dir`, `--youtube-id` | `--sections '*0-60'`, `--min-free-gib`, `--whisper-binary` |
| `sample` | `--work-dir` | Optional `--youtube-id` must match the manifest; 30-second windows every 300 seconds, with one frame at each window start |
| `transcribe` | `--work-dir`, `--start`, `--end` | `--cache-dir`, `--language en`, `--whisper-binary`; optional `--youtube-id` must match the manifest |
| `cleanup` | `--work-dir` | Remove only a validated, sentinel-owned work directory |

`--timeout <seconds>` is available on every command (default **900**). It is a
positive finite bound **per native invocation**, and a whole-operation bound for
the model command. It is not the total bound for a multi-chunk transcription.
The outer `RECS_DEVENV_TIMEOUT_SECONDS` bound must cover environment startup and
the complete requested operation. After calibration, use approximately three
times the expected processing time, with a minimum of 900 seconds, following the
shared media contract. Keep both bounds finite.

YouTube IDs must be exactly 11 ASCII letters, digits, underscores, or hyphens.
`--sections` accepts one numeric start/end range in seconds, optionally prefixed
with `*`; it does not accept playlists, arbitrary yt-dlp selectors, or multiple
ranges. `--start` and `--end` accept seconds or `HH:MM:SS.mmm`, and always refer to
the **original recording**, including when acquisition starts at a nonzero offset.

Success prints JSON and exits 0. Safe operational failures exit 2; handled signals
exit `128 + signal` (130 for SIGINT, 143 for SIGTERM). A native timeout is reported
as a safe media failure, exit 2; the outer bounded environment wrapper retains its
own timeout exit code 124. Raw subprocess output is captured privately and is
never replayed to the console.

## Authorization and channel scope

Pass the current operator-confirmed, gitignored record explicitly:

```sh
scripts/devenv-run python3 scripts/media.py acquire \
  --authorization-file .local/media-authorization.json \
  --youtube-id MZr169xBwrU --sections '*0-60' --work-dir "$WORK"
```

The local record must contain:

- `authorized: true`
- `source: "explicit-current-conversation-permission"`
- `operator_confirmed_local_record: true`
- `channel_id: "UCLjwcZaIkiFEed1VgQYSsrw"`
- Nonempty `scope`, `operator_statement`, and ISO-date `recorded_at` strings.

Records inside the repository must pass `git check-ignore`; tracked or nonignored
records are refused. The record is an operator assertion of current-conversation
permission, not cryptographic proof or permission inferred from a prior run.
Do not reuse it for a new run without current operator confirmation. Neither its
contents nor its private path are copied to the processing manifest.

For compatibility with the shared contract, the tool also **reads** an already
operator-set `RECS_MEDIA_AUTHORIZED=1` when no authorization file is provided.
It never sets that variable. An explicitly supplied but invalid record fails
even when the environment flag exists.

Before any media download, yt-dlp retrieves metadata with `--skip-download` and
the tool checks the exact channel ID and requested video ID. Other channels and
live/upcoming/unfinalized streams are refused. Metadata authorization is not
inferred from a title, URL handle, public availability, or an existing manifest.

yt-dlp uses `--ignore-config`, no playlists, and no persistent yt-dlp cache.
There are no arbitrary tool-argument or credential CLI options. If a recording
requires authentication, this implementation reports failure; extending access
requires an explicit operator-approved credential mechanism. Never put cookies
or signed URLs into logs, docs, repository content, or build output.

## External workspace lifecycle

Use a new empty external directory per recording. The directory is marked with
`.recs-media-workdir.json`, containing its canonical path, filesystem identity,
owner UID, and a random ownership token. Existing nonempty unowned directories
are refused. Repository paths (including `.local`), repository ancestors, shared
temporary roots, the home directory itself, and symlink roots are refused.

Successful stages retain their artifacts for the next stage. Processing uses a
workspace lock and isolated staging: rejection, failure or a handled interruption
preserves the existing acquisition, manifest and completed evidence. Publication
backs up replaced outputs and rolls them back on failure. A journal recovers an
interrupted publication before the next operation; recovery refuses to overwrite
later manual edits and retains the backup for inspection. `preflight` removes only
its newly owned nested smoke workspace. Whole-workspace removal is explicit:

```sh
# After inspecting/using the evidence and choosing to discard this owned workspace:
scripts/devenv-run pnpm media:cleanup -- --work-dir <owned-workspace>
```

Cleanup needs no media permission, but requires a valid sentinel matching the
directory's path, device/inode, and owner. It removes the entire owned directory,
including partial media, audio, frames, transcripts, and per-run metadata. It does
not follow contained directory symlinks. Keep the model cache separate from work
directories. Do not place unrelated files inside an owned workspace.

All native invocations use the imported `run_bounded.run(command, timeout)`.
A small exec launcher records the runner-created process group; media tooling
also kills remaining group members when a leader exits or fails. The shared
runner handles timeout and signal termination. SIGKILL or a machine crash cannot
run Python cleanup. Resume to recover an interrupted publication, or explicitly
discard the owned workspace with `cleanup`. Unpublished scratch may remain after
an abrupt kill and is removed by explicit workspace cleanup.

## Model provenance

The only supported transcription model is **`ggml-large-v3-turbo-q5_0.bin`** from
**`ggerganov/whisper.cpp`**. The default external cache is
`~/.cache/recs-replay/whisper.cpp`; override it with `--cache-dir`.

```sh
scripts/devenv-run python3 scripts/media.py model --cache-dir "$MODEL_CACHE"
scripts/devenv-run python3 scripts/media.py preflight \
  --authorization-file .local/media-authorization.json \
  --cache-dir "$MODEL_CACHE" --work-dir "$PREFLIGHT_WORK"
```

Authoritative metadata endpoint:

```text
https://huggingface.co/api/models/ggerganov/whisper.cpp/revision/main?blobs=true
```

The tool selects the exact filename's `lfs.sha256` and `lfs.size`, obtains the
repository commit SHA, then downloads the commit-pinned URL:

```text
https://huggingface.co/ggerganov/whisper.cpp/resolve/<commit-sha>/ggml-large-v3-turbo-q5_0.bin
```

It verifies both size and SHA-256 before atomically installing the model. Missing
authoritative LFS metadata, excess bytes, mismatched bytes, and interrupted
downloads fail; partial files are removed. Existing cached bytes are rehashed.
There is **no guessed or hardcoded checksum**.

`<cache>/ggml-large-v3-turbo-q5_0.bin.json` records `filename`, `source_url`,
`metadata_url`, `revision`, `size`, and the **actual authoritative `sha256`**.
The model command prints this same safe provenance JSON, and evidence includes
it. After the first live download, record that exact published hash and pinned
URL in the run's documentation; this tooling bootstrap has not fetched a hash.
Preflight and transcription rehash cached bytes against the local provenance
receipt. Do not rerun `model` to change model revisions mid-batch.

## Artifacts and timing

- `manifest.json`: channel/video IDs, original recording duration, actual acquired
  duration and absolute span, tool versions, creation time, and relative filenames.
  The source is `source.mkv` at up to 480p, with audio. Section acquisition forces
  keyframes at cuts. ffprobe rejects missing audio/video and media shorter than
  ten seconds with an objective near-empty diagnostic.
- `samples.json`, `sample-*.wav`, `sample-*.jpg`: 16 kHz mono PCM audio windows and
  timestamped frames. The last window is shortened at the acquired span's end.
- `chunk-*.wav`, `chunk-*.json`: requested-span-only audio and raw whisper.cpp
  output. Chunk length is 600 seconds, advance is 555 seconds (45-second overlap).
- `evidence.json`, `evidence.txt`: machine transcription evidence, absolute
  timestamps, requested span, language, model provenance, versions, elapsed time,
  and real-time factor. Raw chunks are retained for review. The combined view
  assigns segments by midpoint at overlap midpoints; differing ASR segmentation
  can still produce seam ambiguities. Review the raw overlap evidence rather than
  treating the combined view as an editorially reconciled transcript.

Whisper's millisecond `offsets` or clock `timestamps` are converted to absolute
recording seconds. Transcription defaults to English and never enables translation.
On Intel macOS, the pipeline supplies `--no-gpu`: calibration demonstrated a Metal
abort on this machine. Apple Silicon retains GPU inference. Evidence records the
actual inference options; use the same options throughout a corpus batch.
Choose the programme after coarse inspection, then explicitly request its span
with the contract's two-minute margins, clipped to available media. The tool does
not infer programme boundaries, speaker identities, summaries, or doctrine.

Preflight checks ffmpeg, ffprobe, yt-dlp, whisper.cpp, verified model bytes, and
free space (default minimum 2 GiB; increase for longer recordings). It accepts
`whisper-cli`, `whisper-cpp`, or `whisper`, or an explicit `--whisper-binary`.
When a packaged whisper.cpp CLI exposes no version, its manifest honestly says
`not exposed by CLI` and records the executable SHA-256; record the exact package
version from the pinned environment alongside that fingerprint.

The fixed failure recording `wh4mCRKRJ-4` should exit 2 as near-empty and discard its staged
workspace. Calibration uses `mw4SAoJRZgo`; acquire/sample/transcribe it separately
and record the reported pipeline real-time factor (including chunk extraction and
overlap) before deleting its workspace. Smoke and calibration evidence validate
tooling only, not real-content completion.

## Offline tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_media.py -v
```

The host-Python invocation is a tooling-bootstrap check only. Tests mock native
media work and HTTPS responses. Short Python subprocesses verify timeout and
descendant cleanup. Live devenv versions, model provenance, smoke, failure-path,
calibration, disk capacity, and media access remain separate acceptance checks.
