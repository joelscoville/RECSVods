import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { flattenChapters, loadArchive, publishedServices } from '../site/lib/archive';
import { displayServices, homeItems, groupByRecording } from '../site/components/archive-display';
import { recordingTitle } from '../site/lib/recording-title';
import { prepareSearchIndex, search } from '../site/lib/search';
import { formatDate } from '../site/lib/urls';
import VideoCard from '../site/components/VideoCard';

const archive = loadArchive();

describe('consistent public recording titles', () => {
  it('uses the named title across the real catalogue and chapter search metadata', () => {
    const sources = publishedServices(archive, 'preview');
    const chapters = flattenChapters(sources, 'preview');
    const displayed = displayServices(sources, chapters), cards = homeItems(displayed, '/');
    expect(displayed.length).toBeGreaterThan(0);
    for (const service of displayed) {
      const source = sources.find(item => item.id === service.id)!;
      expect(service.title).toBe(source.title);
      expect(source).not.toHaveProperty('sermon_title');
      expect(cards.find(card => card.serviceId === service.id)?.title).toBe(service.title);
      expect(service.chapters.every(chapter => chapter.serviceTitle === service.title)).toBe(true);
      expect(chapters.filter(chapter => chapter.serviceId === service.id).every(chapter => chapter.serviceTitle === service.title)).toBe(true);
      expect(service.title).not.toMatch(/\bRECS\b|\b20\d{2}\b/);
    }
    expect(displayed.find(service => service.id === '2026-06-21')?.title).toBe('The Third Person');
  });

  it('searches the same canonical title shown on the card', () => {
    const source = structuredClone(archive[0]);
    source.title = 'Zircon Lantern';
    const chapters = flattenChapters([source], 'preview');
    const cards = homeItems(displayServices([source], chapters), '/');
    const results = groupByRecording(search(chapters, 'Zircon Lantern'), cards, '/');
    expect(results).toHaveLength(1);
    expect(results[0].recording.title).toBe('Zircon Lantern');
    expect(results[0].chapter.serviceTitle).toBe('Zircon Lantern');
    expect(source.title).toBe('Zircon Lantern');
  });

  it('does not substitute a chapter title when the recording has no named sermon', () => {
    const source = structuredClone(archive[0]);
    source.title = 'Evening Prayer';
    const chapters = flattenChapters([source], 'preview');
    const displayed = displayServices([source], chapters);
    expect(homeItems(displayed, '/')[0].title).toBe('Evening Prayer');
    expect(displayed[0].title).toBe('Evening Prayer');
    expect(chapters.every(chapter => chapter.serviceTitle === 'Evening Prayer')).toBe(true);
  });

  it('keeps chapter-specific matches when their words also occur in a shared recording title', () => {
    const fixture = flattenChapters([archive[0]], 'preview')[0];
    const chapters = Array.from({ length: 40 }, (_, index) => ({ ...fixture, id: `chapter-${index}`,
      serviceTitle: 'Orchard Harvest', title: 'Notices', summary: 'Weekly announcements.',
      keywords: index === 0 ? ['orchard', 'harvest'] : [], topics: [], scripture: [],
    }));
    const query = 'orchard harvest seasonal fruit yields';
    expect(search(chapters, query).map(result => result.chapter.id)).toEqual(['chapter-0']);
    expect(prepareSearchIndex(chapters).search(query).map(result => result.chapter.id)).toEqual(['chapter-0']);
  });

  it('normalizes whitespace without rewriting meaningful title text or acronyms', () => {
    expect(recordingTitle({ title: '  21 Days of Prayer\n and NASA  ' })).toBe('21 Days of Prayer and NASA');
    expect(recordingTitle({ title: 'Evening\tPrayer' })).toBe('Evening Prayer');
  });

  it('keeps supplied title casing and ellipsis typography consistent', () => {
    for (const [id, title] of [
      ['2026-08-09', 'We, the Citizens…'], ['2026-07-26', 'To Be Hated'],
      ['2026-07-12', 'To Be Nothing'], ['2026-06-28', 'Teaching Us All Things…'],
    ]) expect(recordingTitle(archive.find(service => service.id === id)!)).toBe(title);
  });

  it('uses one date style for the thumbnail and the metadata underneath it', () => {
    const source = archive.find(service => service.id === '2026-06-21')!;
    const card = homeItems(displayServices([source], flattenChapters([source], 'preview')), '/')[0];
    expect(formatDate(source.date)).toBe('21 June 2026');
    const html = renderToStaticMarkup(createElement(VideoCard, { item: card }));
    expect(html).toContain('<span class="thumb-date">21 June 2026</span>');
    expect(html).toContain('<time dateTime="2026-06-21">21 June 2026</time>');
    expect(html).not.toContain('June 21, 2026');
  });
});
