#!/usr/bin/env python3
"""Manual, offline import of operator-approved Colab transcription evidence."""

import argparse
import contextlib
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

try:
    from . import media
except ImportError:
    import media


ENGINE = {"name": "faster-whisper", "version": "1.2.1", "ctranslate2": "4.8.2",
          "model": "large-v3-turbo", "compute_type": "float16", "device": "Tesla T4",
          "options": {"beam_size": 5, "word_timestamps": True, "vad_filter": False,
                      "condition_on_previous_text": False}}
RECEIPT = "import-receipt.json"
KIND = "recs-colab-evidence-import"
TAIL_TOLERANCE = 0.1
DURATION_TOLERANCE = 2.0
RTF_TOLERANCE = 0.0000051  # Bundle RTF is rounded to five decimal places.
ID = r"[A-Za-z0-9_-]{11}"
SHA = r"[0-9a-f]{64}"
Error = media.MediaError


class TimingError(Error):
    """All safe segment/word diagnostics from a complete timing scan."""

    def __init__(self, issues, verification):
        super().__init__("; ".join(issues))
        self.issues = issues
        self.verification = verification


def require(condition, message):
    if not condition:
        raise Error(message)


def number(value, label, positive=False):
    try:
        finite = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        finite = False
    require(finite, f"Invalid numeric {label}")
    require(value > 0 if positive else value >= 0, f"Invalid numeric {label}")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def parse_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def invalid_constant(_):
        raise Error("Nonfinite JSON number")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)


def read_regular(path):
    require(not path.is_symlink() and path.is_file(), "Required regular file missing or symlinked")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as handle:
        require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), "Required regular file invalid")
        return handle.read()


def checksums(path):
    entries = {}
    for line in read_regular(Path(path)).decode("utf-8").splitlines():
        match = re.fullmatch(rf"({SHA}) [ *]({ID}\.json)", line)
        require(match is not None, "Invalid SHA256SUMS line or unsafe filename")
        value, name = match.groups()
        require(name not in entries, "Duplicate SHA256SUMS filename")
        entries[name] = value
    require(bool(entries), "Empty SHA256SUMS")
    return entries


def validate(payload, filename, source_duration=None):
    """Return normalized copies; raw input and its exact engine JSON stay untouched."""
    require(isinstance(payload, dict), "Transcript must be a JSON object")
    video_id = payload.get("video_id")
    require(isinstance(video_id, str) and re.fullmatch(ID, video_id), "Invalid transcript video ID")
    require(filename == video_id + ".json", "Transcript filename/video ID mismatch")
    require(payload.get("audio_file") == video_id + ".webm", "Audio filename/video ID mismatch")
    require(isinstance(payload.get("audio_sha256"), str) and re.fullmatch(SHA, payload["audio_sha256"]),
            "Invalid audio SHA-256")
    require(json.dumps(payload.get("engine"), sort_keys=True) == json.dumps(ENGINE, sort_keys=True),
            "Unapproved transcription engine or settings")
    language = payload.get("language")
    require(isinstance(language, str) and re.fullmatch(r"[a-z]{2,3}", language), "Invalid original language")
    duration = number(payload.get("duration_seconds"), "duration", positive=True)
    elapsed = number(payload.get("elapsed_seconds"), "elapsed", positive=True)
    rtf = number(payload.get("real_time_factor"), "RTF", positive=True)
    require(abs(rtf - elapsed / duration) <= RTF_TOLERANCE, "Inconsistent elapsed/duration/RTF")
    when = payload.get("transcribed_at")
    require(isinstance(when, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", when),
        "Invalid transcription date")
    try:
        require(datetime.datetime.fromisoformat(when.replace("Z", "+00:00")).tzinfo is not None,
                "Transcription date requires timezone")
    except ValueError:
        raise Error("Invalid transcription date") from None
    bound = min(duration, source_duration) if source_duration is not None else duration
    clamp_count = 0

    def times(item, label):
        nonlocal clamp_count
        require(isinstance(item, dict), f"Invalid {label}")
        start, end = (number(item.get(key), label + " " + key) for key in ("start", "end"))
        require(start <= end, f"Reversed {label} timestamps")
        normalized = []
        for value in (start, end):
            require(value <= bound + TAIL_TOLERANCE + 1e-9, f"Out-of-bounds {label} timestamp")
            if value > bound:
                clamp_count += 1
                value = bound
            normalized.append(value)
        return normalized

    segments = payload.get("segments")
    require(isinstance(segments, list) and bool(segments), "Nonempty segments required")
    result, seen, previous_start, previous_end = [], set(), 0, 0
    previous_id = None
    issues, warnings = [], {}
    zero_segments = zero_words = 0
    word_count = 0

    def check(condition, message):
        if not condition:
            issues.append(message)
        return bool(condition)

    def warn(kind, ident, offset):
        key = kind, ident
        warning = warnings.setdefault(key, {"kind": kind, "segment_id": ident,
                                            "count": 0, "max_offset_seconds": 0})
        warning["count"] += 1
        # Only diagnostic offsets are rounded; evidence timestamps are never rounded here.
        warning["max_offset_seconds"] = max(warning["max_offset_seconds"], round(offset, 9))
        return warning

    def checked_times(item, label):
        try:
            return times(item, label)
        except Error as error:
            issues.append(str(error))
            return None

    for segment_index, segment in enumerate(segments):
        label = f"segment index {segment_index}"
        span = checked_times(segment, label)
        if not isinstance(segment, dict):
            continue
        ident = segment.get("id")
        valid_id = type(ident) is int and ident >= 0
        check(valid_id and ident not in seen, f"Invalid or duplicate segment ID at {label}")
        if valid_id:
            seen.add(ident)
        check(isinstance(segment.get("text"), str) and segment["text"].strip(), f"Empty text at {label}")
        output = {"id": ident, "text": segment.get("text")}
        if span is not None:
            start, end = span
            # Ordering and alignment diagnostics use the SOURCE times, before any tail clamp.
            raw_start, raw_end = segment["start"], segment["end"]
            if valid_id and previous_id is not None and raw_start < previous_start:
                backward = previous_start - raw_start
                warning = warn("nonmonotonic_segment_start", ident, backward)
                warning.update({"previous_segment_id": previous_id, "current_segment_id": ident,
                                "backward_seconds": round(backward, 9),
                                "requires_curator_review_before_publishing": True})
            if valid_id and raw_start < previous_end:
                warn("segment_overlap", ident, min(previous_end, raw_end) - raw_start)
            previous_start, previous_end = raw_start, max(previous_end, raw_end)
            previous_id = ident if valid_id else None
            output.update({"start": start, "end": end})
            zero_segments += start == end
        for key in ("avg_logprob", "no_speech_prob", "compression_ratio"):
            if key in segment:
                value = segment[key]
                try:
                    finite = type(value) in (int, float) and math.isfinite(value)
                except OverflowError:
                    finite = False
                check(finite and (value <= 0 if key == "avg_logprob" else 0 <= value <= 1 if key == "no_speech_prob"
                                  else value >= 0), f"Invalid segment probability/metric at {label}")
                output[key] = value
        if "words" in segment:
            if not check(isinstance(segment["words"], list), f"Invalid words array at {label}"):
                continue
            words, word_previous_start, word_previous_end = [], 0, 0
            for word_index, word in enumerate(segment["words"]):
                word_count += 1
                word_label = f"{label} word index {word_index}"
                word_span = checked_times(word, word_label)
                if not isinstance(word, dict):
                    continue
                check(isinstance(word.get("word"), str) and word["word"].strip(), f"Empty word text at {word_label}")
                item = {"word": word.get("word")}
                if word_span is not None:
                    ws, we = word_span
                    raw_ws, raw_we = word["start"], word["end"]
                    check(raw_ws >= word_previous_start, f"Misordered word starts at {word_label}")
                    if valid_id and raw_ws < word_previous_end:
                        warn("word_overlap", ident, min(word_previous_end, raw_we) - raw_ws)
                    word_previous_start, word_previous_end = raw_ws, max(word_previous_end, raw_we)
                    if span is not None and valid_id:
                        offset = max(segment["start"] - raw_ws, raw_we - segment["end"])
                        if offset > 0:
                            warn("word_outside_segment", ident, offset)
                    item.update({"start": ws, "end": we})
                    zero_words += ws == we
                if "probability" in word:
                    try:
                        probability = number(word["probability"], "word probability")
                        require(probability <= 1, "Invalid word probability")
                        item["probability"] = probability
                    except Error:
                        issues.append(f"Invalid word probability at {word_label}")
                words.append(item)
            output["words"] = words
        result.append(output)
    backward_warnings = [w for w in warnings.values() if w["kind"] == "nonmonotonic_segment_start"]
    alignment = {"alignment_warnings": list(warnings.values()),
                 "alignment_warning_count": sum(w["count"] for w in warnings.values()),
                 "alignment_warning_segment_count": len({w["segment_id"] for w in warnings.values()}),
                 "alignment_max_offset_seconds": max((w["max_offset_seconds"] for w in warnings.values()), default=0),
                 "nonmonotonic_segment_start_count": len(backward_warnings),
                 "max_backward_jump_seconds": max((w["backward_seconds"] for w in backward_warnings), default=0)}
    verification = {"tail_clamped_timestamp_count": clamp_count,
                    "zero_duration_segment_count": zero_segments, "zero_duration_word_count": zero_words,
                    "original_language": language, "non_english": language != "en",
                    "timing_scan_complete": True, "segment_count": len(segments), "word_count": word_count,
                    **alignment}
    if issues:
        raise TimingError(issues, verification)
    return result, verification


def alignment_summary(verification):
    return {key: verification[key] for key in ("alignment_warnings", "alignment_warning_count",
            "alignment_warning_segment_count", "alignment_max_offset_seconds",
            "nonmonotonic_segment_start_count", "max_backward_jump_seconds")}


def evidence_text(segments, verification):
    backtracks = {w["current_segment_id"]: w for w in verification["alignment_warnings"]
                  if w["kind"] == "nonmonotonic_segment_start"}
    lines = []
    for item in segments:
        warning = backtracks.get(item["id"])
        if warning:
            lines.append(f"[ASR alignment warning: segment {warning['current_segment_id']} starts "
                         f"{warning['backward_seconds']:g}s before preceding segment {warning['previous_segment_id']}; "
                         "source order retained; curator review of this region required before publishing.]\n")
        lines.append(f"[{media.timestamp(item['start'])} --> {media.timestamp(item['end'])}] {item['text']}\n")
    return "".join(lines).encode("utf-8")


def load_transcript(path, checksum_path):
    path = Path(path)
    entries = checksums(checksum_path)
    raw = read_regular(path)
    sha = digest(raw)
    require(entries.get(path.name) == sha, "Transcript SHA-256 missing or mismatched")
    payload = parse_json(raw)
    segments, verification = validate(payload, path.name)
    return payload, sha, segments, verification


def verify_bundle(bundle_dir):
    root = Path(bundle_dir)
    entries = checksums(root / "SHA256SUMS")
    require({p.name for p in root.glob("*.json")} == set(entries), "Bundle JSON inventory differs from SHA256SUMS")
    summaries = []
    failures = []
    verified_checksums = 0
    for filename in sorted(entries):
        try:
            raw = read_regular(root / filename)
            sha = digest(raw)
            require(sha == entries[filename], "Transcript SHA-256 missing or mismatched")
            verified_checksums += 1
            payload = parse_json(raw)
            segments, verification = validate(payload, filename)
        except TimingError as error:
            failures.append({"youtube_id": filename[:-5], "error": "Invalid transcript timing/segments",
                             "issues": error.issues, **error.verification})
            continue
        except Error as error:
            failures.append({"youtube_id": filename[:-5], "error": str(error)})
            continue
        except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, RecursionError):
            failures.append({"youtube_id": filename[:-5], "error": "Invalid JSON or unreadable transcript"})
            continue
        summaries.append({"youtube_id": payload["video_id"], "transcript_sha256": sha,
                          **{key: payload[key] for key in ("duration_seconds", "elapsed_seconds",
                                                          "real_time_factor", "transcribed_at")},
                          **verification})
    return {"verified_checksums": verified_checksums,
            "verified_transcripts": len(summaries), "invalid_transcripts": len(failures),
            "audio_hash_verified": False, "source_duration_verified": False,
            "transcripts": summaries, "failures": failures}


def source_check(root, payload):
    manifest = media.manifest_for(root, payload["video_id"])
    source = number(manifest.get("duration_seconds"), "ffprobe source duration", positive=True)
    recording = number(manifest.get("recording_duration_seconds"), "recording metadata duration", positive=True)
    start = number(manifest["acquired_span"].get("start"), "acquired start")
    end = number(manifest["acquired_span"].get("end"), "acquired end", positive=True)
    require(start == 0 and abs(end - recording) <= DURATION_TOLERANCE
            and abs(end - source) <= DURATION_TOLERANCE, "Full-recording acquisition required")
    delta = payload["duration_seconds"] - source
    require(abs(delta) <= DURATION_TOLERANCE and abs(source - recording) <= DURATION_TOLERANCE,
            "Transcript/source/recording duration mismatch (maximum 2 seconds)")
    return source, {"source_duration_seconds": source, "duration_delta_seconds": delta,
                    "recording_metadata_duration_seconds": recording,
                    "source_minus_recording_metadata_seconds": source - recording,
                    "duration_tolerance_seconds": DURATION_TOLERANCE,
                    "duration_comparison_basis": "manifest.duration_seconds (acquisition ffprobe)",
                    "recording_metadata_may_be_integer_floor": True}


def audio_root(path):
    raw = Path(path).expanduser().absolute()
    require(not any(p.is_symlink() for p in (raw, *raw.parents)), "Audio root symlinks are not allowed")
    root = media.external_path(raw)
    require(root.is_dir() and root.stat().st_uid == os.getuid(), "Existing operator-owned audio root required")
    return root


def identity(root):
    info = root.stat()
    return {"path": str(root), "device": info.st_dev, "inode": info.st_ino, "uid": info.st_uid}


def audio_hash(fd, filename):
    try:
        info = os.stat(filename, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
            "Audio must be an operator-owned regular file, not a symlink or hardlink")
    with os.fdopen(os.open(filename, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd), "rb") as handle:
        current = os.fstat(handle.fileno())
        require((info.st_dev, info.st_ino) == (current.st_dev, current.st_ino), "Audio changed during verification")
        value = hashlib.file_digest(handle, "sha256").hexdigest()
        after = os.fstat(handle.fileno())
        require((current.st_size, current.st_mtime_ns, current.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "Audio changed during verification")
    return value, (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def verify_audio(roots, filename, expected):
    records = []
    for root in roots:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            result = audio_hash(fd, filename)
            require(result is None or result[0] == expected, "Audio SHA-256 mismatch")
            records.append({**identity(root), "hash_verified": result is not None})
        finally:
            os.close(fd)
    return records


def archive_provenance(payload, verification, audio_verified):
    engine = payload["engine"]
    return {"engine": engine["name"], "engine_version": engine["version"], "model": engine["model"],
            "backend_version": engine["ctranslate2"], "compute_type": engine["compute_type"],
            "device": engine["device"], "settings": engine["options"],
            **{key: payload[key] for key in ("audio_sha256", "duration_seconds", "elapsed_seconds",
                                           "real_time_factor", "transcribed_at")},
            **{key: verification[key] for key in ("transcript_sha256", "source_duration_seconds", "duration_delta_seconds")},
            "audio_hash_verified": audio_verified}


def receipt_for(root):
    receipt = parse_json(read_regular(root / RECEIPT))
    require(isinstance(receipt, dict) and receipt.get("kind") == KIND and receipt.get("schema_version") == 1
            and receipt.get("verified") is True, "Verified import receipt required")
    marker = media.read_json(root / media.SENTINEL)
    require(receipt.get("workdir_token") == marker["token"], "Import receipt belongs to a different workspace")
    require(re.fullmatch(ID, str(receipt.get("youtube_id", ""))) and
            receipt.get("audio_file") == receipt["youtube_id"] + ".webm", "Invalid receipt source filename/ID")
    for key in ("audio_sha256", "transcript_sha256"):
        require(re.fullmatch(SHA, str(receipt.get(key, ""))), "Invalid receipt hash")
    evidence_hashes = receipt.get("evidence_sha256")
    require(isinstance(evidence_hashes, dict) and set(evidence_hashes) == {"evidence.json", "evidence.txt"},
            "Import evidence hashes required")
    for name, expected in evidence_hashes.items():
        require(digest(read_regular(root / name)) == expected, "Imported evidence changed or incomplete")
    evidence = parse_json(read_regular(root / "evidence.json"))
    require(evidence.get("import_kind") == KIND and evidence.get("youtube_id") == receipt["youtube_id"]
            and evidence.get("provenance") == receipt.get("provenance")
            and evidence.get("import_verification") == receipt.get("import_verification"), "Receipt/evidence mismatch")
    provenance = receipt["provenance"]
    require(provenance["audio_sha256"] == receipt["audio_sha256"]
            and provenance["transcript_sha256"] == receipt["transcript_sha256"], "Receipt provenance hash mismatch")
    # Revalidate the safe projection, source binding and timing before permitting deletion/reuse.
    payload = {**provenance, "video_id": receipt["youtube_id"], "audio_file": receipt["audio_file"],
               "language": evidence["language"], "segments": evidence["segments"]}
    source, duration_check = source_check(root, payload)
    require(all(receipt["import_verification"].get(key) == value for key, value in duration_check.items()),
            "Source duration metadata changed since import")
    require(receipt["import_verification"].get("transcript_sha256") == receipt["transcript_sha256"],
            "Receipt verification hash mismatch")
    validate(payload, receipt["youtube_id"] + ".json", source)
    projection = archive_provenance(payload, receipt["import_verification"], receipt.get("audio_hash_verified"))
    require(receipt.get("archive_provenance") == projection and type(receipt.get("audio_hash_verified")) is bool,
            "Invalid receipt archive projection")
    return receipt


def import_evidence(transcript, checksum_path, work_dir, authorization_file, audio_roots, allow_missing_audio=False):
    require(authorization_file is not None, "Explicit authorization file required")
    media.authorize(authorization_file)
    root = media.owned_workdir(work_dir)
    payload, sha, _, _ = load_transcript(transcript, checksum_path)
    source, duration_check = source_check(root, payload)
    segments, verification = validate(payload, Path(transcript).name, source)
    roots = list(dict.fromkeys(audio_root(path) for path in audio_roots))
    require(bool(roots), "At least one explicit audio root required")
    records = verify_audio(roots, payload["audio_file"], payload["audio_sha256"])
    count = sum(record["hash_verified"] for record in records)
    require(count > 0 or allow_missing_audio, "No audio copy verified; explicit --allow-missing-audio required")
    existing = any((root / name).exists() for name in (RECEIPT, "evidence.json", "evidence.txt"))
    if existing:
        require((root / RECEIPT).is_file(), "Existing evidence is not an owned import; refusing to overwrite")
        receipt = receipt_for(root)
        require(receipt["transcript_sha256"] == sha, "Existing import has a different transcript hash")
        require(receipt["audio_roots"] == records, "Repeat import requires the same roots and verification state")
        require(receipt["import_verification"]["source_duration_seconds"] == source,
                "Source duration changed since import")
        return {"imported": True, "idempotent": True, "youtube_id": payload["video_id"],
                "verified_audio_copies": count, "archive_provenance": receipt["archive_provenance"],
                **alignment_summary(receipt["import_verification"])}
    verification.update(duration_check)
    verification.update({"transcript_sha256": sha, "transcript_hash_verified": True,
                         "source_channel_verified": True, "source_video_id_verified": True,
                         "audio_hash_verified": count > 0, "verified_audio_copies": count,
                         "tail_tolerance_seconds": TAIL_TOLERANCE,
                         "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    provenance = {key: payload[key] for key in ("engine", "audio_sha256", "duration_seconds", "elapsed_seconds",
                                               "real_time_factor", "transcribed_at")}
    provenance["transcript_sha256"] = sha
    evidence = {"schema_version": 1, "import_kind": KIND, "youtube_id": payload["video_id"],
                "language": payload["language"], "timestamp_basis": "absolute recording seconds",
                "transcribed_span": {"start": 0, "end": min(source, payload["duration_seconds"])},
                "elapsed_seconds": payload["elapsed_seconds"], "real_time_factor": payload["real_time_factor"],
                "segments": segments, "provenance": provenance, "import_verification": verification,
                "status": "machine transcription evidence; not editorially reviewed", "editorial_status": "needs_review"}
    outputs = {"evidence.json": encoded(evidence), "evidence.txt": evidence_text(segments, verification)}
    receipt = {"schema_version": 1, "kind": KIND, "verified": True,
               "workdir_token": media.read_json(root / media.SENTINEL)["token"],
               "youtube_id": payload["video_id"], "audio_file": payload["audio_file"],
               "audio_sha256": payload["audio_sha256"], "transcript_sha256": sha,
               "audio_hash_verified": count > 0, "audio_roots": records,
               "provenance": provenance, "import_verification": verification,
               "archive_provenance": archive_provenance(payload, verification, count > 0),
               "evidence_sha256": {name: digest(raw) for name, raw in outputs.items()}}
    outputs[RECEIPT] = encoded(receipt)  # Receipt last: partial writes never authorize cleanup.
    created = []
    try:
        for name, raw in outputs.items():
            fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(root / name)
            with os.fdopen(fd, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
        receipt_for(root)
    except BaseException:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise
    return {"imported": True, "idempotent": False, "youtube_id": payload["video_id"],
            "verified_audio_copies": count, "archive_provenance": receipt["archive_provenance"],
            **alignment_summary(verification)}


def cleanup_audio(work_dir, audio_roots):
    root = media.owned_workdir(work_dir)
    receipt = receipt_for(root)
    require(receipt["audio_hash_verified"] is True, "Cleanup requires an audio-hash-verified import")
    roots = list(dict.fromkeys(audio_root(path) for path in audio_roots))
    require(bool(roots), "Explicit audio roots required")
    filename, expected = receipt["audio_file"], receipt["audio_sha256"]
    pending, missing = [], 0
    with contextlib.ExitStack() as stack:
        for directory in roots:
            current = identity(directory)
            require(any(all(record.get(key) == value for key, value in current.items())
                        for record in receipt["audio_roots"]), "Audio root was not authorized by this import")
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            stack.callback(os.close, fd)
            result = audio_hash(fd, filename)
            if result is None:
                missing += 1
            else:
                require(result[0] == expected, "Cleanup audio SHA-256 mismatch; no files deleted")
                pending.append((fd, result))
        # Preflight ALL supplied copies before unlinking ANY; a changed second copy preserves the first.
        for fd, original in pending:
            require(audio_hash(fd, filename) == original, "Audio changed during cleanup; no files deleted")
        for fd, original in pending:
            info = os.stat(filename, dir_fd=fd, follow_symlinks=False)
            require((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) == original[1],
                    "Audio changed immediately before unlink")
            os.unlink(filename, dir_fd=fd)
    return {"deleted_audio_files": len(pending), "already_absent_audio_files": missing,
            "checked_audio_roots": len(roots)}


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    sub = cli.add_subparsers(dest="command", required=True)
    verify = sub.add_parser("verify-bundle")
    verify.add_argument("--bundle-dir", type=Path, required=True)
    importer = sub.add_parser("import")
    importer.add_argument("--transcript", type=Path, required=True)
    importer.add_argument("--checksums", type=Path, required=True)
    importer.add_argument("--authorization-file", type=Path, required=True)
    importer.add_argument("--allow-missing-audio", action="store_true",
                          help="Explicit exception: receipt records audio_hash_verified=false; cleanup prohibited")
    cleaner = sub.add_parser("cleanup-audio")
    for child in (importer, cleaner):
        child.add_argument("--work-dir", type=Path, required=True)
        child.add_argument("--audio-root", type=Path, action="append", required=True)
    return cli


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) > 1 and argv[1] == "--":
        del argv[1]
    args = parser().parse_args(argv)
    try:
        if args.command == "verify-bundle":
            result = verify_bundle(args.bundle_dir)
        elif args.command == "import":
            result = import_evidence(args.transcript, args.checksums, args.work_dir, args.authorization_file,
                                     args.audio_root, args.allow_missing_audio)
        else:
            result = cleanup_audio(args.work_dir, args.audio_root)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 2 if result.get("invalid_transcripts", 0) else 0
    except Error as error:
        print(f"transcript-import: {error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, RecursionError,
            argparse.ArgumentTypeError):
        print("transcript-import: invalid input or filesystem operation; private details suppressed", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
