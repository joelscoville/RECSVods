#!/usr/bin/env python3
"""Optional bounded audio diagnostics. Measurements are samples, not whole-video certification."""
import argparse
from array import array
import datetime as dt
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile

try:
    from . import media
except ImportError:
    import media

RATE = 16000
CANDIDATE_SECONDS = 6
SAMPLE_SECONDS = 30


def db(power):
    return round(max(-120, min(6, 10 * math.log10(max(power, 1e-12)))), 3)


def analyse_pcm(data, channels):
    """16kHz interleaved stereo float PCM; original mono must never count as one-sided stereo."""
    samples = array('f')
    samples.frombytes(data)
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples or len(samples) % 2 or any(not math.isfinite(value) for value in samples):
        raise media.MediaError('Invalid decoded sample')
    frame_samples = RATE // 100  # 10 ms, with two channels per frame.
    left, right, frames, clipped = 0.0, 0.0, [], 0
    for offset in range(0, len(samples), frame_samples * 2):
        values = samples[offset:offset + frame_samples * 2]
        l = sum(value * value for value in values[::2]) / (len(values) / 2)
        r = sum(value * value for value in values[1::2]) / (len(values) / 2)
        left += l * len(values) / 2
        right += r * len(values) / 2
        frames.append(math.sqrt(max(l, r)))
        clipped += sum(abs(value) >= .995 for value in values)
    left_db, right_db = db(left / (len(samples) / 2)), db(right / (len(samples) / 2))
    active = sum(value >= .0056 for value in frames) / len(frames)
    dropouts, index = 0, 0
    while index < len(frames):
        if frames[index] >= .001:
            index += 1
            continue
        end = index
        while end < len(frames) and frames[end] < .001:
            end += 1
        # Brief near-digital silence between loud frames is only a suspicion; natural speech can do it.
        if 2 <= end - index <= 12 and index > 0 and end < len(frames) and frames[index - 1] > .02 and frames[end] > .02:
            dropouts += 1
        index = end
    metrics = {'channels': channels, 'leftDb': left_db, 'rightDb': right_db,
               'activeFraction': round(active, 6), 'dropouts': dropouts,
               'clippedFraction': round(clipped / len(samples), 6)}
    detected = []
    if channels >= 2 and max(left_db, right_db) > -45 and min(left_db, right_db) < -65 and abs(left_db - right_db) >= 30:
        detected.append('audio_left_only' if left_db > right_db else 'audio_right_only')
    if dropouts >= 3:
        detected.append('audio_choppy')
    if metrics['clippedFraction'] >= .005:
        detected.append('audio_clipping')
    return metrics, detected, len(samples) / (RATE * 2)


def candidates(start, end, duration):
    if not all(math.isfinite(value) for value in (start, end, duration)) or not 0 <= start < end <= duration:
        raise media.MediaError('Invalid sampling window')
    return list(dict.fromkeys(round(max(start, min(start + (end - start) * fraction - 3,
                                                  max(start, end - CANDIDATE_SECONDS))), 3)
                              for fraction in (.35, .5, .65)))


def inspect_source(filename):
    _, output, _ = media.command(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=channels:format=duration', '-of', 'json', filename], 20)
    data = json.loads(output)
    duration = media.seconds(data['format']['duration'])
    streams = data.get('streams', [])
    return duration, int(streams[0].get('channels', 0)) if streams else 0


def decode(filename, start, duration, speech_band=False):
    args = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', str(start),
            '-i', str(filename), '-t', str(duration), '-vn', '-ac', '2', '-ar', str(RATE)]
    if speech_band:
        args += ['-af', 'highpass=f=120,lowpass=f=3800']
    # Binary PCM is captured privately, never replayed to the terminal or written into the repository.
    import subprocess
    try:
        result = subprocess.run([*args, '-f', 'f32le', 'pipe:1'], capture_output=True, timeout=45, check=True)
    except (OSError, subprocess.SubprocessError):
        raise media.MediaError('Audio decoding failed') from None
    if len(result.stdout) > RATE * 2 * 4 * (SAMPLE_SECONDS + 1):
        raise media.MediaError('Decoded sample exceeds duration bound')
    return result.stdout


def check_audio(args):
    source = 'youtube' if args.youtube else 'local'
    def result(outcome, **fields):
        return {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'outcome': outcome,
                'source': source, 'candidates': 0, 'detected': [], **fields}
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe') or args.youtube and not shutil.which('yt-dlp'):
        return result('inconclusive', reason='tool_unavailable')
    locations = candidates(args.start, args.end, args.duration)
    if args.sample_start is not None:
        if not 0 <= args.sample_start < args.duration:
            raise media.MediaError('Previous sample is outside the recording')
        locations = [args.sample_start]
    with tempfile.TemporaryDirectory(prefix='recs-audio-check-') as temporary:
        root = Path(temporary)
        base = ['yt-dlp', '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--no-warnings',
                '--socket-timeout', '15', '--retries', '1', '--extractor-retries', '1']
        url = f'https://www.youtube.com/watch?v={args.video}'
        if args.youtube:
            _, output, _ = media.command([*base, '--skip-download', '--dump-single-json', url], 45)
            info = json.loads(output)
            if info.get('id') != args.video or info.get('channel_id') != media.CHANNEL or info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
                raise media.MediaError('Source identity or finalized-recording check failed')
            source_duration = media.seconds(info['duration'])
            channels = None
        else:
            filename = Path(args.file).expanduser().resolve(strict=True)
            if not filename.is_file():
                raise media.MediaError('Local source must be a regular recording file')
            source_duration, channels = inspect_source(filename)
        if abs(source_duration - args.duration) > 2:
            return result('inconclusive', reason='duration_changed')
        if channels == 0:
            return result('analysed', detected=['audio_missing'])
        counter = 0
        def sample(start, length, speech_band=False):
            nonlocal counter
            length = min(length, source_duration - start)
            if length <= 0:
                raise media.MediaError('No sample within source duration')
            if not args.youtube:
                return analyse_pcm(decode(filename, start, length, speech_band), channels)
            counter += 1
            stem = f'sample-{counter}'
            media.command([*base, '--format', 'bestaudio[abr<=128]/bestaudio', '--max-filesize', '8M',
                '--download-sections', f'*{start:.3f}-{start + length:.3f}', '--output', str(root / f'{stem}.%(ext)s'), url], 45)
            files = [item for item in root.glob(f'{stem}.*') if item.is_file() and not item.name.endswith('.part')]
            if len(files) != 1 or files[0].stat().st_size > 8 * 1024 * 1024:
                raise media.MediaError('Bounded audio sample was not produced')
            piece = files[0]
            try:
                _, count = inspect_source(piece)
                if not count:
                    raise media.MediaError('Sample has no audio track')
                return analyse_pcm(decode(piece, 0, length, speech_band), count)
            finally:
                piece.unlink(missing_ok=True)
        audible = []
        for location in locations:
            metrics, _, _ = sample(location, CANDIDATE_SECONDS, True)
            if metrics['activeFraction'] >= .15 and max(metrics['leftDb'], metrics['rightDb']) > -45:
                audible.append((metrics['activeFraction'], location))
        if not audible:
            return result('inconclusive', reason='no_audible_sample', candidates=len(locations))
        location = max(audible)[1]
        metrics, detected, duration = sample(location, SAMPLE_SECONDS)
        if metrics['activeFraction'] < .15:
            return result('inconclusive', reason='no_audible_sample', candidates=len(locations))
        return result('analysed', sample={'start': location, 'end': round(min(args.duration, location + duration), 3)},
                      candidates=len(locations), metrics=metrics, detected=detected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=media.youtube_id, required=True)
    parser.add_argument('--duration', type=media.seconds, required=True)
    parser.add_argument('--start', type=media.seconds, required=True)
    parser.add_argument('--end', type=media.seconds, required=True)
    parser.add_argument('--sample-start', type=media.seconds)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument('--file', type=Path)
    selection.add_argument('--youtube', action='store_true', help='Explicitly allow short source-audio downloads')
    args = parser.parse_args()
    try:
        output = check_audio(args)
    except (media.MediaError, OSError, ValueError, KeyError, TypeError):
        output = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'outcome': 'inconclusive',
                  'source': 'youtube' if args.youtube else 'local', 'candidates': 0, 'detected': [], 'reason': 'source_or_tool_error'}
    print(json.dumps(output, allow_nan=False))


if __name__ == '__main__':
    main()
