"""Offline tooling tests. No real recordings, native media tools, or model downloads."""

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from scripts import media


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="recs-media-test-")
        self.base = Path(self.temporary.name).resolve()
        self.addCleanup(self.temporary.cleanup)
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def authorization(self, **changes):
        data = {"authorized": True, "source": "explicit-current-conversation-permission",
                "recorded_at": "2026-09-25", "channel_id": media.CHANNEL,
                "scope": "RECS implementation test", "operator_statement": "Explicit permission",
                "operator_confirmed_local_record": True}
        data.update(changes)
        path = self.base / "authorization.json"
        path.write_text(json.dumps(data))
        return path

    def workspace(self):
        return media.owned_workdir(self.base / "work", create=True)

    def manifest(self, root, start=0, end=1300):
        (root / "source.mkv").write_bytes(b"fictional test fixture")
        data = {"youtube_id": "ZTDYIJUDb0M", "channel_id": media.CHANNEL,
                "source_file": "source.mkv", "acquired_span": {"start": start, "end": end}}
        media.write_json(root / "manifest.json", data)
        return data

    def quiet_main(self, argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return media.main(argv)

    def test_authorization_absent_stops_before_tools_or_workspace_creation(self):
        with patch.object(media, "command") as command:
            self.assertEqual(self.quiet_main(["acquire", "--youtube-id", media.SMOKE,
                                              "--work-dir", str(self.base / "work")]), 2)
        command.assert_not_called()
        self.assertFalse((self.base / "work").exists())

    def test_pnpm_separator_reaches_authorization_check(self):
        with patch.object(media, "authorize", side_effect=media.MediaError("permission missing")) as authorize:
            self.assertEqual(self.quiet_main(["acquire", "--", "--youtube-id", media.SMOKE,
                                             "--work-dir", str(self.base / "work")]), 2)
        authorize.assert_called_once()

    def test_explicit_record_matches_operator_shape(self):
        media.authorize(self.authorization())
        self.assertNotIn("RECS_MEDIA_AUTHORIZED", os.environ)

    def test_wrong_channel_authorization_refused(self):
        with self.assertRaisesRegex(media.MediaError, "source channel"):
            media.authorize(self.authorization(channel_id="different"))

    def test_operator_source_and_confirmation_required(self):
        for changes in ({"source": "prior-run-log"}, {"operator_confirmed_local_record": False},
                        {"authorized": "true"}, {"scope": ""}, {"recorded_at": "yesterday"}):
            with self.subTest(changes=changes), self.assertRaises(media.MediaError):
                media.authorize(self.authorization(**changes))

    def test_nonignored_repo_authorization_refused(self):
        with patch.object(media, "REPO", self.base), patch.object(media, "command", return_value=(1, "", "")):
            with self.assertRaisesRegex(media.MediaError, "gitignored"):
                media.authorize(self.authorization())

    def test_invalid_ids(self):
        for invalid in ("https://youtu.be/MZr169xBwrU", "../secret", "MZr169xBwrU;", "", "a" * 12):
            with self.subTest(invalid=invalid), self.assertRaises(argparse.ArgumentTypeError):
                media.youtube_id(invalid)
        self.assertEqual(media.youtube_id("wh4mCRKRJ-4"), "wh4mCRKRJ-4")

    def test_repo_paths_and_ancestors_refused(self):
        for path in (media.REPO, media.REPO / ".local/media", media.REPO.parent):
            with self.subTest(path=path), self.assertRaisesRegex(media.MediaError, "outside"):
                media.owned_workdir(path, create=True)

    def test_symlink_to_repository_refused(self):
        alias = self.base / "alias"
        alias.symlink_to(media.REPO, target_is_directory=True)
        with self.assertRaises(media.MediaError):
            media.owned_workdir(alias / "media-test", create=True)

    def test_cleanup_refuses_unowned_and_preserves_files(self):
        (self.base / "keep").write_text("keep")
        with self.assertRaises(media.MediaError):
            media.cleanup(self.base)
        self.assertTrue((self.base / "keep").exists())
        with self.assertRaises(media.MediaError):
            media.owned_workdir(self.base, create=True)

    def test_cleanup_owns_only_sentinel_root_and_does_not_follow_links(self):
        root = self.workspace()
        outside = self.base / "outside"
        outside.mkdir()
        (outside / "keep").write_text("keep")
        (root / "link").symlink_to(outside, target_is_directory=True)
        (root / "media.bin").write_bytes(b"fixture")
        media.cleanup(root)
        self.assertFalse(root.exists())
        self.assertEqual((outside / "keep").read_text(), "keep")

    def test_copied_sentinel_cannot_authorize_another_directory(self):
        root = self.workspace()
        other = self.base / "other"
        other.mkdir()
        (other / media.SENTINEL).write_bytes((root / media.SENTINEL).read_bytes())
        with self.assertRaisesRegex(media.MediaError, "sentinel"):
            media.cleanup(other)
        self.assertTrue(other.exists())

    def test_symlink_workdir_and_marker_refused(self):
        root = self.workspace()
        alias = self.base / "alias"
        alias.symlink_to(root, target_is_directory=True)
        with self.assertRaises(media.MediaError):
            media.cleanup(alias)
        marker = root / media.SENTINEL
        copy = self.base / "marker"
        marker.rename(copy)
        marker.symlink_to(copy)
        with self.assertRaises(media.MediaError):
            media.cleanup(root)

    def test_failure_and_interrupt_do_not_delete_the_workspace(self):
        auth = self.authorization()
        for failure in (media.MediaError("simulated failure"), SystemExit(128 + signal.SIGTERM)):
            with self.subTest(failure=failure), patch.object(media, "acquire", side_effect=failure):
                args = ["acquire", "--youtube-id", media.SMOKE, "--authorization-file", str(auth),
                        "--work-dir", str(self.base / "work")]
                if isinstance(failure, SystemExit):
                    with self.assertRaises(SystemExit):
                        self.quiet_main(args)
                else:
                    self.assertEqual(self.quiet_main(args), 2)
                self.assertTrue((self.base / 'work' / media.SENTINEL).exists())

    def test_cleanup_needs_no_authorization(self):
        root = self.workspace()
        self.assertEqual(self.quiet_main(["cleanup", "--work-dir", str(root)]), 0)
        self.assertFalse(root.exists())

    def test_wrong_metadata_channel_never_downloads(self):
        root = self.workspace()
        metadata = {"id": media.SMOKE, "channel_id": "different", "duration": 189}
        with patch.object(media, "tool_versions", return_value=({}, "whisper-cli")), \
                patch.object(media, "check_space"), \
                patch.object(media, "command", return_value=(0, json.dumps(metadata), "")) as command:
            with self.assertRaisesRegex(media.MediaError, "metadata channel"):
                media.acquire(root, media.SMOKE, self.authorization(), 900)
        self.assertEqual(command.call_count, 1)
        self.assertIn("--skip-download", command.call_args.args[0])

    def test_section_acquisition_checks_metadata_first_and_records_offset(self):
        root = self.workspace()
        calls = []
        def native(argv, timeout):
            calls.append(argv)
            if "--dump-single-json" in argv:
                return 0, json.dumps({"id": media.SMOKE, "channel_id": media.CHANNEL, "duration": 189}), ""
            output = Path(argv[argv.index('--output') + 1]).parent / 'source.mkv'
            output.write_bytes(b'fixture')
            return 0, "", ""
        with patch.object(media, "tool_versions", return_value=({"ffmpeg": "fixture"}, "whisper-cli")), \
                patch.object(media, "check_space"), patch.object(media, "command", side_effect=native), \
                patch.object(media, "probe", return_value=60):
            result = media.acquire(root, media.SMOKE, self.authorization(), 900, "*30-90")
        self.assertIn("--skip-download", calls[0])
        self.assertIn("--download-sections", calls[1])
        self.assertIn("*30-90", calls[1])
        self.assertEqual(result["acquired_span"], {"start": 30, "end": 90})
        self.assertEqual(result["duration_seconds"], 60)
        self.assertIn("source.mkv", result["files"])
        self.assertEqual(result["tool_versions"], {"ffmpeg": "fixture"})

    def test_near_empty_failure_is_objective(self):
        probe = {"format": {"duration": "7"}, "streams": [{"codec_type": "video"}, {"codec_type": "audio"}]}
        with patch.object(media, "command", return_value=(0, json.dumps(probe), "")):
            with self.assertRaisesRegex(media.MediaError, "Near-empty.*7.000s"):
                media.probe(self.base / "fixture", 900)

    def test_sampling_every_300_seconds_with_absolute_frame_times(self):
        root = self.workspace()
        self.manifest(root, 50, 675)
        with patch.object(media, "extract_audio") as audio, patch.object(media, "command") as command:
            result = media.sample(root, 900)
        self.assertEqual([item["start"] for item in result["samples"]], [50, 350, 650])
        self.assertEqual([item["end"] for item in result["samples"]], [80, 380, 675])
        self.assertEqual([call.args[2:4] for call in audio.call_args_list], [(0, 30), (300, 30), (600, 25)])
        self.assertEqual(command.call_count, 3)

    def test_chunk_spans_are_600_with_45_second_overlap(self):
        self.assertEqual(list(media.chunks(120, 1500)), [(120, 720), (675, 1275), (1230, 1500)])
        self.assertEqual(list(media.chunks(0, 600)), [(0, 600)])
        with self.assertRaises(media.MediaError):
            list(media.chunks(1, 1))

    def test_timestamp_conversion_offsets_are_milliseconds(self):
        payload = {"transcription": [{"offsets": {"from": 1250, "to": 3250}, "text": " evidence "}]}
        self.assertEqual(media.absolute_segments(payload, 675, 1275),
                         [{"start": 676.25, "end": 678.25, "text": "evidence"}])

    def test_timestamp_conversion_clock_and_clip(self):
        payload = {"transcription": [{"timestamps": {"from": "00:00:01,250", "to": "00:00:09.500"}, "text": "fixture"}]}
        self.assertEqual(media.absolute_segments(payload, 30, 35)[0], {"start": 31.25, "end": 35, "text": "fixture"})
        self.assertEqual(media.seconds("01:02:03.450"), 3723.45)
        self.assertEqual(media.timestamp(3723.45), "01:02:03.450")
        self.assertEqual(media.timestamp(59.9996), "00:01:00.000")
        for value in ("nan", "inf", "-1", "00:60:00", "00:00:60"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                media.seconds(value)

    def test_transcription_only_extracts_requested_span_and_preserves_seams(self):
        root = self.workspace()
        self.manifest(root, 50, 1600)
        calls = []
        def whisper(argv, timeout):
            calls.append(argv)
            stem = Path(argv[argv.index("--output-file") + 1])
            media.write_json(stem.with_suffix(".json"), {"transcription": [
                {"offsets": {"from": 0, "to": 5000}, "text": "early"},
                {"offsets": {"from": 30000, "to": 35000}, "text": "later"}]})
            return 0, "", ""
        with patch.object(media, "verified_model", return_value=(self.base / media.MODEL, {"filename": media.MODEL})), \
                patch.object(media, "tool_versions", return_value=({}, "whisper-cli")), \
                patch.object(media, "extract_audio") as extract, patch.object(media, "command", side_effect=whisper):
            result = media.transcribe(root, 120, 1500, self.base / "cache", "en", 900)
        self.assertEqual([call.args[2:4] for call in extract.call_args_list], [(70, 600), (625, 600), (1180, 270)])
        evidence = media.read_json(root / "evidence.json")
        self.assertEqual([chunk["start"] for chunk in evidence["chunks"]], [120, 675, 1230])
        self.assertIn({"start": 705.0, "end": 710.0, "text": "later", "chunk_index": 1}, evidence["segments"])
        self.assertEqual(evidence["chunks"][1]["segments"][0]["start"], 675)
        self.assertNotIn(675, [segment["start"] for segment in evidence["segments"]])
        self.assertEqual(result["transcribed_span"], {"start": 120, "end": 1500})
        self.assertTrue((root / "evidence.txt").is_file())
        self.assertTrue(all("--language" in call and "--translate" not in call for call in calls))

    def test_intel_macos_avoids_metal_abort_without_disabling_apple_silicon_gpu(self):
        root = self.workspace()
        self.manifest(root, 0, 60)
        def whisper(argv, timeout):
            stem = Path(argv[argv.index("--output-file") + 1])
            media.write_json(stem.with_suffix(".json"), {"transcription": []})
            return 0, "", ""
        for system, machine, no_gpu in (("darwin", "x86_64", True),
                                        ("darwin", "arm64", False),
                                        ("linux", "x86_64", False)):
            with self.subTest(system=system, machine=machine), \
                    patch.object(media.sys, "platform", system), \
                    patch.object(media.platform, "machine", return_value=machine), \
                    patch.object(media, "verified_model", return_value=(self.base / media.MODEL, {})), \
                    patch.object(media, "tool_versions", return_value=({}, "whisper-cli")), \
                    patch.object(media, "extract_audio"), \
                    patch.object(media, "command", side_effect=whisper) as command:
                result = media.transcribe(root, 0, 60, self.base / "cache", "en", 900)
                self.assertEqual("--no-gpu" in command.call_args.args[0], no_gpu)
                evidence = media.read_json(root / "evidence.json")
                self.assertEqual(evidence["inference_options"], ["--no-gpu"] if no_gpu else [])
                self.assertEqual(result["inference_options"], evidence["inference_options"])

    def test_transcribe_refuses_outside_acquired_span(self):
        root = self.workspace()
        self.manifest(root, 50, 100)
        with patch.object(media, "command") as command:
            with self.assertRaisesRegex(media.MediaError, "outside"):
                media.transcribe(root, 0, 60, self.base / "cache", "en", 900)
        command.assert_not_called()

    def test_rejected_cli_commands_preserve_existing_media_and_evidence(self):
        root = self.workspace(); self.manifest(root, 0, 60)
        (root / 'evidence.json').write_text('{"existing": true}')
        (root / 'chunk-0000.wav').write_bytes(b'completed audio evidence')
        before = {p.name: p.read_bytes() for p in root.iterdir()}
        auth = self.authorization()
        for command_args in (['acquire', '--youtube-id', 'ZTDYIJUDb0M'],
                             ['transcribe', '--start', '0', '--end', '61']):
            with patch.object(media, 'command') as native:
                self.assertEqual(self.quiet_main([*command_args, '--work-dir', str(root), '--authorization-file', str(auth)]), 2)
                native.assert_not_called()
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_partial_processing_failure_preserves_previous_outputs(self):
        root = self.workspace(); self.manifest(root, 0, 60)
        (root / 'sample-0000.wav').write_bytes(b'previous sample')
        (root / 'samples.json').write_text('{"previous": true}')
        before = {p.name: p.read_bytes() for p in root.iterdir()}
        def partial(stage, name, *_):
            (stage / name).write_bytes(b'partial replacement')
            raise media.MediaError('simulated native failure')
        with patch.object(media, 'extract_audio', side_effect=partial):
            with self.assertRaises(media.MediaError): media.sample(root, 900)
        self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_success_publishes_only_completed_outputs_and_rolls_back_publication_failure(self):
        root = self.workspace(); self.manifest(root, 0, 60)
        (root / 'result.txt').write_text('old')
        @media.transactional
        def operation(stage):
            (stage / 'result.txt').write_text('new')
            (stage / 'second.txt').write_text('new second')
            return {'ok': True}
        replace = Path.replace
        def fail_second(current, target):
            if current.name == 'second.txt' and current.parent.name == 'work': raise OSError('fixture publication failure')
            return replace(current, target)
        before = {p.name: p.read_bytes() for p in root.iterdir()}
        with patch.object(Path, 'replace', fail_second):
            with self.assertRaises(OSError): operation(root)
        self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)
        self.assertTrue(operation(root)['ok'])
        self.assertEqual((root / 'result.txt').read_text(), 'new')
        self.assertEqual((root / 'source.mkv').read_bytes(), before['source.mkv'])

    def test_interrupted_publication_recovers_before_next_operation(self):
        root = self.workspace(); self.manifest(root, 0, 60)
        transaction = root / '.processing-interrupted'
        (transaction / 'work').mkdir(parents=True); (transaction / 'backup').mkdir()
        (transaction / 'backup' / 'result.txt').write_text('previous evidence')
        (root / 'result.txt').write_text('interrupted replacement')
        media.write_json(transaction / 'journal.json', {'committed': False, 'files': [
            {'name': 'result.txt', 'existed': True, 'sha256': media.sha256(root / 'result.txt')}]})
        @media.transactional
        def operation(stage):
            return 'complete'
        self.assertEqual(operation(root), 'complete')
        self.assertEqual((root / 'result.txt').read_text(), 'previous evidence')
        self.assertFalse(transaction.exists())

    def test_recovery_preserves_later_edits_and_lock_blocks_cleanup(self):
        root = self.workspace(); self.manifest(root, 0, 60)
        transaction = root / '.processing-interrupted'
        (transaction / 'work').mkdir(parents=True); (transaction / 'backup').mkdir()
        (transaction / 'backup' / 'result.txt').write_text('previous evidence')
        (root / 'result.txt').write_text('later manual edit')
        media.write_json(transaction / 'journal.json', {'committed': False, 'files': [
            {'name': 'result.txt', 'existed': True, 'sha256': hashlib.sha256(b'interrupted replacement').hexdigest()}]})
        with self.assertRaisesRegex(media.MediaError, 'later edit'):
            media.recover_transaction(root, transaction)
        self.assertEqual((root / 'result.txt').read_text(), 'later manual edit')
        self.assertEqual((transaction / 'backup' / 'result.txt').read_text(), 'previous evidence')
        with media.workspace_lock(root):
            with self.assertRaisesRegex(media.MediaError, 'active operation'):
                media.cleanup(root)
        self.assertTrue((root / 'source.mkv').is_file())

    def test_authoritative_model_metadata_and_verified_bytes(self):
        content = b"model fixture, not real weights"
        digest = hashlib.sha256(content).hexdigest()
        metadata = {"sha": "a" * 40, "siblings": [{"rfilename": media.MODEL,
                    "lfs": {"sha256": digest, "size": len(content)}}]}
        cache = self.base / "cache"
        with patch.object(media.urllib.request, "urlopen", side_effect=[io.BytesIO(json.dumps(metadata).encode()), io.BytesIO(content)]) as fetch:
            result = media.download_model(cache, 900)
        self.assertEqual(result["sha256"], digest)
        self.assertIn("/resolve/" + "a" * 40 + "/", fetch.call_args_list[1].args[0])
        self.assertEqual(media.verified_model(cache)[0].read_bytes(), content)
        (cache / media.MODEL).write_bytes(b"corruption")
        with self.assertRaisesRegex(media.MediaError, "verification"):
            media.verified_model(cache)

    def test_model_rejects_missing_lfs_hash(self):
        metadata = {"sha": "a" * 40, "siblings": [{"rfilename": media.MODEL}]}
        with patch.object(media.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(metadata).encode())):
            with self.assertRaisesRegex(media.MediaError, "authoritative LFS"):
                media.model_metadata()

    def test_bad_model_hash_removes_partial_download(self):
        content = b"corrupt"
        info = {"filename": media.MODEL, "size": len(content), "sha256": "0" * 64,
                "source_url": "https://huggingface.co/fixture"}
        cache = self.base / "cache"
        with patch.object(media, "model_metadata", return_value=info), \
                patch.object(media.urllib.request, "urlopen", return_value=io.BytesIO(content)):
            with self.assertRaisesRegex(media.MediaError, "SHA-256"):
                media.download_model(cache, 900)
        self.assertEqual(list(cache.iterdir()), [])

    def test_preflight_missing_tool_and_low_space(self):
        with patch.object(media.shutil, "which", return_value=None):
            with self.assertRaisesRegex(media.MediaError, "missing"):
                media.tool_versions()
        with patch.object(media.shutil, "disk_usage", return_value=type("Disk", (), {"free": 100})()):
            with self.assertRaisesRegex(media.MediaError, "Insufficient"):
                media.check_space(self.base, 2)

    def test_preflight_cleans_smoke_after_transcription_failure(self):
        root = self.workspace()
        args = argparse.Namespace(whisper_binary=None, min_free_gib=2, cache_dir=self.base / "cache",
                                  authorization_file=self.authorization(), timeout=900)
        with patch.object(media, "tool_versions", return_value=({}, "whisper-cli")), \
                patch.object(media, "check_space", return_value=10000), \
                patch.object(media, "verified_model", return_value=(None, {})), \
                patch.object(media, "acquire", return_value={"duration_seconds": 60, "acquired_span": {"end": 60}}), \
                patch.object(media, "transcribe", side_effect=media.MediaError("fixture")):
            with self.assertRaises(media.MediaError):
                media.preflight(root, args)
        self.assertFalse((root / "smoke").exists())

    def test_bounded_native_failure_output_is_not_logged(self):
        with self.assertRaises(media.MediaError) as error:
            media.command([sys.executable, "-c", "import sys; print('secret-cookie'); sys.exit(7)"], 5)
        self.assertNotIn("secret", str(error.exception))
        self.assertIn("exit 7", str(error.exception))

    def test_failed_leader_does_not_leave_descendants(self):
        marker = self.base / "should-not-exist"
        grandchild = "import time,pathlib; time.sleep(0.8); pathlib.Path(" + repr(str(marker)) + ").touch()"
        leader = "import subprocess,sys; subprocess.Popen([sys.executable,'-c'," + repr(grandchild) + "]); sys.exit(3)"
        with self.assertRaises(media.MediaError):
            media.command([sys.executable, "-c", leader], 5)
        time.sleep(1)
        self.assertFalse(marker.exists())

    def test_timeout_is_bounded(self):
        started = time.monotonic()
        with self.assertRaisesRegex(media.MediaError, "timed out"):
            media.command([sys.executable, "-c", "import time; time.sleep(30)"], 0.1)
        self.assertLess(time.monotonic() - started, 7)

    def test_sigterm_cleans_active_native_process_group(self):
        ready = self.base / "ready"
        marker = self.base / "should-not-survive-signal"
        descendant = "import time,pathlib; time.sleep(1); pathlib.Path(" + repr(str(marker)) + ").touch()"
        native = ("import subprocess,sys,pathlib,time; subprocess.Popen([sys.executable,'-c'," + repr(descendant) + "]); "
                  "pathlib.Path(" + repr(str(ready)) + ").touch(); time.sleep(30)")
        wrapper = "from scripts import media; import sys; media.command([sys.executable,'-c'," + repr(native) + "], 5)"
        # Keep imports bytecode-free even under the cleared test environment.
        environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        process = subprocess.Popen([sys.executable, "-c", wrapper], cwd=media.REPO, env=environment,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            limit = time.monotonic() + 3
            while not ready.exists() and time.monotonic() < limit:
                time.sleep(0.02)
            self.assertTrue(ready.exists(), "native process did not start")
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=7), 143)
            time.sleep(1.1)
            self.assertFalse(marker.exists())
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                process.wait(timeout=7)


if __name__ == "__main__":
    unittest.main()
