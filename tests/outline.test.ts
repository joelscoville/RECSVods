import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { flattenChapters, ServiceSourceSchema, SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { displayServices, groupByRecording, homeItems } from '../site/components/archive-display';
import OutlineRows from '../site/components/OutlineRows';
import RecordingResult from '../site/components/RecordingResult';

const source: Service = {
  id: 'fixture', date: '2026-01-04', title: 'Fixture Service', type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
  sermon_description: 'The speaker connects hope with patient care for others.', review_notes: [], speakers: [], topics: [],
  videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1, workflow_status: 'complete', media_disposition: 'playable' }],
  chapters: [
    { id: 'group', video_id: 'AAAAAAAAAAA', start: 0, end: 90, type: 'sermon', title: 'Hope Expressed Through Care', summary: 'INTERNAL PARENT SYNOPSIS', keywords: ['hope'], scripture: [], topics: [], review_notes: [] },
    { id: 'cue', parent_id: 'group', video_id: 'AAAAAAAAAAA', start: 30, end: 60, type: 'sermon', title: 'Patient Care for Others', summary: 'INTERNAL CUE SYNOPSIS', keywords: ['hope'], scripture: [], topics: [], review_notes: [] },
  ],
};
describe('current concise outline contract', () => {
  it('requires same-video containment and one-level parents', () => {
    expect(ServiceSourceSchema.safeParse(source).success).toBe(true);
    for (const change of [{ parent_id: 'missing' }, { parent_id: 'cue' }, { end: 91 }, { video_id: 'BBBBBBBBBBB' }]) {
      const changed = structuredClone(source); Object.assign(changed.chapters[1], change);
      expect(ServiceSourceSchema.safeParse(changed).success).toBe(false);
    }
  });
  it('renders compact expandable parent rows and excludes per-unit synopses', () => {
    const index = flattenChapters([source], 'preview'), display = displayServices([source], index)[0];
    expect(display.sermonDescription).toBe(source.sermon_description);
    expect(display.chapters.every(chapter => !('summary' in chapter) && !('source_chapters' in chapter))).toBe(true);
    const html = renderToStaticMarkup(createElement(OutlineRows, { service: display, base: '/review/' }));
    expect(html).toContain('Show Subsections'); expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('chapter-summary');
    expect(html).toContain('chapter-subsections'); expect(html).not.toContain('<details'); expect(html).not.toContain('INTERNAL');
    const [grouped] = groupByRecording([{ chapter: index[1] }], homeItems([display], '/review/'), '/review/');
    const result = renderToStaticMarkup(createElement(RecordingResult, { recording: grouped.recording, chapter: grouped.chapter }));
    expect(result).toContain('Hope Expressed Through Care'); expect(result).not.toContain('INTERNAL');
  });
  it('shows a public one-line summary on primary chapters only', () => {
    const outlined = structuredClone(source);
    outlined.chapters[0] = { ...outlined.chapters[0], short_summary: 'Hope shown through patient care.' };
    const display = displayServices([outlined], flattenChapters([outlined], 'preview'))[0];
    const html = renderToStaticMarkup(createElement(OutlineRows, { service: display, base: '/review/' }));
    expect(html).toContain('<span class="chapter-summary">Hope shown through patient care.</span>');
    expect(html.match(/chapter-summary/g)).toHaveLength(1);
    expect(html).not.toContain('INTERNAL');
    expect(ServiceSourceSchema.safeParse(outlined).success).toBe(true);
    const invalid = structuredClone(outlined);
    invalid.chapters[1] = { ...invalid.chapters[1], short_summary: 'Subsections never carry one.' };
    expect(ServiceSourceSchema.safeParse(invalid).success).toBe(false);
  });
});
