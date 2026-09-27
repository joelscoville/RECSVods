import json
import unittest
from scripts import discover

VIDEO = 'ABCDEFGHIJK'

def feed(entries='', channel=discover.CHANNEL):
    return f'<feed xmlns="{discover.NS["a"]}" xmlns:yt="{discover.NS["yt"]}"><yt:channelId>{channel}</yt:channelId>{entries}</feed>'.encode()

def entry(video=VIDEO, title='A source title', channel=discover.CHANNEL):
    return f'<entry><yt:videoId>{video}</yt:videoId><yt:channelId>{channel}</yt:channelId><title>{title}</title><published>2026-09-20T01:00:00Z</published></entry>'

class DiscoveryTests(unittest.TestCase):
    def test_channel_identity_and_duplicate_validation(self):
        self.assertEqual(len(discover.parse_feed(feed(entry() + entry()))), 1)
        self.assertEqual(len(discover.parse_feed(feed(entry(), discover.CHANNEL[2:]))), 1)
        for data in (feed(entry(), 'other'), feed(entry(channel='other')), feed(entry('wrong')),
                     feed(entry() + entry(title='conflict')), b'<!DOCTYPE feed><feed/>', b'not xml'):
            with self.assertRaises(discover.DiscoveryError):
                discover.parse_feed(data)

    def test_deduplicates_known_and_all_issue_states(self):
        rows = discover.parse_feed(feed(entry()))
        self.assertEqual(discover.plan_discovery(rows, {VIDEO}, []), [])
        action = discover.plan_discovery(rows, set(), [])[0]
        issue = {'number': 1, 'state': 'open', 'body': action['body']}
        self.assertEqual(discover.plan_discovery(rows, set(), [issue]), [])
        self.assertEqual(discover.plan_discovery(rows, set(), [{**issue, 'state': 'closed'}]), [])
        with self.assertRaises(discover.DiscoveryError):
            discover.plan_discovery(rows, set(), [issue, {**issue, 'number': 2}])

    def test_updates_only_managed_metadata_and_preserves_human_notes(self):
        rows = discover.parse_feed(feed(entry()))
        body = discover.plan_discovery(rows, set(), [])[0]['body'] + '\nHuman timing notes and review discussion.\n'
        updated = discover.plan_discovery([{**rows[0], 'source_title': 'Corrected upload title'}], set(), [{'number': 7, 'state': 'open', 'body': body}])[0]
        self.assertEqual(updated['number'], 7)
        self.assertTrue(updated['body'].endswith('Human timing notes and review discussion.\n'))
        self.assertIn('not a verified service date', updated['body'])
        with self.assertRaises(discover.DiscoveryError):
            discover.plan_discovery(rows, set(), [{'number': 7, 'state': 'open', 'body': discover.marker(VIDEO)}])

    def test_source_titles_are_data_not_html_images_or_commands(self):
        rows = discover.parse_feed(feed(entry(title='&lt;img src="https://evil.test"&gt; ![x](https://evil.test)')))
        body = discover.plan_discovery(rows, set(), [])[0]['body']
        self.assertNotIn('<img', body)
        self.assertNotIn('![x](', body)
        self.assertIn(f'https://www.youtube.com/watch?v={VIDEO}', body)

    def test_issue_pagination_includes_closed_records_and_is_bounded(self):
        calls = []
        def fetch(url, token):
            calls.append(url)
            return json.dumps([{'number': n} for n in range(100)] if url.endswith('&page=1') else []).encode()
        self.assertEqual(len(discover.issue_inventory('owner/repo', 'fixture', fetch)), 100)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all('state=all' in url for url in calls))
        with self.assertRaises(discover.DiscoveryError):
            discover.issue_inventory('owner/repo', 'fixture', lambda *_: json.dumps([{}] * 100).encode())

    def test_fixtures_cannot_write_live_issues(self):
        with self.assertRaises(discover.DiscoveryError):
            discover.main(['--apply', '--feed-file', 'synthetic.xml'])

if __name__ == '__main__':
    unittest.main()
