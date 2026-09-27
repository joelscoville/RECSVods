#!/usr/bin/env python3
"""Bounded feed-to-issue discovery. No media, captions, interpretation or repository writes."""
import argparse
import datetime as dt
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

CHANNEL = 'UCLjwcZaIkiFEed1VgQYSsrw'
FEED = f'https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL}'
REPO = Path(__file__).resolve().parents[1]
NS = {'a': 'http://www.w3.org/2005/Atom', 'yt': 'http://www.youtube.com/xml/schemas/2015'}
MAX_BYTES = 2_000_000

class DiscoveryError(Exception):
    pass

def request(url, token=None, data=None, method=None):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'RECS-Replay-discovery',
               'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    payload = json.dumps(data).encode() if data is not None else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=payload, headers=headers, method=method), timeout=30) as response:
            body = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise DiscoveryError(f'Remote request failed: HTTP {error.code}; no source or issue changes inferred') from None
    except (OSError, ValueError):
        raise DiscoveryError('Remote request unavailable; retry the bounded discovery workflow later') from None
    if len(body) > MAX_BYTES:
        raise DiscoveryError('Remote response exceeded the discovery size bound')
    return body

def parse_feed(body):
    if len(body) > MAX_BYTES or b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():
        raise DiscoveryError('Unsupported or oversized feed')
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise DiscoveryError('Invalid public feed XML') from None
    # YouTube's feed-level ID can omit UC; entry-level IDs retain the full ID.
    if root.tag != f'{{{NS["a"]}}}feed' or root.findtext('yt:channelId', namespaces=NS) not in (CHANNEL, CHANNEL[2:]):
        raise DiscoveryError('Feed channel identity mismatch')
    result = {}
    entries = root.findall('a:entry', NS)
    if len(entries) > 100:
        raise DiscoveryError('Unexpected feed entry count')
    for entry in entries:
        video = entry.findtext('yt:videoId', namespaces=NS) or ''
        channel = entry.findtext('yt:channelId', namespaces=NS)
        published = entry.findtext('a:published', namespaces=NS) or ''
        title = entry.findtext('a:title', namespaces=NS) or ''
        try:
            date = dt.datetime.fromisoformat(published.replace('Z', '+00:00'))
        except ValueError:
            raise DiscoveryError('Invalid feed publication timestamp') from None
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video) or channel != CHANNEL or not date.tzinfo or not title.strip():
            raise DiscoveryError('Invalid feed identity or metadata')
        value = {'video_id': video, 'published_at': date.isoformat(), 'source_title': title.strip()[:300]}
        if video in result and result[video] != value:
            raise DiscoveryError('Conflicting duplicate feed ID')
        result[video] = value
    return sorted(result.values(), key=lambda item: (item['published_at'], item['video_id']))

def marker(video):
    return f'<!-- recs-discovery:{video} -->'

def managed_body(entry):
    title = html.escape(re.sub(r'[\x00-\x1f\x7f]', ' ', entry['source_title']), quote=False)
    title = re.sub(r'([\\`*_{}\[\]()#!|])', r'\\\1', title)
    video = entry['video_id']
    return '\n'.join([marker(video), '## Discovered RECS Upload',
        f'- Video: https://www.youtube.com/watch?v={video}', f'- Channel: `{CHANNEL}`',
        f'- Source title: {title}', f'- Feed publication time: `{entry["published_at"]}`',
        '- Discovery only: publication time is **not a verified service date**.',
        '- No media, captions, interpretation, editorial approval or publication was performed.',
        '', 'A person must invoke the repository curator skill for this ID, verify related uploads,',
        'and follow `docs/weekly-operation.md`. Keep this issue open until publication or explicit rejection.',
        '<!-- /recs-discovery -->'])

def plan_discovery(entries, known, issues):
    actions = []
    for entry in entries:
        video = entry['video_id']
        if video in known:
            continue
        matches = [issue for issue in issues if not issue.get('pull_request') and marker(video) in (issue.get('body') or '')]
        if len(matches) > 1:
            raise DiscoveryError('Duplicate curator issue markers require maintainer reconciliation')
        block = managed_body(entry)
        if not matches:
            actions.append({'action': 'create', 'video_id': video, 'title': f'Curate RECS upload {video}',
                            'body': block + '\n\n## Curator Notes\n\nAwaiting person-invoked source verification.\n'})
            continue
        issue = matches[0]
        if issue.get('state') == 'closed':
            continue  # Never reopen a human-closed issue or erase a rejection.
        body = issue.get('body') or ''
        start = body.index(marker(video))
        end = body.find('<!-- /recs-discovery -->', start)
        if end < 0:
            raise DiscoveryError('Existing issue lacks a complete managed block; preserve it for human repair')
        updated = body[:start] + block + body[end + len('<!-- /recs-discovery -->'):]
        if updated != body:
            actions.append({'action': 'update', 'video_id': video, 'number': issue['number'], 'body': updated})
    return actions

def issue_inventory(repository, token, fetch=request):
    issues = []
    for page in range(1, 101):
        batch = json.loads(fetch(f'https://api.github.com/repos/{repository}/issues?state=all&per_page=100&page={page}', token))
        if not isinstance(batch, list):
            raise DiscoveryError('Invalid issue inventory')
        issues.extend(batch)
        if len(batch) < 100:
            return issues
    raise DiscoveryError('Issue pagination bound reached; refusing incomplete deduplication')

def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == '--':
        del argv[0]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--repository', default=os.environ.get('GITHUB_REPOSITORY'))
    parser.add_argument('--feed-file', type=Path, help='Offline dry-run fixture only')
    parser.add_argument('--issues-file', type=Path, help='Offline dry-run fixture only')
    args = parser.parse_args(argv)
    if args.apply and (args.feed_file or args.issues_file):
        raise DiscoveryError('Offline fixtures cannot write live issues')
    token = os.environ.get('GITHUB_TOKEN')
    if args.repository and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+', args.repository)
                            or args.repository.split('/')[1] in ('.', '..')):
        raise DiscoveryError('Invalid repository identity')
    if args.apply and (not args.repository or not token):
        raise DiscoveryError('Issue writes require the explicit apply flag and workflow repository/token')
    entries = parse_feed(args.feed_file.read_bytes() if args.feed_file else request(FEED))
    completed = subprocess.run(['pnpm', 'exec', 'tsx', 'scripts/discovery-inventory.ts'], cwd=REPO,
                               capture_output=True, text=True, timeout=45, check=False)
    if completed.returncode:
        raise DiscoveryError('Archive inventory validation failed; no issue writes attempted')
    known = set(json.loads(completed.stdout))
    issues = json.loads(args.issues_file.read_text()) if args.issues_file else issue_inventory(args.repository, token) if args.repository and token else []
    if args.apply:
        # Serialized workflow runs plus a fresh all-state inventory prevent ordinary duplicate races.
        issues = issue_inventory(args.repository, token)
    actions = plan_discovery(entries, known, issues)
    for action in actions if args.apply else []:
        if action['action'] == 'create':
            request(f'https://api.github.com/repos/{args.repository}/issues', token,
                    {'title': action['title'], 'body': action['body']}, 'POST')
        else:
            request(f'https://api.github.com/repos/{args.repository}/issues/{action["number"]}', token,
                    {'body': action['body']}, 'PATCH')
    print(json.dumps({'applied': args.apply, 'feed_entries': len(entries), 'known_ids': len(known),
                      'issue_inventory_checked': bool(args.issues_file or args.repository and token),
                      'actions': [{'action': item['action'], 'video_id': item['video_id']} for item in actions]}, indent=2))
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (DiscoveryError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f'discovery: {error if isinstance(error, DiscoveryError) else "local inventory or response validation failed"}', file=sys.stderr)
        sys.exit(1)
