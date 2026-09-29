"""Synthetic PCM and mocked-source checks: no real recording downloads."""
from array import array
import argparse
import json
import math
from pathlib import Path
import sys
import shutil
import tempfile
import unittest
import wave
from unittest.mock import patch
from scripts import probe_audio as probe


def pcm(left=.15, right=.15, duration=1, gaps=()):
    values = array('f')
    for i in range(int(probe.RATE * duration)):
        time = i / probe.RATE
        wave = math.sin(2 * math.pi * 440 * time) if not any(start <= time < end for start, end in gaps) else 0
        values.extend((wave * left, wave * right))
    if sys.byteorder != 'little':
        values.byteswap()
    return values.tobytes()


class AudioProbeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Native audio tools are optional outside devenv')
    def test_real_local_stereo_source_is_sampled_with_ffmpeg(self):
        with tempfile.TemporaryDirectory() as temporary:
            filename = Path(temporary) / 'left-only.wav'
            values = array('h')
            for i in range(probe.RATE * 60):
                values.extend((int(5000 * math.sin(2 * math.pi * 440 * i / probe.RATE)), 0))
            if sys.byteorder != 'little':
                values.byteswap()
            with wave.open(str(filename), 'wb') as output:
                output.setnchannels(2); output.setsampwidth(2); output.setframerate(probe.RATE)
                output.writeframes(values.tobytes())
            args = argparse.Namespace(youtube=False, file=filename, video='AAAAAAAAAAA', duration=60, start=0, end=60, sample_start=None)
            result = probe.check_audio(args)
            self.assertEqual(result['outcome'], 'analysed')
            self.assertEqual(result['detected'], ['audio_left_only'])
            self.assertLessEqual(result['sample']['end'] - result['sample']['start'], 30)
            self.assertEqual(result['candidates'], 3)

    def test_stereo_balance_mono_and_silence(self):
        self.assertEqual(probe.analyse_pcm(pcm(), 2)[1], [])
        self.assertEqual(probe.analyse_pcm(pcm(right=0), 2)[1], ['audio_left_only'])
        self.assertEqual(probe.analyse_pcm(pcm(left=0), 2)[1], ['audio_right_only'])
        self.assertNotIn('audio_left_only', probe.analyse_pcm(pcm(right=0), 1)[1])
        metrics, detected, _ = probe.analyse_pcm(pcm(0, 0), 2)
        self.assertEqual(detected, []); self.assertEqual(metrics['activeFraction'], 0)

    def test_short_internal_dropouts_are_suspicions_not_long_natural_pauses(self):
        _, detected, _ = probe.analyse_pcm(pcm(duration=2, gaps=[(.3, .35), (.7, .75), (1.1, 1.15)]), 2)
        self.assertIn('audio_choppy', detected)
        self.assertNotIn('audio_choppy', probe.analyse_pcm(pcm(duration=2, gaps=[(.3, .7), (1.1, 1.5)]), 2)[1])

    def test_candidates_are_bounded_and_distinct(self):
        points = probe.candidates(100, 1000, 1200)
        self.assertEqual(len(points), 3)
        self.assertTrue(all(100 <= point <= 994 for point in points))
        self.assertEqual(probe.candidates(0, 2, 2), [0])

    def test_local_sampling_selects_audible_candidate_without_downloading(self):
        with tempfile.TemporaryDirectory() as temporary:
            filename = Path(temporary) / 'fixture.wav'; filename.touch()
            args = argparse.Namespace(youtube=False, file=filename, video='AAAAAAAAAAA', duration=1200, start=100, end=1000, sample_start=None)
            candidate = probe.candidates(100, 1000, 1200)
            calls = []
            def decoded(file, start, duration, band=False):
                calls.append((start, duration, band))
                return pcm(0, 0) if start == candidate[0] else pcm(right=0, duration=min(duration, 2))
            with patch.object(probe.shutil, 'which', return_value='/fixture/tool'), patch.object(probe, 'inspect_source', return_value=(1200, 2)), patch.object(probe, 'decode', side_effect=decoded), patch.object(probe.media, 'command') as network:
                result = probe.check_audio(args)
            network.assert_not_called()
            self.assertEqual(result['outcome'], 'analysed'); self.assertEqual(result['candidates'], 3)
            self.assertIn('audio_left_only', result['detected'])
            self.assertEqual([call[1] for call in calls], [6, 6, 6, 30])
            self.assertNotEqual(result['sample']['start'], candidate[0])

    def test_youtube_sampling_requests_only_bounded_sections_and_cleans_downloads(self):
        args = argparse.Namespace(youtube=True, file=None, video='AAAAAAAAAAA', duration=1200, start=100, end=1000, sample_start=None)
        commands, downloaded = [], []
        def native(argv, *_):
            commands.append(argv)
            if '--dump-single-json' in argv:
                return 0, json.dumps({'id': args.video, 'channel_id': probe.media.CHANNEL, 'duration': 1200}), ''
            target = Path(argv[argv.index('--output') + 1].replace('%(ext)s', 'webm'))
            target.write_bytes(b'fixture sample'); downloaded.append(target)
            return 0, '', ''
        with patch.object(probe.shutil, 'which', return_value='/fixture/tool'), patch.object(probe.media, 'command', side_effect=native), patch.object(probe, 'inspect_source', return_value=(30, 2)), patch.object(probe, 'decode', return_value=pcm()):
            result = probe.check_audio(args)
        self.assertEqual(result['outcome'], 'analysed')
        requests = [argv[argv.index('--download-sections') + 1] for argv in commands if '--download-sections' in argv]
        lengths = [float(section.split('-')[1]) - float(section[1:].split('-')[0]) for section in requests]
        self.assertEqual(lengths, [6, 6, 6, 30])
        self.assertTrue(all(not file.exists() for file in downloaded))

    def test_rechecks_reuse_the_previous_sample_and_silence_is_inconclusive(self):
        with tempfile.TemporaryDirectory() as temporary:
            filename = Path(temporary) / 'fixture.wav'; filename.touch()
            args = argparse.Namespace(youtube=False, file=filename, video='AAAAAAAAAAA', duration=1200, start=100, end=1000, sample_start=450)
            with patch.object(probe.shutil, 'which', return_value='/fixture/tool'), patch.object(probe, 'inspect_source', return_value=(1200, 2)), patch.object(probe, 'decode', return_value=pcm(0, 0)) as decode:
                result = probe.check_audio(args)
            self.assertEqual(result['outcome'], 'inconclusive'); self.assertEqual(result['detected'], [])
            self.assertEqual(result['reason'], 'no_audible_sample')
            self.assertEqual(decode.call_args.args[1], 450); self.assertEqual(decode.call_count, 1)


if __name__ == '__main__':
    unittest.main()
