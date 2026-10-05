import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadRecordings } from '../site/lib/recordings';
import { displayRecordings, searchUnits } from '../site/lib/display';
import { groupByRecording, homeItems } from '../site/components/archive-display';
import { prepareSearchIndex, search } from '../site/lib/search';
import { formatDate } from '../site/lib/urls';
import VideoCard from '../site/components/VideoCard';
import { display, source, stored } from './recording-fixtures';

const archive = loadRecordings();

describe('consistent public recording titles', () => {
  it('uses the file’s title across the real catalogue, cards and search', () => {
    const recordings = displayRecordings(archive.recordings, archive.topics, archive.series), cards = homeItems(recordings, '/');
    expect(recordings.length).toBeGreaterThan(0);
    for (const recording of recordings) {
      const file = archive.recordings.find(item => item.recordingId === recording.id)!;
      expect(recording.title).toBe(file.recordingTitle);
      expect(cards.find(card => card.recordingId === recording.id)?.title).toBe(recording.title);
      expect(searchUnits([recording]).every(unit => unit.recordingTitle === recording.title)).toBe(true);
      // Unreviewed drafts may keep the dated source title until the sermon title is verified.
      // Published recordings must always use a sermon title.
      if (file.status === 'draft' && recording.title === `RECS ${formatDate(file.serviceDate)}`) {
        expect(file.markers?.some(marker => /confirm.*title/i.test(marker.markerNote ?? ''))).toBe(true);
      } else {
        expect(recording.title, `${recording.id} (${file.status})`).not.toMatch(/\bRECS\b|\b20\d{2}\b/);
      }
    }
    for (const [id, title] of [['2026-06-21', 'The Third Person'], ['2026-08-09', 'We, the Citizens…'], ['2026-07-12', 'To Be Nothing']]) {
      expect(recordings.find(item => item.id === id)?.title).toBe(title);
    }
  });
  it('searches the same title shown on the card', () => {
    const recordings = display([stored({ recordingTitle: 'Zircon Lantern' })]);
    const results = groupByRecording(search(searchUnits(recordings), 'Zircon Lantern'), homeItems(recordings, '/'), '/');
    expect(results).toHaveLength(1);
    expect(results[0].recording.title).toBe('Zircon Lantern');
  });
  it('names the sermon chapter by the recording title and the others by the liturgy', () => {
    const [recording] = display();
    expect(recording.entries.filter(entry => entry.kind === 'chapter').map(entry => entry.title)).toEqual(['ACTS Prayer', 'Opening and Scripture', 'Serving Our Neighbours', 'Response and Closing']);
    const [acts, opening, , closing] = source().chapters;
    const [noSermon] = display([stored({ chapters: [acts, opening, closing], sermonDescription: undefined, sermonScripture: undefined, sermonTopics: undefined })]);
    expect(homeItems([noSermon], '/')[0]).toMatchObject({ hasSermon: false, start: 0 });
  });
  it('keeps point-specific matches when their words also occur in the recording title', () => {
    const [recording] = display([stored({ recordingTitle: 'Orchard Harvest' })]);
    const units = searchUnits([recording]).map((unit, i) => i === 1 ? { ...unit, text: 'The orchard harvest and its seasonal fruit yields.' } : unit);
    const query = 'orchard harvest seasonal fruit yields';
    expect(search(units, query).map(result => result.unit.id)).toEqual([units[1].id]);
    expect(prepareSearchIndex(units).search(query).map(result => result.unit.id)).toEqual([units[1].id]);
  });
  it('uses one date style for the thumbnail and the metadata underneath it', () => {
    const [card] = homeItems(display([stored({ serviceDate: '2026-06-21' }, '2026-06-21')]), '/');
    expect(formatDate('2026-06-21')).toBe('21 June 2026');
    const html = renderToStaticMarkup(createElement(VideoCard, { item: card }));
    expect(html).toContain('<span class="thumb-date">21 June 2026</span>');
    expect(html).toContain('<time dateTime="2026-06-21">21 June 2026</time>');
  });
});
