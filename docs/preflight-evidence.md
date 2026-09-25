# Milestone 1 media preflight evidence

**Status: PASS — remaining media preflight checks completed in the primary devenv on 2026-09-25.**

The full calibration passed after a focused workaround for a reproduced Intel-macOS
Metal abort. This validates tooling, not archive content or editorial completion.
The 112m39s baseline was used only for timeout calculation, not processed here.

## Environment and authorization

- Session: `agent-shell`, dedicated name `recs-calibration`.
- Every test/media execution entered the pinned primary environment through
  `scripts/devenv-run`; no fallback environment was used in this run.
- Platform: Darwin, `x86_64`; Python **3.13.15**.
- devenv **1.11.1 (x86_64-darwin)**; Nix **2.31.5**.
- Locked nixpkgs revision: `bd495b825e5c4365131f9b744cce923d42c06158`.
- Locked devenv revision: `51440964cd26a47e90064f9d59aa230a5cefc88b`.
- devenv emitted an informational CLI/input-version mismatch notice (1.11.1 versus
  input 1.10); shell entry succeeded. The existing pins were retained.
- Authorization came from the operator's explicit current-conversation permission
  and the supplied gitignored local record, passed with `--authorization-file`.
  No authorization environment flag was set. Record contents are not reproduced.
- Free space at the final smoke: **73,683,472,384 bytes (68.623 GiB)**, above the
  configured 2 GiB minimum.

| Native tool | Primary-devenv version |
| --- | --- |
| yt-dlp | 2026.08.19 |
| ffmpeg | 8.1.2 |
| ffprobe | 8.1.2 |
| whisper.cpp | Nix package `whisper-cpp-1.8.4` |

The whisper CLI does not expose its version. Its resolved Nix package supplied the
version above; the executable SHA-256 reported by the media tool was:

```text
ca96421296b25286fafcbfa319ad2c749abb9e70f2ed7a719ca45d1a1c0836e3
```

Final inference used `--no-gpu` on Intel macOS. Apple Silicon retains its default
GPU behavior. The engine, model, English language, 600-second chunks and 45-second
overlap were unchanged. Inference options are now included in transcription and
smoke evidence so the CPU workaround is explicit.

## Verified model provenance

The existing external model cache was retained. No `model` command or download
was repeated; preflight and transcription rehashed the bytes against the existing
authoritative provenance receipt.

| Field | Value |
| --- | --- |
| Filename | `ggml-large-v3-turbo-q5_0.bin` |
| Repository | `ggerganov/whisper.cpp` |
| Revision | `5359861c739e955e79d9a303bcbc70fb988958b1` |
| Size | 574,041,195 bytes |
| SHA-256 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |

Receipt metadata endpoint:

```text
https://huggingface.co/api/models/ggerganov/whisper.cpp/revision/main?blobs=true
```

Commit-pinned model source:

```text
https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin
```

## Commands and finite bounds

Paths below are portable placeholders: `$TEMP_PARENT` is an existing external
temporary parent; `$MODEL_CACHE` is the separate verified cache;
`$AUTHORIZATION_FILE` is the operator-confirmed gitignored record. `$SMOKE_WORK`,
`$FAILURE_WORK`, and `$CALIBRATION_WORK` are separate fresh child directories of
that temporary parent. No private absolute paths are included.

Command bodies were issued with `agent-shell exec recs-calibration -t 30`, then
collected with `agent-shell wait recs-calibration -t 120` or `-t 300`. These waits
do not replace the execution deadline enforced by `scripts/devenv-run`.

### Tests

```sh
PYTHONDONTWRITEBYTECODE=1 scripts/devenv-run \
  python3 -m unittest discover -s tests -p "test_*.py" -v
```

The default outer bound was **900 seconds**. Discovery included both
`test_media.py` and `test_bounded.py`.

### Smoke and expected failure

Normalized media command bodies, each run inside a bounded `scripts/devenv-run
sh -c` invocation with an EXIT cleanup trap and INT/TERM exit traps:

```sh
python3 scripts/media.py preflight \
  --authorization-file "$AUTHORIZATION_FILE" \
  --cache-dir "$MODEL_CACHE" --work-dir "$SMOKE_WORK"

python3 scripts/media.py acquire \
  --authorization-file "$AUTHORIZATION_FILE" \
  --youtube-id wh4mCRKRJ-4 --work-dir "$FAILURE_WORK"
```

Both outer and per-native limits were the **900-second defaults**. The cleanup
trap called `python3 scripts/media.py cleanup --work-dir "$WORK"` only if the
ownership sentinel remained. Shell `time` measured each complete wrapper call.
The preflight command itself selects smoke ID `MZr169xBwrU`, section `*0-60`.

### Calibration

A temporary external timing harness invoked `scripts.media.main()` sequentially
with the following exact CLI arguments (paths normalized). It used monotonic
timing around each stage, read only structural/timing fields for its summary,
and removed the sentinel-owned workspace in `finally`, including after failure
or interruption. Transcript text and sample content were not emitted or reviewed.

```sh
python3 scripts/media.py acquire \
  --authorization-file "$AUTHORIZATION_FILE" --youtube-id mw4SAoJRZgo \
  --work-dir "$CALIBRATION_WORK" --timeout 1200
python3 scripts/media.py sample \
  --authorization-file "$AUTHORIZATION_FILE" --youtube-id mw4SAoJRZgo \
  --work-dir "$CALIBRATION_WORK" --timeout 1200
python3 scripts/media.py transcribe \
  --authorization-file "$AUTHORIZATION_FILE" --youtube-id mw4SAoJRZgo \
  --work-dir "$CALIBRATION_WORK" --cache-dir "$MODEL_CACHE" \
  --start 0 --end 776.0 --language en --timeout 1200
```

The successful harness invocation was:

```sh
PYTHONDONTWRITEBYTECODE=1 RECS_DEVENV_TIMEOUT_SECONDS=1800 time \
  scripts/devenv-run python3 "$TEMP_PARENT/recs-m1-calibrate.py" \
  "$CALIBRATION_WORK" "$MODEL_CACHE"
```

The first attempt used the **900-second outer and native defaults**. Following
its 770-second native abort, the diagnostic replay and corrected run used a
finite **1,800-second outer** and **1,200-second per-native** limit, allowing room
for both chunks and cleanup. No bound was disabled. The diagnostic harness
captured native output privately and could emit only allowlisted categories,
tool names, exit codes and timings. It was removed after use.

## Results and timings

| Check | Result | Measured time |
| --- | --- | --- |
| Initial tests | 37 passed | 8.149 s test runner |
| Tests after Intel-macOS fix | **38 passed: 33 media, 5 bounded-runner** | **8.334 s** test runner |
| Initial primary smoke, default Metal | Passed; acquired 60.003 s; RTF 0.3197137795 | 35.00 s whole wrapper |
| Final primary smoke, CPU | **Passed**; acquired 60.003 s; RTF **0.3761253366** | **22.567520 s** transcription pipeline; **39.08 s** whole wrapper |
| Full near-empty failure recording | **Expected rejection**, media exit 2; no crash | **9.96 s** whole wrapper |
| Final calibration acquisition | Passed, exit 0 | **9.488222 s** |
| Final calibration sampling | Passed, exit 0 | **1.286066 s** |
| Final calibration transcription | Passed, exit 0 | **495.370937 s** pipeline; **499.051537 s** command |
| Final calibration complete harness | Passed | **510.94 s** whole wrapper |

Regression coverage includes native exit/timeout behavior, process-group and
descendant termination, signal cleanup, ownership validation, authorization,
model hash verification, timestamp/chunk handling, sampling, and the actual
whisper invocation's Intel-macOS CPU option. The new test also verifies that
Apple Silicon and Linux do not receive that platform-specific option, and that
the chosen options are recorded in evidence.

### Exact objective failures and resolution

1. **Expected near-empty rejection**, full `wh4mCRKRJ-4` acquisition:

   ```text
   media: Near-empty or unusable media (6.561s); audio and video of at least 10s required
   ```

   The workspace was removed by the failure path. This is the required successful
   negative test, not an access failure.

2. **Initial calibration native abort**, before the workaround:

   ```text
   media: Native tool failed (exit -6); raw output suppressed
   ```

   Acquisition took 9.712491 s, sampling 1.191570 s, and the failing transcription
   command 770.272170 s; the complete wrapper took 782.07 s. The media command
   returned 2. No complete calibration RTF was available from this attempt.
   It failed before either deadline, not by timeout.

   Safe classification from the macOS crash report: `EXC_CRASH`, `SIGABRT`,
   termination signal 6, `abort() called`; the faulting stack included
   `ggml_abort`, `ggml_metal_buffer_get_tensor`,
   `ggml_backend_sched_graph_compute_async`, and `whisper_full`.
   This identifies a native Metal tensor-buffer abort; it does not establish an
   out-of-memory cause. No raw crash report or native output was copied here.

3. **Diagnostic replay deliberately interrupted** once that crash evidence was
   available, after 79.11 s total. Acquisition and sampling had succeeded in
   10.757516 s and 1.356117 s. The harness confirmed workspace removal and model
   retention. During interrupt propagation the wrapper also emitted:

   ```text
   [Errno 1] Operation not permitted
   ```

   This interrupted replay is not claimed as a second native abort or a passed
   calibration. Final process inspection found no surviving media executables.

The focused fix in `scripts/media.py` passes `--no-gpu` only on Darwin `x86_64`
and records inference options. A regression was added in `tests/test_media.py`.
The post-fix primary smoke and complete calibration then passed. There were no
further retries or native failures.

### Full calibration measurements

- Recording: `mw4SAoJRZgo`; full acquisition, no section selector.
- Nominal fixture length is approximately 777 seconds. Live metadata reported
  **776.0 seconds**; ffprobe measured **776.281 seconds**. The tool's full manifest
  span is therefore **[0, 776.0]**, used for transcription without requesting
  beyond that validated span.
- Source size: **15,167,107 bytes**.
- Samples: **[0, 30]**, **[300, 330]**, **[600, 630]**; frames at 0, 300 and 600
  seconds. All six generated audio/frame files were nonempty.
- Transcription chunks: **[0, 600]**, **[555, 776]**; **821 seconds** processed
  including the 45-second overlap.
- Native whisper times: **383.628808 s** and **109.313678 s**, both exit 0.
- Pipeline elapsed: **495.370936619 s**, including chunk extraction and overlap.
- **Pipeline RTF = 495.370936619 / 776 = 0.638364609045.**
- Whole transcription command overhead beyond the timed pipeline: **3.680601 s**,
  including local model verification and tool checks.

## Calibrated finite timeouts: 112m39s baseline

For baseline `ZTDYIJUDb0M`, duration **6,759 seconds**:

| Operation | Expected processing | Selected bounds |
| --- | --- | --- |
| Full acquisition | `9.488222412 × 6759 / 776` = **82.642906 s** | **900 s native; 900 s outer** |
| Full transcription, duration-only projection | `0.638364609045 × 6759` = **4,314.706393 s** | Refined for overlap below |
| Full transcription, overlap-adjusted | **4,407.715273 s** (about 73m28s) | **1,200 s per native invocation; 13,260 s outer** |

The full baseline requires **13 chunks**, hence 12 overlaps and
`6759 + 12 × 45 = 7299` processed seconds. To account for the larger overlap
fraction, the selected transcription estimate is:

```text
expected = 495.370936619 × (7299 / 821) + 3.680600675
         = 4407.715273 seconds
outer    = max(900, ceil(3 × expected / 60) × 60)
         = 13260 seconds (3h41m)
native   = max(900, ceil(3 × 383.628808465 / 60) × 60)
         = 1200 seconds (20m)
```

Acquisition's three-times estimate is below the 900-second floor. The outer
transcription limit covers the complete multi-chunk operation and environment
startup; the native limit applies separately to each extraction/inference call.
These are measured-host projections, not observed processing times for the
baseline. Recalibrate if the engine, model or compute platform changes.

Future command settings, **not executed on the baseline in this preflight**:

```sh
RECS_DEVENV_TIMEOUT_SECONDS=900 scripts/devenv-run python3 scripts/media.py acquire \
  --authorization-file "$AUTHORIZATION_FILE" --youtube-id ZTDYIJUDb0M \
  --work-dir "$BASELINE_WORK" --timeout 900

RECS_DEVENV_TIMEOUT_SECONDS=13260 scripts/devenv-run python3 scripts/media.py transcribe \
  --authorization-file "$AUTHORIZATION_FILE" --youtube-id ZTDYIJUDb0M \
  --work-dir "$BASELINE_WORK" --cache-dir "$MODEL_CACHE" \
  --start 0 --end 6759 --language en --timeout 1200
```

Actual archive processing must first validate the acquired span and select its
programme interval through the separate content workflow.

## Cleanup and retained evidence

- Both primary smoke runs removed their nested media and outer owned workspaces.
- The expected failure, aborted calibration, interrupted diagnostic replay and
  successful calibration all removed their owned workspaces.
- Final external-parent inspection confirmed all three run workspace paths were
  absent. No acquired media, extracted audio, frames, raw chunk JSON, transcripts
  or per-run manifests from these checks remain.
- Final bounded process inspection found **no `whisper-cli`, `whisper-cpp`,
  `yt-dlp`, `ffmpeg` or `ffprobe` processes**.
- The separate model binary and provenance receipt remain. A pre-existing smoke
  directory contained only its safe `preflight.json` and ownership sentinel,
  with no media; it was left intact.
- This document retains only tooling measurements and safe diagnostics. No
  recording interpretation, archive records or transcript text were produced
  in the repository, and no Git commit was created.
