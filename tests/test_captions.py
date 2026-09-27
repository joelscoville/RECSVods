import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import captions, media

VIDEO = 'ABCDEFGHIJK'

class CaptionTests(unittest.TestCase):
    def test_gate_thresholds_scope_and_word_rate(self):
        segment = lambda text: [{'start': 0, 'end': 60, 'text': text}]
        good, selected = captions.quality_gate(segment(' '.join(['hope'] * 90 + ['qzx'] * 10)), 0, 60, {'hope'})
        self.assertTrue(good['passed']); self.assertEqual(good['english_ratio'], 0.9); self.assertEqual(len(selected), 1)
        for text, end in [(' '.join(['hope'] * 89 + ['qzx'] * 11), 60), ('hope ' * 10, 60), ('hope ' * 300, 60), ('hope ' * 40, 600)]:
            self.assertFalse(captions.quality_gate(segment(text), 0, end, {'hope'})[0]['passed'])
        self.assertFalse(captions.quality_gate(segment('hope ' * 90 + '信仰' * 20), 0, 60, {'hope'})[0]['passed'])
        self.assertEqual(captions.quality_gate(segment('hope ' * 90), 60, 120, {'hope'})[0]['words'], 0)
        with self.assertRaises(media.MediaError):
            captions.quality_gate([], 10, 10, set())

    def test_labels_contractions_and_non_latin_tokens(self):
        self.assertEqual(captions.tokens('[Music] Hope, faith, 世界!'), ['hope', 'faith', '世', '界'])
        for word in ("can't", "won't", "don't", "we're", "God's"):
            self.assertTrue(captions.dictionary_word(word.lower(), {'can', 'will', 'do', 'we', 'god'}))
        self.assertFalse(captions.dictionary_word('invented-name', {'name'}))

    def test_json3_preserves_text_timing_deduplicates_exact_events_and_bounds_tail(self):
        event = {'tStartMs': 1000, 'dDurationMs': 2000, 'segs': [{'utf8': 'Hello '}, {'utf8': 'world.'}]}
        raw = json.dumps({'events': [{'tStartMs': 0}, event, event]}).encode()
        rows, clipped = captions.parse_json3(raw, 3)
        self.assertEqual(rows, [{'start': 1.0, 'end': 3.0, 'text': 'Hello world.'}]); self.assertEqual(clipped, 0)
        self.assertEqual(captions.parse_json3(raw, 2.5)[1], 1)
        with self.assertRaises(media.MediaError): captions.parse_json3(raw, 0.1)
        for value in (True, -1, float('inf'), '1'):
            with self.assertRaises(media.MediaError): captions.number(value)

    def test_dictionary_is_pinned_not_trusted_from_a_mutable_receipt(self):
        with self.assertRaises(media.MediaError): captions.check_dictionary(b'hope\nfaith\n')

    def test_dictionary_repairs_only_its_verified_cache_atomically_and_reuses_it(self):
        with tempfile.TemporaryDirectory(prefix='recs-dictionary-test-') as temporary:
            root = Path(temporary) / 'cache'; root.mkdir()
            target = root / captions.CONFIG['dictionary']['file']; target.write_bytes(b'bad')
            other = root / 'operator-note.txt'; other.write_text('keep')
            def check(data):
                if data != b'good': raise media.MediaError('corrupt')
                return {'hope'}, 'fixture-hash'
            with patch.object(captions, 'check_dictionary', side_effect=check), \
                 patch.object(captions.urllib.request, 'urlopen', return_value=io.BytesIO(b'good')) as fetch:
                self.assertTrue(captions.prepare_dictionary(root)['repaired'])
                self.assertTrue(captions.prepare_dictionary(root)['reused'])
                fetch.assert_called_once()
            self.assertEqual(target.read_bytes(), b'good'); self.assertEqual(other.read_text(), 'keep')
            self.assertEqual(sorted(item.name for item in root.iterdir()), sorted([target.name, other.name]))

    def run_source(self, track=True, quality=True, wrong_channel=False, malformed=False, interrupt=False, live=False):
        temporary = tempfile.TemporaryDirectory(prefix='recs-caption-test-')
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name); dictionary = base / 'dictionary'; dictionary.mkdir()
        (dictionary / captions.CONFIG['dictionary']['file']).write_bytes(b'fixture')
        root = base / 'work'; calls = []
        def native(argv, timeout=900, allow_failure=False):
            calls.append(argv)
            if '--dump-single-json' in argv:
                return 0, json.dumps({'id': VIDEO, 'channel_id': 'wrong' if wrong_channel else media.CHANNEL, 'duration': 120, 'is_live': live, 'live_status': None if live else 'was_live',
                    'formats': [{'url': 'PRIVATE_SIGNED_URL'}], 'automatic_captions': {'en-orig': [{}]} if track else {'en': [{}]}}), ''
            if '--write-auto-subs' in argv:
                if interrupt: raise KeyboardInterrupt()
                raw = b'invalid' if malformed else json.dumps({'events': [{'tStartMs': 0, 'dDurationMs': 60000,
                    'segs': [{'utf8': ('hope ' if quality else 'qzx ') * 90}]}]}).encode()
                (root / f'{VIDEO}.en-orig.json3').write_bytes(raw)
                return 0, '', ''
            return 0, '2026.08.19\n', ''
        with patch.object(media, 'authorize') as authorize, patch.object(media, 'command', side_effect=native), \
             patch.object(captions, 'check_dictionary', return_value=({'hope'}, captions.CONFIG['dictionary']['sha256'])):
            if wrong_channel or interrupt:
                with self.assertRaises((media.MediaError, KeyboardInterrupt)):
                    captions.fetch_source(VIDEO, root, dictionary, end=60)
                self.assertFalse(root.exists())
                return
            result = captions.fetch_source(VIDEO, root, dictionary, end=60)
            authorize.assert_called_once()
        return result, root, calls

    def test_accepted_source_is_private_canonical_evidence_with_safe_provenance_and_no_audio(self):
        result, root, calls = self.run_source()
        self.assertEqual(result['status'], 'captions_accepted')
        self.assertFalse(result['audio_downloaded'])
        self.assertNotIn('PRIVATE_SIGNED_URL', json.dumps(result))
        evidence = json.loads((root / 'evidence.json').read_text())
        self.assertEqual(evidence['youtube_id'], VIDEO)
        self.assertNotIn('words', evidence['segments'][0])
        for argv in calls:
            if '--version' not in argv:
                self.assertIn('--skip-download', argv)
                self.assertIn('--ignore-config', argv)
        self.assertEqual(result['archive_caption_provenance']['scope'], {'start': 0.0, 'end': 60.0})

    def test_missing_track_quality_failure_and_malformed_captions_handoff_and_clean(self):
        for options, reason in [({'track': False}, 'missing_en_orig'), ({'quality': False}, 'quality_gate_failed'), ({'malformed': True}, 'invalid_caption_evidence')]:
            result, root, _ = self.run_source(**options)
            self.assertEqual(result['reason'], reason); self.assertEqual(result['status'], 'fallback_required')
            self.assertFalse(root.exists())

    def test_identity_mismatch_and_interruption_clean_only_the_owned_workspace(self):
        self.run_source(wrong_channel=True)
        self.run_source(interrupt=True)

    def test_live_recordings_wait_instead_of_starting_asr(self):
        result, root, _ = self.run_source(live=True)
        self.assertEqual(result['reason'], 'recording_not_ready')
        self.assertIn('Wait', result['next_step'])
        self.assertFalse(root.exists())

    def test_missing_authorization_and_invalid_ids_never_start_tools(self):
        with patch.object(media, 'command') as native, patch.object(media, 'authorize', side_effect=media.MediaError('not authorized')):
            with self.assertRaises(media.MediaError): captions.fetch_source(VIDEO, '/unused', '/unused')
            with self.assertRaises(media.MediaError): captions.fetch_source('../bad', '/unused', '/unused')
            native.assert_not_called()

if __name__ == '__main__':
    unittest.main()
