"""Offline import integrity tests, using invented text and tiny synthetic audio bytes only."""

import contextlib
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import import_transcript as importer
from scripts import media


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="recs-import-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.work = media.owned_workdir(self.base / "work", create=True)
        self.bundle = self.base / "bundle"
        self.bundle.mkdir()
        self.roots = [self.base / "audio-a", self.base / "audio-b"]
        for root in self.roots:
            root.mkdir()
            (root / "AAAAAAAAAAA.webm").write_bytes(b"invented opus fixture")
        self.authorization = self.base / "authorization.json"
        media.write_json(self.authorization, {
            "authorized": True, "channel_id": media.CHANNEL,
            "source": "explicit-current-conversation-permission", "recorded_at": "2026-09-25",
            "scope": "Synthetic test import", "operator_statement": "Test authorization",
            "operator_confirmed_local_record": True})
        self.manifest = {"schema_version": 1, "youtube_id": "AAAAAAAAAAA", "channel_id": media.CHANNEL,
                         "source_file": "source.mkv", "duration_seconds": 120.06,
                         "recording_duration_seconds": 120,
                         "acquired_span": {"start": 0, "end": 120}}
        (self.work / "source.mkv").write_bytes(b"invented acquired media")
        self.save_manifest()
        self.payload = {"video_id": "AAAAAAAAAAA", "audio_file": "AAAAAAAAAAA.webm",
                        "audio_sha256": importer.digest(b"invented opus fixture"), "duration_seconds": 120.04,
                        "language": "en", "engine": copy.deepcopy(importer.ENGINE), "elapsed_seconds": 6,
                        "real_time_factor": round(6 / 120.04, 5), "transcribed_at": "2026-09-25T11:00:00.123456+00:00",
                        "segments": [
                            {"id": 1, "start": 0, "end": 1, "text": "Invented test.",
                             "words": [{"start": 0, "end": 1, "word": " Invented", "probability": 0.9}]},
                            {"id": 2, "start": 90, "end": 120.04, "text": "Synthetic ending.",
                             "words": [{"start": 90, "end": 120.04, "word": " ending.", "probability": 1}]}]}
        self.transcript = self.bundle / "AAAAAAAAAAA.json"
        self.checksums = self.bundle / "SHA256SUMS"
        self.write_bundle()
        self.native = patch.object(media, "command", side_effect=AssertionError("No native tools in import tests"))
        self.native.start()
        self.addCleanup(self.native.stop)

    def write_bundle(self):
        raw = importer.encoded(self.payload)
        self.transcript.write_bytes(raw)
        self.checksums.write_text(importer.digest(raw) + "  " + self.transcript.name + "\n")

    def save_manifest(self):
        media.write_json(self.work / "manifest.json", self.manifest)

    def run_import(self, **kwargs):
        return importer.import_evidence(self.transcript, self.checksums, self.work, self.authorization,
                                        kwargs.pop("audio_roots", self.roots), **kwargs)

    def receipt(self):
        return media.read_json(self.work / importer.RECEIPT)

    def evidence(self):
        return media.read_json(self.work / "evidence.json")

    def invalid(self, payload):
        with self.assertRaises(media.MediaError):
            importer.validate(payload, "AAAAAAAAAAA.json")

    def test_import_canonical_evidence_preserves_gaps_words_engine_and_raw_inputs(self):
        before = {p: p.read_bytes() for p in (self.transcript, self.checksums, self.work / "manifest.json")}
        result = self.run_import()
        self.assertEqual(result["verified_audio_copies"], 2)
        evidence = self.evidence()
        self.assertEqual(evidence["segments"], self.payload["segments"])
        self.assertEqual(evidence["timestamp_basis"], "absolute recording seconds")
        self.assertEqual(evidence["editorial_status"], "needs_review")
        self.assertEqual(evidence["provenance"]["engine"], self.payload["engine"])
        self.assertEqual(evidence["import_verification"]["duration_tolerance_seconds"], 2)
        self.assertAlmostEqual(evidence["import_verification"]["duration_delta_seconds"], -0.02)
        self.assertAlmostEqual(evidence["import_verification"]["source_minus_recording_metadata_seconds"], 0.06)
        self.assertEqual(len((self.work / "evidence.txt").read_text().splitlines()), 2)
        for path, raw in before.items():
            self.assertEqual(path.read_bytes(), raw)
        for name in ("evidence.json", "evidence.txt", importer.RECEIPT):
            self.assertEqual((self.work / name).stat().st_mode & 0o777, 0o600)
        projection = self.receipt()["archive_provenance"]
        self.assertEqual(projection, result["archive_provenance"])
        self.assertNotIn(str(self.base), json.dumps(result))

    def test_verify_bundle_checks_inventory_and_checksums_without_import(self):
        report = importer.verify_bundle(self.bundle)
        self.assertEqual(report["verified_transcripts"], 1)
        self.assertFalse(report["audio_hash_verified"])
        self.assertFalse((self.work / importer.RECEIPT).exists())
        self.transcript.write_bytes(self.transcript.read_bytes() + b" ")
        self.assertIn("SHA-256", importer.verify_bundle(self.bundle)["failures"][0]["error"])
        (self.bundle / "BBBBBBBBBBB.json").write_text("{}")
        with self.assertRaisesRegex(media.MediaError, "inventory"):
            importer.verify_bundle(self.bundle)

    def test_strict_checksum_lines_and_duplicate_names(self):
        good = self.checksums.read_text()
        for value in ("", good + good, good.replace("AAAAAAAAAAA.json", "../AAAAAAAAAAA.json"),
                      good.replace("AAAAAAAAAAA.json", "/AAAAAAAAAAA.json"), good + "\n", "bad\n"):
            with self.subTest(value=value), self.assertRaises(media.MediaError):
                self.checksums.write_text(value)
                importer.checksums(self.checksums)

    def test_duplicate_json_keys_nonfinite_constants_and_symlink_inputs(self):
        for raw in (b'{"id":1,"id":2}', b'{"value":NaN}', b'{"value":Infinity}'):
            with self.assertRaises(media.MediaError):
                importer.parse_json(raw)
        copy_path = self.bundle / "copy"
        self.transcript.rename(copy_path)
        self.transcript.symlink_to(copy_path)
        with self.assertRaises(media.MediaError):
            self.run_import()

    def test_source_filename_and_video_id_mixups(self):
        for key, value in (("video_id", "BBBBBBBBBBB"), ("video_id", "../secret"),
                           ("audio_file", "BBBBBBBBBBB.webm"), ("audio_file", "../AAAAAAAAAAA.webm"),
                           ("audio_file", "/AAAAAAAAAAA.webm"), ("audio_file", "AAAAAAAAAAA.opus")):
            payload = copy.deepcopy(self.payload)
            payload[key] = value
            self.invalid(payload)
        self.transcript = self.bundle / "BBBBBBBBBBB.json"
        self.write_bundle()
        with self.assertRaisesRegex(media.MediaError, "filename/video ID"):
            self.run_import()

    def test_exact_engine_and_settings_including_json_boolean_types(self):
        for key, value in (("name", "whisper.cpp"), ("version", "1.2.0"), ("ctranslate2", "4.8.1"),
                           ("model", "large-v3"), ("compute_type", "int8"), ("device", "CPU"), ("extra", True)):
            payload = copy.deepcopy(self.payload)
            payload["engine"][key] = value
            self.invalid(payload)
        for key, value in (("beam_size", 1), ("word_timestamps", 1), ("vad_filter", 0),
                           ("condition_on_previous_text", True), ("translate", False)):
            payload = copy.deepcopy(self.payload)
            payload["engine"]["options"][key] = value
            self.invalid(payload)

    def test_positive_finite_consistent_duration_elapsed_and_rtf(self):
        for key in ("duration_seconds", "elapsed_seconds", "real_time_factor"):
            for value in (0, -1, float("nan"), float("inf"), 10 ** 400, True, "120"):
                payload = copy.deepcopy(self.payload)
                payload[key] = value
                self.invalid(payload)
        payload = copy.deepcopy(self.payload)
        payload["real_time_factor"] = 0.06
        self.invalid(payload)
        for date in ("yesterday", "2026-02-30T00:00:00Z", "2026-09-25T00:00:00"):
            payload = copy.deepcopy(self.payload)
            payload["transcribed_at"] = date
            self.invalid(payload)

    def test_non_english_is_preserved_and_explicitly_recorded(self):
        self.payload["language"] = "fr"
        self.write_bundle()
        self.run_import()
        self.assertEqual(self.evidence()["language"], "fr")
        self.assertTrue(self.receipt()["import_verification"]["non_english"])
        self.assertEqual(self.evidence()["segments"], self.payload["segments"])

    def test_segment_bounds_order_unique_ids_and_nonempty_text(self):
        mutations = [("start", -1), ("end", 121), ("start", 121), ("start", "0"),
                     ("end", float("inf")), ("id", True), ("id", 1), ("text", "  ")]
        for key, value in mutations:
            payload = copy.deepcopy(self.payload)
            payload["segments"][1][key] = value
            self.invalid(payload)
        payload = copy.deepcopy(self.payload)
        payload["segments"].reverse()
        segments, verification = importer.validate(payload, self.transcript.name)
        self.assertEqual(segments, payload["segments"])
        self.assertEqual(verification["nonmonotonic_segment_start_count"], 1)
        self.assertEqual(verification["max_backward_jump_seconds"], 90)

    def test_words_bounds_order_empty_text_and_probability(self):
        for key, value in (("start", -0.01), ("end", 121), ("start", 121), ("word", " "),
                           ("start", float("nan")), ("end", float("inf")),
                           ("probability", 1.01), ("probability", -0.01), ("probability", True)):
            payload = copy.deepcopy(self.payload)
            payload["segments"][1]["words"][0][key] = value
            self.invalid(payload)
        payload = copy.deepcopy(self.payload)
        payload["segments"][1]["words"] = [
            {"start": 100, "end": 110, "word": "invented"},
            {"start": 99, "end": 100, "word": "test"}]
        self.invalid(payload)

    def test_observed_bundle_word_before_segment_warns_without_repair(self):
        for delta in (0.02, 0.04, 0.06, 0.08, 0.1, 0.3):
            payload = copy.deepcopy(self.payload)
            payload["segments"][1]["words"][0]["start"] -= delta
            segments, verification = importer.validate(payload, self.transcript.name)
            self.assertEqual(segments, payload["segments"])
            self.assertEqual(verification["alignment_warnings"], [{
                "kind": "word_outside_segment", "segment_id": 2, "count": 1, "max_offset_seconds": delta}])
            self.assertEqual(verification["tail_clamped_timestamp_count"], 0)

    def test_source_format_point_three_alignment_is_preserved_in_import_and_receipt(self):
        # Timing-only excerpt from supplied GkmB_KeBlBw segment 32; text is invented.
        self.payload["segments"] = [{"id": 32, "start": 376.9, "end": 378.26,
                                     "text": "Synthetic alignment example.",
                                     "words": [{"start": 376.6, "end": 376.98,
                                                "word": " Synthetic", "probability": 0.9}]}]
        self.payload["duration_seconds"] = 400.04
        self.payload["real_time_factor"] = round(6 / 400.04, 5)
        self.manifest.update({"duration_seconds": 400.06, "recording_duration_seconds": 400,
                              "acquired_span": {"start": 0, "end": 400}})
        self.save_manifest()
        self.write_bundle()
        raw = self.transcript.read_bytes()
        result = self.run_import()
        self.assertEqual(self.evidence()["segments"], self.payload["segments"])
        self.assertEqual(self.evidence()["editorial_status"], "needs_review")
        verification = self.receipt()["import_verification"]
        self.assertEqual(verification["alignment_warning_count"], 1)
        self.assertEqual(verification["alignment_warning_segment_count"], 1)
        self.assertEqual(verification["alignment_max_offset_seconds"], 0.3)
        self.assertEqual(result["alignment_warnings"], [{"kind": "word_outside_segment", "segment_id": 32,
                                                       "count": 1, "max_offset_seconds": 0.3}])
        self.assertEqual(self.evidence()["import_verification"], verification)
        self.assertEqual(self.run_import()["alignment_warnings"], result["alignment_warnings"])
        self.assertEqual(self.transcript.read_bytes(), raw)
        self.assertNotIn("Synthetic", json.dumps(result))

    def test_internal_word_end_after_segment_and_both_boundaries_are_preserved(self):
        self.payload["segments"][1]["end"] = 100
        self.payload["segments"][1]["words"][0].update({"start": 89.7, "end": 100.4})
        segments, verification = importer.validate(self.payload, self.transcript.name)
        self.assertEqual(segments, self.payload["segments"])
        self.assertEqual(verification["alignment_warning_count"], 1)  # One word, not two endpoints.
        self.assertEqual(verification["alignment_max_offset_seconds"], 0.4)
        self.assertEqual(verification["tail_clamped_timestamp_count"], 0)

    def test_ordered_segment_and_word_overlaps_warn_without_reordering(self):
        self.payload["segments"][0]["end"] = 95
        self.payload["segments"][1]["words"] = [
            {"start": 90, "end": 110, "word": " Synthetic"},
            {"start": 109, "end": 120.04, "word": " ending."}]
        segments, verification = importer.validate(self.payload, self.transcript.name)
        self.assertEqual(segments, self.payload["segments"])
        self.assertEqual(verification["alignment_warnings"], [
            {"kind": "segment_overlap", "segment_id": 2, "count": 1, "max_offset_seconds": 5},
            {"kind": "word_overlap", "segment_id": 2, "count": 1, "max_offset_seconds": 1}])
        self.payload["segments"][1]["words"].reverse()
        with self.assertRaisesRegex(importer.TimingError, "Misordered word starts"):
            importer.validate(self.payload, self.transcript.name)
        self.payload["segments"][1]["words"].reverse()
        self.payload["segments"].reverse()
        segments, verification = importer.validate(self.payload, self.transcript.name)
        self.assertEqual(segments, self.payload["segments"])
        self.assertEqual(verification["nonmonotonic_segment_start_count"], 1)

    def test_complete_scan_reports_distinct_late_blockers_together(self):
        self.payload["segments"][0]["start"] = -1
        self.payload["segments"][1]["words"][0]["end"] = 121
        self.payload["segments"][1]["words"].append({"start": 99, "end": 98, "word": " Synthetic"})
        self.write_bundle()
        failure = importer.verify_bundle(self.bundle)["failures"][0]
        self.assertTrue(failure["timing_scan_complete"])
        self.assertEqual(failure["segment_count"], 2)
        self.assertEqual(failure["word_count"], 3)
        self.assertEqual(len(failure["issues"]), 3)
        self.assertIn("Invalid numeric", failure["issues"][0])
        self.assertIn("Out-of-bounds", failure["issues"][1])
        self.assertIn("Reversed", failure["issues"][2])

    def test_supplied_backward_segment_starts_import_in_source_order_with_review_diagnostic(self):
        # Source timings from GkmB_KeBlBw IDs 974-976, with invented text only.
        self.payload["segments"] = [
            {"id": 974, "start": 4543.58, "end": 4543.86, "text": "Synthetic first.", "words": []},
            {"id": 975, "start": 4540.76, "end": 4542.12, "text": "Synthetic second.", "words": []},
            {"id": 976, "start": 4542.12, "end": 4543.9, "text": "Synthetic third.", "words": []}]
        self.payload["duration_seconds"] = 4600
        self.payload["real_time_factor"] = round(6 / 4600, 5)
        self.manifest.update({"duration_seconds": 4600, "recording_duration_seconds": 4600,
                              "acquired_span": {"start": 0, "end": 4600}})
        self.save_manifest()
        self.write_bundle()
        original = self.transcript.read_bytes()
        result = self.run_import()
        verification = self.receipt()["import_verification"]
        self.assertTrue(verification["timing_scan_complete"])
        self.assertEqual(verification["segment_count"], 3)
        self.assertEqual(verification["nonmonotonic_segment_start_count"], 1)
        self.assertEqual(verification["max_backward_jump_seconds"], 2.82)
        self.assertEqual(result["max_backward_jump_seconds"], 2.82)
        self.assertEqual(self.evidence()["import_verification"], verification)
        self.assertEqual(self.evidence()["segments"], self.payload["segments"])
        self.assertEqual(self.evidence()["editorial_status"], "needs_review")
        backtracks = [w for w in result["alignment_warnings"] if w["kind"] == "nonmonotonic_segment_start"]
        self.assertEqual(backtracks, [{"kind": "nonmonotonic_segment_start", "segment_id": 975,
                                      "count": 1, "max_offset_seconds": 2.82,
                                      "previous_segment_id": 974, "current_segment_id": 975,
                                      "backward_seconds": 2.82, "requires_curator_review_before_publishing": True}])
        text = (self.work / "evidence.txt").read_text()
        self.assertLess(text.index("Synthetic first."), text.index("ASR alignment warning"))
        self.assertLess(text.index("ASR alignment warning"), text.index("Synthetic second."))
        self.assertLess(text.index("Synthetic second."), text.index("Synthetic third."))
        self.assertIn("segment 975 starts 2.82s before preceding segment 974", text)
        self.assertIn("curator review of this region required before publishing", text)
        self.assertNotIn(str(self.base), text)
        self.assertEqual(self.run_import()["max_backward_jump_seconds"], 2.82)
        self.assertEqual(importer.verify_bundle(self.bundle)["verified_transcripts"], 1)
        self.assertEqual(self.transcript.read_bytes(), original)

    def test_alignment_warning_counts_span_all_segments_and_metadata_in_cli(self):
        self.payload["segments"][0]["end"] = 0.5
        self.payload["segments"][1]["words"][0]["start"] = 89.7
        self.write_bundle()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(importer.main(["verify-bundle", "--bundle-dir", str(self.bundle)]), 0)
        summary = json.loads(out.getvalue())["transcripts"][0]
        self.assertTrue(summary["timing_scan_complete"])
        self.assertEqual(summary["alignment_warning_count"], 2)
        self.assertEqual(summary["alignment_warning_segment_count"], 2)
        self.assertEqual(summary["alignment_max_offset_seconds"], 0.5)
        self.assertEqual(summary["word_count"], 2)
        self.assertNotIn("Invented", out.getvalue())

    def test_zero_duration_words_preserved_and_optional_words_probabilities(self):
        word = self.payload["segments"][0]["words"][0]
        word["end"] = word["start"]
        del word["probability"]
        del self.payload["segments"][1]["words"]
        self.write_bundle()
        self.run_import()
        self.assertEqual(self.evidence()["segments"], self.payload["segments"])
        self.assertEqual(self.receipt()["import_verification"]["zero_duration_word_count"], 1)

    def test_tail_overshoot_only_up_to_point_one_counted_without_changing_raw(self):
        segment = self.payload["segments"][-1]
        segment["end"] += 0.1
        segment["words"][0]["end"] += 0.1
        self.write_bundle()
        before = self.transcript.read_bytes()
        self.run_import()
        self.assertEqual(self.receipt()["import_verification"]["tail_clamped_timestamp_count"], 2)
        self.assertEqual(self.evidence()["segments"][-1]["end"], self.payload["duration_seconds"])
        self.assertEqual(self.transcript.read_bytes(), before)
        segment["end"] += 0.001
        self.invalid(self.payload)

    def test_ffprobe_duration_not_metadata_floor_controls_bounds(self):
        self.manifest["duration_seconds"] = 119.98
        self.save_manifest()
        self.run_import()
        self.assertEqual(self.evidence()["segments"][-1]["end"], 119.98)
        self.assertEqual(self.receipt()["import_verification"]["tail_clamped_timestamp_count"], 2)

    def test_duration_mismatch_and_partial_acquisition_rejected(self):
        original = copy.deepcopy(self.manifest)
        for changes in ({"duration_seconds": 117}, {"recording_duration_seconds": 117},
                        {"duration_seconds": 119.9}, {"acquired_span": {"start": 1, "end": 120}},
                        {"acquired_span": {"start": 0, "end": 60}}, {"duration_seconds": True}):
            with self.subTest(changes=changes), self.assertRaises(media.MediaError):
                self.manifest = {**original, **changes}
                self.save_manifest()
                self.run_import()
            self.assertFalse((self.work / "evidence.json").exists())

    def test_manifest_channel_id_and_source_filename_are_checked(self):
        original = copy.deepcopy(self.manifest)
        for key, value in (("channel_id", "foreign"), ("youtube_id", "BBBBBBBBBBB"),
                           ("source_file", "../source.mkv")):
            self.manifest = {**original, key: value}
            self.save_manifest()
            with self.assertRaises(media.MediaError):
                self.run_import()

    def test_authorization_and_owned_workdir_required(self):
        with self.assertRaises(media.MediaError):
            importer.import_evidence(self.transcript, self.checksums, self.work, None, self.roots)
        media.write_json(self.authorization, {"authorized": False})
        with self.assertRaises(media.MediaError):
            self.run_import()
        (self.work / media.SENTINEL).unlink()
        with self.assertRaises(media.MediaError):
            importer.cleanup_audio(self.work, self.roots)

    def test_audio_hash_verified_in_each_present_root_one_absent_allowed(self):
        (self.roots[0] / "AAAAAAAAAAA.webm").unlink()
        result = self.run_import()
        self.assertEqual(result["verified_audio_copies"], 1)
        self.assertTrue(self.receipt()["audio_hash_verified"])
        self.assertEqual([r["hash_verified"] for r in self.receipt()["audio_roots"]], [False, True])

    def test_missing_audio_requires_explicit_exception_and_prohibits_cleanup(self):
        for root in self.roots:
            (root / "AAAAAAAAAAA.webm").unlink()
        with self.assertRaisesRegex(media.MediaError, "No audio copy"):
            self.run_import()
        self.run_import(allow_missing_audio=True)
        self.assertFalse(self.receipt()["audio_hash_verified"])
        self.assertFalse(self.receipt()["archive_provenance"]["audio_hash_verified"])
        with self.assertRaisesRegex(media.MediaError, "audio-hash-verified"):
            importer.cleanup_audio(self.work, self.roots)

    def test_audio_hash_mismatch_in_second_root_rejects_import(self):
        (self.roots[1] / "AAAAAAAAAAA.webm").write_bytes(b"wrong copy")
        with self.assertRaisesRegex(media.MediaError, "SHA-256"):
            self.run_import()
        self.assertFalse((self.work / "evidence.json").exists())

    def test_dangerous_roots_missing_roots_and_symlink_ancestors_rejected(self):
        alias = self.base / "alias"
        alias.symlink_to(self.base, target_is_directory=True)
        for root in (media.REPO, media.REPO / ".local", media.REPO.parent, Path.home(), Path("/"),
                     self.base / "missing", alias / "audio-a"):
            with self.subTest(root=root), self.assertRaises(media.MediaError):
                self.run_import(audio_roots=[root])

    def test_audio_symlinks_and_hardlinks_rejected_without_touching_targets(self):
        audio = self.roots[0] / "AAAAAAAAAAA.webm"
        target = self.base / "keep.webm"
        audio.rename(target)
        audio.symlink_to(target)
        with self.assertRaises(media.MediaError):
            self.run_import()
        audio.unlink()
        os.link(target, audio)
        with self.assertRaises(media.MediaError):
            self.run_import()
        self.assertEqual(target.read_bytes(), b"invented opus fixture")

    def test_repeat_import_rechecks_inputs_and_is_byte_identical(self):
        self.run_import()
        before = {p: p.read_bytes() for p in self.work.iterdir()}
        result = self.run_import()
        self.assertTrue(result["idempotent"])
        self.assertEqual(before, {p: p.read_bytes() for p in self.work.iterdir()})
        (self.roots[1] / "AAAAAAAAAAA.webm").write_bytes(b"changed")
        with self.assertRaises(media.MediaError):
            self.run_import()

    def test_repeat_import_different_hash_or_modified_evidence_rejected(self):
        self.run_import()
        self.payload["segments"][0]["text"] = "A different synthetic text."
        self.write_bundle()
        with self.assertRaisesRegex(media.MediaError, "different transcript hash"):
            self.run_import()
        (self.work / "evidence.txt").write_text("Changed evidence")
        with self.assertRaisesRegex(media.MediaError, "evidence changed"):
            importer.cleanup_audio(self.work, self.roots)

    def test_never_overwrites_local_whisper_or_partial_evidence(self):
        for name in ("evidence.json", "evidence.txt"):
            path = self.work / name
            path.write_bytes(b"original local whisper evidence")
            with self.assertRaisesRegex(media.MediaError, "refusing to overwrite"):
                self.run_import()
            self.assertEqual(path.read_bytes(), b"original local whisper evidence")
            path.unlink()

    def test_write_failure_removes_only_outputs_created_by_this_import(self):
        original = importer.os.open
        def fail_receipt(path, *args, **kwargs):
            if str(path).endswith(importer.RECEIPT):
                raise OSError("synthetic failure")
            return original(path, *args, **kwargs)
        with patch.object(importer.os, "open", side_effect=fail_receipt), self.assertRaises(OSError):
            self.run_import()
        self.assertTrue((self.work / "source.mkv").exists())
        self.assertFalse((self.work / "evidence.json").exists())
        self.assertFalse((self.work / "evidence.txt").exists())

    def test_cleanup_requires_verified_receipt_and_refuses_other_root(self):
        with self.assertRaises(media.MediaError):
            importer.cleanup_audio(self.work, self.roots)
        self.run_import(audio_roots=[self.roots[0]])
        with self.assertRaisesRegex(media.MediaError, "not authorized"):
            importer.cleanup_audio(self.work, self.roots)
        self.assertTrue((self.roots[0] / "AAAAAAAAAAA.webm").exists())

    def test_cleanup_rehashes_both_roots_before_any_delete(self):
        self.run_import()
        for changed in (0, 1):
            with self.subTest(changed=changed):
                audio = self.roots[changed] / "AAAAAAAAAAA.webm"
                audio.write_bytes(b"changed")
                with self.assertRaisesRegex(media.MediaError, "SHA-256"):
                    importer.cleanup_audio(self.work, self.roots)
                self.assertTrue(all((root / "AAAAAAAAAAA.webm").exists() for root in self.roots))
                audio.write_bytes(b"invented opus fixture")

    def test_cleanup_exact_files_both_copies_safe_counts_and_repeat(self):
        self.run_import()
        for root in self.roots:
            (root / "BBBBBBBBBBB.webm").write_bytes(b"keep")
            (root / "nested").mkdir()
            (root / "nested" / "AAAAAAAAAAA.webm").write_bytes(b"keep")
        result = importer.cleanup_audio(self.work, self.roots)
        self.assertEqual(result, {"deleted_audio_files": 2, "already_absent_audio_files": 0, "checked_audio_roots": 2})
        self.assertNotIn(str(self.base), json.dumps(result))
        for root in self.roots:
            self.assertFalse((root / "AAAAAAAAAAA.webm").exists())
            self.assertEqual((root / "BBBBBBBBBBB.webm").read_bytes(), b"keep")
            self.assertEqual((root / "nested" / "AAAAAAAAAAA.webm").read_bytes(), b"keep")
        self.assertTrue((self.work / "source.mkv").is_file())
        self.assertEqual(importer.cleanup_audio(self.work, self.roots)["already_absent_audio_files"], 2)

    def test_cleanup_rejects_replaced_root_or_symlink_audio(self):
        self.run_import()
        first = self.roots[0]
        first.rename(self.base / "old-audio")
        first.mkdir()
        with self.assertRaisesRegex(media.MediaError, "not authorized"):
            importer.cleanup_audio(self.work, self.roots)
        first.rmdir()
        (self.base / "old-audio").rename(first)
        audio = first / "AAAAAAAAAAA.webm"
        audio.unlink()
        audio.symlink_to(self.roots[1] / audio.name)
        with self.assertRaises(media.MediaError):
            importer.cleanup_audio(self.work, self.roots)
        self.assertTrue((self.roots[1] / audio.name).is_file())

    def test_receipt_workspace_token_and_filename_mixups_fail(self):
        self.run_import()
        original = self.receipt()
        for key, value in (("workdir_token", "0" * 32), ("audio_file", "../AAAAAAAAAAA.webm"),
                           ("youtube_id", "BBBBBBBBBBB"), ("verified", False)):
            media.write_json(self.work / importer.RECEIPT, {**original, key: value})
            with self.assertRaises(media.MediaError):
                importer.cleanup_audio(self.work, self.roots)

    def test_cli_summary_only_and_invalid_bundle_exit_code(self):
        self.payload["engine"]["device"] = "CPU"
        self.write_bundle()
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = importer.main(["verify-bundle", "--bundle-dir", str(self.bundle)])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue())["invalid_transcripts"], 1)
        self.assertNotIn(str(self.base), out.getvalue() + err.getvalue())
        self.assertNotIn("Invented test", out.getvalue())


if __name__ == "__main__":
    unittest.main()
