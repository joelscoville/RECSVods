#!/usr/bin/env python3
"""Person-invoked, authorized caption evidence. Never called by discovery or CI."""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
import urllib.request

try:
    from . import media
except ImportError:
    import media

CONFIG = json.loads(Path(__file__).with_name('caption-config.json').read_text())
DEFAULT_DICTIONARY = Path.home() / '.cache/recs-replay/caption-dictionary'
MAX_CAPTION_BYTES = 20_000_000

def digest(data):
    return hashlib.sha256(data).hexdigest()

def check_dictionary(data):
    spec = CONFIG['dictionary']
    blob = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
    if len(data) != spec['bytes'] or blob != spec['gitBlobSha1'] or digest(data) != spec['sha256']:
        raise media.MediaError('Caption dictionary integrity failure; prepare the pinned dictionary again')
    words = set(data.decode('ascii').lower().split())
    if len(words) < 100_000 or any(not re.fullmatch('[a-z]+', word) for word in words):
        raise media.MediaError('Invalid pinned dictionary structure')
    return words, digest(data)

def prepare_dictionary(directory):
    root = media.external_path(directory)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = root / CONFIG['dictionary']['file']
    if target.is_symlink():
        raise media.MediaError('Dictionary cache cannot use symlinks')
    previous = target.read_bytes() if target.exists() else None
    if previous is not None:
        try:
            _, sha = check_dictionary(previous)
            return {'prepared': True, 'reused': True, 'dictionary_sha256': sha}
        except media.MediaError:
            pass  # Repair only this explicitly selected, derived cache file.
    spec = CONFIG['dictionary']
    url = f'https://raw.githubusercontent.com/{spec["id"]}/{spec["revision"]}/{spec["file"]}'
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(spec['bytes'] + 1)
    _, sha = check_dictionary(data)
    fd, name = tempfile.mkstemp(prefix='.caption-dictionary-', dir=root)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
        if previous is None:
            os.link(temporary, target)
        else:
            if target.is_symlink() or target.read_bytes() != previous:
                raise media.MediaError('Dictionary cache changed during preparation')
            temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return {'prepared': True, 'reused': False, 'repaired': previous is not None, 'dictionary_sha256': sha}

def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise media.MediaError('Invalid caption timestamp')
    return float(value)

def parse_json3(data, duration):
    if len(data) > MAX_CAPTION_BYTES:
        raise media.MediaError('Caption size bound exceeded')
    payload = json.loads(data)
    if not isinstance(payload, dict) or not isinstance(payload.get('events'), list):
        raise media.MediaError('Invalid json3 caption structure')
    segments, seen, clipped = [], set(), 0
    for event in payload['events']:
        if not isinstance(event, dict):
            raise media.MediaError('Invalid caption event')
        if 'segs' not in event:
            continue  # Formatting/window events carry no speech.
        if not isinstance(event['segs'], list) or any(not isinstance(seg, dict) or not isinstance(seg.get('utf8'), str) for seg in event['segs']):
            raise media.MediaError('Invalid caption text segments')
        text = ''.join(seg['utf8'] for seg in event['segs']).strip()
        if not text:
            continue
        start = number(event.get('tStartMs')) / 1000
        end = start + number(event.get('dDurationMs')) / 1000
        if start > duration or end > duration + 2:
            raise media.MediaError('Caption timing exceeds the verified source duration')
        tail_clipped = end > duration
        if tail_clipped:
            end = duration
        if end <= start:
            continue
        key = (start, end, text)
        if key in seen:
            continue
        seen.add(key)
        clipped += int(tail_clipped)
        segments.append({'start': start, 'end': end, 'text': text})
    # No invented word timings, punctuation, translation, or ASR corrections.
    return sorted(segments, key=lambda row: (row['start'], row['end'])), clipped

def tokens(text):
    # Captions' sound labels are not spoken words; non-Latin script is counted
    # character-by-character rather than allowing a long phrase to count as one unknown.
    text = re.sub(r'\[[^\]]*\]', ' ', text).replace('’', "'")
    result = []
    for word in re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", text, re.UNICODE):
        word = word.casefold()
        if any(character.isalpha() and 'LATIN' not in unicodedata.name(character, '') for character in word):
            result.extend(character for character in word if character.isalpha())
        else:
            result.append(word)
    return result

def dictionary_word(word, dictionary):
    if word in dictionary:
        return True
    # Common contractions/possessives, not an ad-hoc list of religious names.
    contractions = {"can't": 'can', "won't": 'will', "shan't": 'shall'}
    if word in contractions:
        return contractions[word] in dictionary
    if word.endswith("n't"):
        return word[:-3] in dictionary
    for suffix in ("'s", "'re", "'ve", "'ll", "'d", "'m"):
        if word.endswith(suffix):
            return word[:-len(suffix)] in dictionary
    return False

def quality_gate(segments, start, end, dictionary):
    start, end = number(start), number(end)
    if end <= start:
        raise media.MediaError('Caption quality scope must have a positive duration')
    selected = [segment for segment in segments if start <= (segment['start'] + segment['end']) / 2 < end]
    words = tokens(' '.join(segment['text'] for segment in selected))
    known = sum(dictionary_word(word, dictionary) for word in words)
    ratio = known / len(words) if words else 0
    rate = len(words) * 60 / (end - start)
    reasons = []
    if len(words) < CONFIG['minimumWords']:
        reasons.append('insufficient_words')
    if not CONFIG['minimumWordsPerMinute'] <= rate <= CONFIG['maximumWordsPerMinute']:
        reasons.append('implausible_word_rate')
    if ratio < CONFIG['minimumEnglishRatio']:
        reasons.append('dictionary_ratio_below_90_percent')
    return {'passed': not reasons, 'words': len(words), 'dictionary_words': known,
            'english_ratio': round(ratio, 6), 'words_per_minute': round(rate, 6),
            'scope': {'start': start, 'end': end}, 'reasons': reasons}, selected

def fallback(reason, quality=None):
    return {'status': 'fallback_required', 'reason': reason, **({'quality': quality} if quality else {}),
            'next_step': 'Wait for the recording to finalize before caption or ASR processing.' if reason == 'recording_not_ready' else
            'Use the authorized local whisper.cpp pipeline for the verified sermon/context span; this command downloaded no audio.'}

def fetch_source(video_id, work_dir, dictionary_dir, authorization_file=None, start=0, end=None, timeout=180):
    if not isinstance(video_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise media.MediaError('Invalid caption video identity')
    media.authorize(authorization_file)
    dictionary_path = media.external_path(dictionary_dir) / CONFIG['dictionary']['file']
    if dictionary_path.is_symlink():
        raise media.MediaError('Dictionary cache cannot use symlinks')
    dictionary, dictionary_hash = check_dictionary(dictionary_path.read_bytes())
    root = media.external_path(work_dir)
    if root.exists() and any(root.iterdir()):
        raise media.MediaError('Caption processing requires a fresh empty dedicated workspace')
    root = media.owned_workdir(root, create=True)
    accepted = False
    try:
        base = ['yt-dlp', '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-warnings', '--no-progress',
                '--socket-timeout', '30', '--retries', '1', '--extractor-retries', '1']
        url = f'https://www.youtube.com/watch?v={video_id}'
        _, output, _ = media.command([*base, '--skip-download', '--dump-single-json', url], timeout)
        info = json.loads(output)
        if not isinstance(info, dict) or info.get('id') != video_id or info.get('channel_id') != media.CHANNEL:
            raise media.MediaError('Caption source identity/channel mismatch')
        if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
            return fallback('recording_not_ready')
        duration = number(info.get('duration'))
        end = duration if end is None else number(end)
        if duration <= 0 or not 0 <= start < end <= duration:
            raise media.MediaError('Caption scope must fit the verified source duration')
        tracks = info.get('automatic_captions') or {}
        if not isinstance(tracks, dict):
            raise media.MediaError('Invalid source caption-track metadata')
        if not tracks.get(CONFIG['track']):
            return fallback('missing_en_orig')
        code, _, _ = media.command([*base, '--skip-download', '--write-auto-subs', '--sub-langs', '^en-orig$',
            '--sub-format', 'json3', '--output', f'{str(root).replace("%", "%%")}/{video_id}.%(ext)s', url], timeout, True)
        caption = root / f'{video_id}.en-orig.json3'
        if code or not caption.is_file() or caption.is_symlink():
            return fallback('caption_fetch_failed')
        if caption.stat().st_size > MAX_CAPTION_BYTES:
            raise media.MediaError('Caption size bound exceeded')
        raw = caption.read_bytes()
        try:
            segments, clipped = parse_json3(raw, duration)
            quality, selected = quality_gate(segments, start, end, dictionary)
        except (media.MediaError, ValueError, TypeError, KeyError):
            return fallback('invalid_caption_evidence')
        if not quality['passed']:
            return fallback('quality_gate_failed', quality)
        _, version, _ = media.command(['yt-dlp', '--version'], 30)
        if not re.fullmatch(r'\d{4}\.\d{2}\.\d{2}[\w.+-]*', version.strip()):
            raise media.MediaError('Cannot establish caption tool version')
        evidence = {'schema_version': 1, 'youtube_id': video_id, 'channel_id': media.CHANNEL,
                    'duration_seconds': duration, 'language': 'en',
                    'engine': {'name': 'youtube-auto-captions', 'track': 'en-orig'},
                    'timestamp_basis': 'absolute source-caption segment seconds; not word alignment',
                    'segments': selected}
        media.write_json(root / 'evidence.json', evidence)
        provenance = {'engine': 'youtube-auto-captions', 'track': 'en-orig', 'gate_version': CONFIG['schemaVersion'], 'video_id': video_id,
            'yt_dlp_version': version.strip(), 'dictionary_id': CONFIG['dictionary']['id'],
            'dictionary_blob_sha1': CONFIG['dictionary']['gitBlobSha1'], 'dictionary_sha256': dictionary_hash,
            'caption_sha256': digest(raw), 'evidence_sha256': digest((root / 'evidence.json').read_bytes()),
            'fetched_at': dt.datetime.now(dt.timezone.utc).isoformat(),
            **{key: quality[key] for key in ('words', 'dictionary_words', 'english_ratio', 'words_per_minute', 'scope')}}
        receipt = {'schema_version': 1, 'status': 'captions_accepted', 'youtube_id': video_id,
                   'source_duration_seconds': duration, 'quality': quality, 'tail_clipped_segments': clipped,
                   'audio_downloaded': False, 'archive_caption_provenance': provenance}
        media.write_json(root / 'caption-receipt.json', receipt)
        accepted = True
        return receipt
    finally:
        if not accepted:
            media.cleanup(root)

def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == '--':
        del argv[0]
    if len(argv) > 1 and argv[1] == '--':
        del argv[1]
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prepare = sub.add_parser('dictionary')
    prepare.add_argument('--cache-dir', type=Path, default=DEFAULT_DICTIONARY)
    fetch = sub.add_parser('fetch')
    fetch.add_argument('--youtube-id', type=media.youtube_id, required=True)
    fetch.add_argument('--work-dir', type=Path, required=True)
    fetch.add_argument('--dictionary-dir', type=Path, default=DEFAULT_DICTIONARY)
    fetch.add_argument('--authorization-file', type=Path)
    fetch.add_argument('--start', type=media.seconds, default=0)
    fetch.add_argument('--end', type=media.seconds)
    fetch.add_argument('--timeout', type=float, default=180)
    args = parser.parse_args(argv)
    if args.command == 'dictionary':
        result = prepare_dictionary(args.cache_dir)
    else:
        with media.interrupt_cleanup():
            result = fetch_source(args.youtube_id, args.work_dir, args.dictionary_dir, args.authorization_file, args.start, args.end, args.timeout)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 2 if result.get('status') == 'fallback_required' else 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (media.MediaError, OSError, ValueError, TypeError, KeyError) as error:
        print(f'captions: {error if isinstance(error, media.MediaError) else "source, dictionary or tool validation failed; private details withheld"}', file=sys.stderr)
        sys.exit(1)
