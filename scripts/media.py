#!/usr/bin/env python3
"""Authorized, bounded local media evidence tooling (Python standard library only)."""

import argparse
import contextlib
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import sys
import tempfile
import time
import urllib.request
import uuid

try:
    from .run_bounded import run
except ImportError:
    from run_bounded import run


REPO = Path(__file__).resolve().parents[1]
CHANNEL = "UCLjwcZaIkiFEed1VgQYSsrw"
SMOKE = "MZr169xBwrU"
MODEL = "ggml-large-v3-turbo-q5_0.bin"
MODEL_REPO = "ggerganov/whisper.cpp"
MODEL_API = f"https://huggingface.co/api/models/{MODEL_REPO}/revision/main?blobs=true"
SENTINEL = ".recs-media-workdir.json"
DEFAULT_CACHE = Path.home() / ".cache/recs-replay/whisper.cpp"


class MediaError(Exception):
    """Safe, operator-facing diagnostic: never include raw subprocess output."""


def youtube_id(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", value):
        raise argparse.ArgumentTypeError("YouTube ID must contain exactly 11 URL-safe characters")
    return value


def seconds(value):
    """Parse seconds or whisper.cpp HH:MM:SS.mmm (also comma milliseconds)."""
    if isinstance(value, str) and ":" in value:
        parts = value.replace(",", ".").split(":")
        if len(parts) != 3:
            raise ValueError("Expected HH:MM:SS.mmm")
        hours, minutes, secs = map(float, parts)
        if hours < 0 or hours != int(hours) or not 0 <= minutes < 60 or minutes != int(minutes) or not 0 <= secs < 60:
            raise ValueError("Invalid timestamp")
        value = hours * 3600 + minutes * 60 + secs
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Seconds must be finite and nonnegative")
    return result


def timestamp(value):
    milliseconds = round(seconds(value) * 1000)
    hours, remainder = divmod(milliseconds, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    secs, ms = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}.{ms:03}"


def write_json(path, data):
    # Output files are private and atomically replaced within owned directories.
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False, allow_nan=False)
            handle.write("\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise MediaError("Required local JSON is missing or invalid") from None


def external_path(path):
    raw = Path(path).expanduser().absolute()
    if raw.is_symlink():
        raise MediaError("Symlink roots are not allowed")
    resolved = raw.resolve()
    if resolved == REPO or REPO in resolved.parents or resolved in REPO.parents:
        raise MediaError("Media/cache root must be outside the repository and its ancestors")
    if resolved in (Path.home().resolve(), Path(tempfile.gettempdir()).resolve(), Path("/")):
        raise MediaError("Use a dedicated external subdirectory, not a shared root")
    return resolved


def owned_workdir(path, create=False):
    root = external_path(path)
    marker = root / SENTINEL
    if create and not marker.exists():
        if root.exists() and (not root.is_dir() or any(root.iterdir())):
            raise MediaError("New media work directory must be empty")
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        stat = root.stat()
        write_json(marker, {"kind": "recs-media-workdir", "schema_version": 1,
                            "path": str(root), "device": stat.st_dev, "inode": stat.st_ino,
                            "uid": os.getuid(), "token": uuid.uuid4().hex})
    if not root.is_dir() or marker.is_symlink() or not marker.is_file():
        raise MediaError("Refusing unowned media directory: ownership sentinel required")
    data = read_json(marker)
    stat = root.stat()
    if not isinstance(data, dict) or any((
        data.get("kind") != "recs-media-workdir", data.get("schema_version") != 1,
        data.get("path") != str(root), data.get("device") != stat.st_dev,
        data.get("inode") != stat.st_ino, data.get("uid") != os.getuid(),
        stat.st_uid != os.getuid(), not re.fullmatch(r"[0-9a-f]{32}", str(data.get("token", ""))),
    )):
        raise MediaError("Refusing directory with invalid ownership sentinel")
    return root


def cleanup(path):
    root = owned_workdir(path)
    # shutil.rmtree does not follow directory symlinks; root/sentinel were checked above.
    shutil.rmtree(root)


def command(argv, timeout=900, allow_failure=False):
    """Capture inherited file descriptors while using the shared process-group runner.

    Native output is never replayed: yt-dlp/ffmpeg may include signed URLs or cookies.
    This synchronous CLI deliberately does not run commands in multiple threads.
    """
    if not math.isfinite(timeout) or timeout <= 0:
        raise MediaError("Timeout must be positive and finite")
    with tempfile.TemporaryDirectory(prefix="recs-media-command-") as temporary, tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        # The launcher execs (does not fork) the native tool in run()'s session.
        # Remember the group so even a failing leader cannot leave descendants.
        pid_file = Path(temporary) / "group"
        launcher = ("import os,sys; "
                    "open(sys.argv[1], 'w').write(str(os.getpid())); "
                    "os.execvp(sys.argv[2], sys.argv[2:])")
        sys.stdout.flush()
        sys.stderr.flush()
        saved = (os.dup(1), os.dup(2))
        try:
            os.dup2(output.fileno(), 1)
            os.dup2(errors.fileno(), 2)
            code = run([sys.executable, "-c", launcher, str(pid_file), *[str(arg) for arg in argv]], timeout)
        finally:
            try:
                if pid_file.exists():
                    group = int(pid_file.read_text())
                    try:
                        os.killpg(group, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            finally:
                os.dup2(saved[0], 1)
                os.dup2(saved[1], 2)
                os.close(saved[0])
                os.close(saved[1])
        output.seek(0)
        errors.seek(0)
        stdout = output.read().decode("utf-8", errors="replace")
        stderr = errors.read().decode("utf-8", errors="replace")
    if code and not allow_failure:
        if code == 124:
            raise MediaError("Native tool timed out; bounded runner terminated its process group")
        raise MediaError(f"Native tool failed (exit {code}); raw output suppressed")
    return code, stdout, stderr


def authorize(path=None):
    # Read an operator flag if supplied; never create or change it.
    if path is None:
        if os.environ.get("RECS_MEDIA_AUTHORIZED") == "1":
            return
        raise MediaError("Explicit operator authorization required; pass --authorization-file")
    record = Path(path).expanduser().resolve()
    if REPO in record.parents:
        code, _, _ = command(["git", "-C", REPO, "check-ignore", "--quiet", "--", record], 30, True)
        if code != 0:
            raise MediaError("Authorization record must be gitignored, never committed")
    data = read_json(record)
    if not isinstance(data, dict) or data.get("authorized") is not True:
        raise MediaError("Authorization record does not grant permission")
    if data.get("channel_id") != CHANNEL:
        raise MediaError("Authorization must scope the RECS source channel")
    if data.get("source") != "explicit-current-conversation-permission" or data.get("operator_confirmed_local_record") is not True:
        raise MediaError("Authorization must confirm the explicit operator conversation source")
    if any(not isinstance(data.get(key), str) or not data[key].strip()
           for key in ("scope", "operator_statement", "recorded_at")):
        raise MediaError("Authorization record is missing its scope, statement, or date")
    try:
        datetime.date.fromisoformat(data["recorded_at"])
    except ValueError:
        raise MediaError("Authorization record date must be ISO YYYY-MM-DD") from None


def tool_versions(whisper_binary=None):
    whisper = whisper_binary or next((name for name in ("whisper-cli", "whisper-cpp", "whisper") if shutil.which(name)), None)
    if not whisper:
        raise MediaError("whisper.cpp binary missing; check inside devenv or pass --whisper-binary")
    versions = {}
    for name, executable, flag in (("ffmpeg", "ffmpeg", "-version"), ("ffprobe", "ffprobe", "-version"),
                                   ("yt-dlp", "yt-dlp", "--version"), ("whisper.cpp", whisper, "--version")):
        if not shutil.which(executable):
            raise MediaError(f"Required tool missing: {name}; check inside devenv")
        code, out, err = command([executable, flag], 30, True)
        if name == "whisper.cpp" and code:
            code, out, err = command([executable, "--help"], 30, True)
        text = out + "\n" + err
        if code:
            raise MediaError(f"Cannot verify tool version: {name}")
        if name == "yt-dlp":
            match = re.search(r"(?m)^\d{4}\.\d{2}\.\d{2}(?:[\w.+-]*)$", text)
        elif name == "whisper.cpp":
            match = re.search(r"(?im)(?:whisper(?:\.cpp|-cli|-cpp)?\s+(?:version\s*)?v?\d[\w.+-]*|version[: ]+v?\d[\w.+-]*)", text)
        else:
            match = re.search(rf"(?m)^{name} version ([^\s]+)", text)
        if match:
            versions[name] = match.group(0)
        elif name == "whisper.cpp" and "usage:" in text.lower():
            # Some packaged whisper.cpp builds expose no version option/banner.
            executable_path = Path(shutil.which(executable)).resolve()
            versions[name] = {"version": "not exposed by CLI", "binary_sha256": sha256(executable_path)}
        else:
            raise MediaError(f"Unrecognized version response: {name}")
    return versions, whisper


def check_space(root, minimum_gib):
    if not math.isfinite(minimum_gib) or minimum_gib <= 0:
        raise MediaError("Minimum free space must be positive and finite")
    free = shutil.disk_usage(root).free
    if free < minimum_gib * 1024 ** 3:
        raise MediaError(f"Insufficient temporary space: require {minimum_gib:g} GiB free")
    return free


def section_span(value):
    match = re.fullmatch(r"\*?(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", value)
    if not match:
        raise MediaError("--sections must be a single numeric range, e.g. '*0-60'")
    start, end = map(seconds, match.groups())
    if end <= start:
        raise MediaError("Section end must be greater than start")
    return start, end


def probe(path, timeout):
    _, out, _ = command(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path], timeout)
    try:
        info = json.loads(out)
        duration = seconds(info["format"]["duration"])
        kinds = {stream["codec_type"] for stream in info["streams"]}
    except (ValueError, KeyError, TypeError):
        raise MediaError("ffprobe did not report a usable duration and streams") from None
    if duration < 10 or "audio" not in kinds or "video" not in kinds:
        raise MediaError(f"Near-empty or unusable media ({duration:.3f}s); audio and video of at least 10s required")
    return duration


def acquire(root, video_id, authorization_file, timeout, sections=None, whisper_binary=None, minimum_gib=2):
    authorize(authorization_file)
    youtube_id(video_id)
    if (root / "manifest.json").exists() or any(root.glob("source.*")):
        raise MediaError("Work directory already contains an acquisition; use a fresh directory")
    check_space(root, minimum_gib)
    versions, _ = tool_versions(whisper_binary)
    url = f"https://www.youtube.com/watch?v={video_id}"
    base = ["yt-dlp", "--ignore-config", "--no-playlist", "--no-progress", "--no-warnings", "--no-cache-dir"]
    _, out, _ = command(base + ["--skip-download", "--dump-single-json", url], timeout)
    try:
        metadata = json.loads(out)
        if metadata.get("channel_id") != CHANNEL:
            raise MediaError("Refusing media: metadata channel is not the authorized RECS channel")
        if metadata.get("id") != video_id:
            raise MediaError("Metadata YouTube ID does not match the requested recording")
        if metadata.get("is_live") or metadata.get("live_status") in ("is_live", "is_upcoming", "post_live"):
            raise MediaError("Recording is live, upcoming, or not yet finalized")
        recording_duration = seconds(metadata["duration"])
    except (ValueError, KeyError, TypeError, AttributeError):
        raise MediaError("Recording metadata is invalid or lacks duration") from None
    start, end = section_span(sections) if sections else (0, recording_duration)
    if end > recording_duration or end <= start:
        raise MediaError("Requested acquisition section is outside the recording")
    download = base + ["--format", "bestvideo[height<=480]+bestaudio/best[height<=480]",
                       "--merge-output-format", "mkv", "--remux-video", "mkv",
                       "--output", str(root / "source.%(ext)s")]
    if sections:
        download += ["--download-sections", f"*{start:g}-{end:g}", "--force-keyframes-at-cuts"]
    command(download + [url], timeout)
    source = root / "source.mkv"
    if not source.is_file() or source.is_symlink():
        raise MediaError("Acquisition did not produce the expected media filename")
    duration = probe(source, timeout)
    manifest = {"schema_version": 1, "youtube_id": video_id, "channel_id": CHANNEL,
                "recording_duration_seconds": recording_duration, "duration_seconds": duration,
                "acquired_span": {"start": start, "end": min(end, start + duration)},
                "source_file": source.name, "tool_versions": versions,
                "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "files": sorted(p.name for p in root.iterdir() if p.name != SENTINEL)}
    write_json(root / "manifest.json", manifest)
    return manifest


def manifest_for(root, video_id=None):
    data = read_json(root / "manifest.json")
    if not isinstance(data, dict) or data.get("channel_id") != CHANNEL:
        raise MediaError("Manifest is not for the authorized channel")
    youtube_id(data.get("youtube_id", ""))
    if video_id and data["youtube_id"] != video_id:
        raise MediaError("Requested YouTube ID differs from the work directory")
    if data.get("source_file") != "source.mkv" or (root / "source.mkv").is_symlink():
        raise MediaError("Invalid source filename in manifest")
    start, end = (seconds(data["acquired_span"][key]) for key in ("start", "end"))
    if end <= start or not (root / "source.mkv").is_file():
        raise MediaError("Manifest span or source media is invalid")
    # Existing workspaces must not redirect generated evidence writes elsewhere.
    if any(path.is_symlink() for path in root.iterdir()):
        raise MediaError("Symlinks are not allowed in a processing workspace")
    return data


def extract_audio(root, filename, local_start, duration, timeout):
    command(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{local_start:.3f}",
             "-i", root / "source.mkv", "-t", f"{duration:.3f}", "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", root / filename], timeout)


def save_manifest(root, data):
    data["files"] = sorted(p.name for p in root.iterdir() if p.name not in (SENTINEL, "manifest.json"))
    write_json(root / "manifest.json", data)


def sample(root, timeout, video_id=None):
    data = manifest_for(root, video_id)
    start, end = data["acquired_span"]["start"], data["acquired_span"]["end"]
    samples = []
    for index, offset in enumerate(range(0, math.ceil(end - start), 300)):
        length = min(30, end - start - offset)
        audio, frame = f"sample-{index:04}.wav", f"sample-{index:04}.jpg"
        extract_audio(root, audio, offset, length, timeout)
        command(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(offset),
                 "-i", root / "source.mkv", "-frames:v", "1", "-q:v", "3", root / frame], timeout)
        samples.append({"start": start + offset, "end": start + offset + length,
                        "audio_file": audio, "frame_file": frame, "frame_timestamp": start + offset})
    evidence = {"youtube_id": data["youtube_id"], "timestamp_basis": "absolute recording seconds", "samples": samples}
    write_json(root / "samples.json", evidence)
    data["sampling"] = {"window_seconds": 30, "interval_seconds": 300, "evidence_file": "samples.json"}
    save_manifest(root, data)
    return evidence


def chunks(start, end):
    start, end = seconds(start), seconds(end)
    if end <= start:
        raise MediaError("Transcription end must be greater than start")
    while start < end:
        stop = min(start + 600, end)
        yield start, stop
        if stop == end:
            break
        start += 555


def absolute_segments(payload, chunk_start, chunk_end):
    """whisper.cpp offsets are milliseconds; timestamps are HH:MM:SS.mmm."""
    result = []
    if not isinstance(payload, dict) or not isinstance(payload.get("transcription"), list):
        raise MediaError("Unrecognized whisper.cpp JSON (expected transcription array)")
    for item in payload["transcription"]:
        try:
            if "offsets" in item:
                local_start, local_end = (seconds(item["offsets"][key]) / 1000 for key in ("from", "to"))
            else:
                local_start, local_end = (seconds(item["timestamps"][key]) for key in ("from", "to"))
            text = item["text"].strip()
            if local_end < local_start:
                raise ValueError()
        except (KeyError, TypeError, ValueError, AttributeError):
            raise MediaError("Invalid whisper.cpp segment timestamps or text") from None
        start, end = chunk_start + local_start, min(chunk_end, chunk_start + local_end)
        if start < end and text:
            result.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return result


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def model_metadata():
    with urllib.request.urlopen(MODEL_API, timeout=30) as response:
        metadata = json.load(response)
    try:
        revision = metadata["sha"]
        entry = next(item for item in metadata["siblings"] if item["rfilename"] == MODEL)
        digest, size = entry["lfs"]["sha256"], entry["lfs"]["size"]
        if not re.fullmatch(r"[0-9a-f]{40}", revision) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError()
        if not isinstance(size, int) or size <= 0:
            raise ValueError()
    except (KeyError, StopIteration, TypeError, ValueError):
        raise MediaError("Model source did not supply authoritative LFS SHA-256, size, and revision") from None
    return {"filename": MODEL, "sha256": digest, "size": size, "revision": revision,
            "source_url": f"https://huggingface.co/{MODEL_REPO}/resolve/{revision}/{MODEL}",
            "metadata_url": MODEL_API}


def download_model(cache_dir, timeout):
    cache = external_path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = model_metadata()
    target = cache / MODEL
    if target.is_symlink():
        raise MediaError("Model cache file must not be a symlink")
    if target.is_file() and target.stat().st_size == info["size"] and sha256(target) == info["sha256"]:
        write_json(cache / (MODEL + ".json"), info)
        return info
    if shutil.disk_usage(cache).free < info["size"] + 256 * 1024 ** 2:
        raise MediaError("Insufficient model cache space")
    started = time.monotonic()
    fd, name = tempfile.mkstemp(prefix=MODEL + ".", suffix=".part", dir=cache)
    partial = Path(name)
    try:
        digest, size = hashlib.sha256(), 0
        with os.fdopen(fd, "wb") as handle, urllib.request.urlopen(info["source_url"], timeout=min(timeout, 30)) as response:
            while True:
                if time.monotonic() - started > timeout:
                    raise MediaError("Model download exceeded its finite time bound")
                block = response.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > info["size"]:
                    raise MediaError("Downloaded model exceeds authoritative LFS size")
                digest.update(block)
                handle.write(block)
        if size != info["size"] or digest.hexdigest() != info["sha256"]:
            raise MediaError("Downloaded model failed authoritative LFS SHA-256 verification")
        partial.replace(target)
        write_json(cache / (MODEL + ".json"), info)
    finally:
        partial.unlink(missing_ok=True)
    return info


def verified_model(cache_dir):
    cache = external_path(cache_dir)
    target = cache / MODEL
    info = read_json(cache / (MODEL + ".json"))
    if not isinstance(info, dict) or info.get("filename") != MODEL or info.get("metadata_url") != MODEL_API:
        raise MediaError("Model provenance receipt missing; run the model command")
    revision = info.get("revision", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or info.get("source_url") != f"https://huggingface.co/{MODEL_REPO}/resolve/{revision}/{MODEL}":
        raise MediaError("Invalid model source receipt")
    if target.is_symlink() or not target.is_file() or target.stat().st_size != info.get("size") or sha256(target) != info.get("sha256"):
        raise MediaError("Cached model failed verification; run the model command")
    return target, info


@contextlib.contextmanager
def deadline(timeout):
    """Bound HTTPS metadata/download as a whole, including slow-drip responses."""
    def expired(signum, frame):
        raise MediaError("Model operation exceeded its finite time bound")
    previous = signal.signal(signal.SIGALRM, expired)
    old_timer = signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *old_timer)
        signal.signal(signal.SIGALRM, previous)


def transcribe(root, start, end, cache_dir, language, timeout, whisper_binary=None, video_id=None):
    data = manifest_for(root, video_id)
    offset, available_end = data["acquired_span"]["start"], data["acquired_span"]["end"]
    if start < offset or end > available_end:
        raise MediaError("Requested transcription span is outside acquired media")
    spans = list(chunks(start, end))
    if not re.fullmatch(r"[a-z]{2,3}", language):
        raise MediaError("Language must be an explicit whisper.cpp language code; translation is not enabled")
    model, provenance = verified_model(cache_dir)
    versions, whisper = tool_versions(whisper_binary)
    # Intel macOS Metal can abort in ggml_metal_buffer_get_tensor on long audio.
    # Keep Metal enabled on Apple Silicon; use the same model/engine on CPU here.
    inference_options = ["--no-gpu"] if sys.platform == "darwin" and platform.machine() == "x86_64" else []
    evidence_chunks, segments = [], []
    started = time.monotonic()
    for index, (begin, stop) in enumerate(spans):
        stem = f"chunk-{index:04}"
        extract_audio(root, stem + ".wav", begin - offset, stop - begin, timeout)
        command([whisper, *inference_options, "--model", model, "--language", language, "--file", root / (stem + ".wav"),
                 "--output-json", "--output-file", root / stem], timeout)
        raw = absolute_segments(read_json(root / (stem + ".json")), begin, stop)
        # Divide each overlap at its midpoint; keep one owner for each segment midpoint.
        # Raw evidence remains available for human reconciliation at seams.
        keep_start = begin if index == 0 else begin + 22.5
        keep_end = stop if index == len(spans) - 1 else stop - 22.5
        for segment in raw:
            if keep_start <= (segment["start"] + segment["end"]) / 2 < keep_end:
                segments.append({**segment, "chunk_index": index})
        evidence_chunks.append({"index": index, "start": begin, "end": stop,
                                "audio_file": stem + ".wav", "raw_json_file": stem + ".json",
                                "segments": raw})
    elapsed = time.monotonic() - started
    evidence = {"schema_version": 1, "youtube_id": data["youtube_id"], "language": language,
                "timestamp_basis": "absolute recording seconds", "transcribed_span": {"start": start, "end": end},
                 "model": provenance, "tool_versions": versions, "inference_options": inference_options,
                 "chunk_seconds": 600, "overlap_seconds": 45,
                "overlap_policy": "segment midpoint ownership; inspect raw chunks at seams",
                "elapsed_seconds": elapsed, "real_time_factor": elapsed / (end - start),
                "chunks": evidence_chunks, "segments": segments,
                "status": "machine transcription evidence; not editorially reviewed"}
    write_json(root / "evidence.json", evidence)
    (root / "evidence.txt").write_text("".join(
        f"[{timestamp(item['start'])} --> {timestamp(item['end'])}] {item['text']}\n" for item in segments), encoding="utf-8")
    data["transcription"] = {"start": start, "end": end, "language": language, "evidence_file": "evidence.json"}
    save_manifest(root, data)
    return {"youtube_id": data["youtube_id"], "transcribed_span": evidence["transcribed_span"],
            "inference_options": inference_options,
            "elapsed_seconds": elapsed, "real_time_factor": evidence["real_time_factor"],
            "evidence_files": ["evidence.json", "evidence.txt"]}


def preflight(root, args):
    versions, _ = tool_versions(args.whisper_binary)
    free = check_space(root, args.min_free_gib)
    _, provenance = verified_model(args.cache_dir)
    smoke_root = owned_workdir(root / "smoke", create=True)
    try:
        smoke = acquire(smoke_root, SMOKE, args.authorization_file, args.timeout, "*0-60", args.whisper_binary, args.min_free_gib)
        smoke_duration = smoke["duration_seconds"]
        transcript = transcribe(smoke_root, 0, min(60, smoke["acquired_span"]["end"]), args.cache_dir,
                                "en", args.timeout, args.whisper_binary)
    finally:
        cleanup(smoke_root)
    report = {"tool_versions": versions, "free_bytes": free, "model": provenance,
              "smoke": {"youtube_id": SMOKE, "sections": "*0-60", "duration_seconds": smoke_duration,
                        "inference_options": transcript["inference_options"],
                        "real_time_factor": transcript["real_time_factor"], "cleaned": True}}
    write_json(root / "preflight.json", report)
    return report


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    sub = cli.add_subparsers(dest="command", required=True)
    for name in ("preflight", "acquire", "sample", "transcribe", "cleanup", "model"):
        child = sub.add_parser(name)
        child.add_argument("--authorization-file", type=Path)
        child.add_argument("--work-dir", type=Path, required=name != "model")
        child.add_argument("--youtube-id", type=youtube_id, required=name == "acquire")
        child.add_argument("--timeout", type=float, default=900, help="finite seconds per native invocation/download")
        if name in ("preflight", "model", "transcribe"):
            child.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
        if name in ("preflight", "acquire", "transcribe"):
            child.add_argument("--whisper-binary", help="packaged whisper.cpp executable name/path")
        if name in ("preflight", "acquire"):
            child.add_argument("--min-free-gib", type=float, default=2)
        if name == "acquire":
            child.add_argument("--sections", help="one acquisition range, e.g. '*0-60'")
        if name == "transcribe":
            child.add_argument("--start", type=seconds, required=True)
            child.add_argument("--end", type=seconds, required=True)
            child.add_argument("--language", default="en")
    return cli


@contextlib.contextmanager
def interrupt_cleanup():
    def interrupt(signum, frame):
        raise SystemExit(128 + signum)
    previous = {sig: signal.signal(sig, interrupt) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    # pnpm's documented `pnpm media:acquire -- --youtube-id ...` form.
    if len(argv) > 1 and argv[1] == "--":
        del argv[1]
    args = parser().parse_args(argv)
    root = None
    try:
        with interrupt_cleanup():
            if not math.isfinite(args.timeout) or args.timeout <= 0:
                raise MediaError("Timeout must be positive and finite")
            if args.command == "cleanup":
                cleanup(args.work_dir)
                result = {"cleaned": True}
            elif args.command == "model":
                with deadline(args.timeout):
                    result = download_model(args.cache_dir, args.timeout)
            else:
                authorize(args.authorization_file)
                root = owned_workdir(args.work_dir, create=args.command in ("acquire", "preflight"))
                try:
                    if any(path.is_symlink() for path in root.iterdir()):
                        raise MediaError("Symlinks are not allowed in a processing workspace")
                    if args.command == "preflight":
                        result = preflight(root, args)
                    elif args.command == "acquire":
                        result = acquire(root, args.youtube_id, args.authorization_file, args.timeout,
                                         args.sections, args.whisper_binary, args.min_free_gib)
                    elif args.command == "sample":
                        result = sample(root, args.timeout, args.youtube_id)
                    else:
                        result = transcribe(root, args.start, args.end, args.cache_dir, args.language,
                                            args.timeout, args.whisper_binary, args.youtube_id)
                except BaseException:
                    cleanup(root)
                    raise
            print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except MediaError as error:
        print(f"media: {error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, TypeError, argparse.ArgumentTypeError):
        print("media: operation failed; filesystem/network/tool detail suppressed to protect local data", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
