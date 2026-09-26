import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stringify } from 'yaml';
import { deriveOutline, isTitleCase } from '../scripts/outline-services';
import { flattenChapters, ServiceSourceSchema, SOURCE_CHANNEL_ID, type Service } from '../site/lib/archive';
import { assertMigrationPreserved, MIGRATION_NOTE, outlineLegacyMap, originalLegacy } from '../site/lib/internal-validation';
import { displayServices } from '../site/components/archive-display';
import OutlineRows from '../site/components/OutlineRows';
import ChapterResult from '../site/components/ChapterResult';

const source: Service = {
  id: 'fixture', date: '2026-01-04', title: 'Fixture Service', type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
  review_notes: [MIGRATION_NOTE], speakers: [], topics: [],
  videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, duration: 120, sequence: 1, workflow_status: 'complete', media_disposition: 'playable' }],
  chapters: [0, 1, 2].map(i => ({ id: `old-${i}`, video_id: 'AAAAAAAAAAA', start: i * 30, end: (i + 1) * 30, type: 'sermon',
    title: `Old title ${i}`, summary: `INTERNAL SYNOPSIS ${i}`, keywords: ['hope'], scripture: [], topics: [], confidence: 0.8, review_notes: ['Original boundary uncertainty'] })),
};
const plan = {
  service_id: source.id, sermon_description: 'The speaker connects hope with patient care for others.', review_notes: ['Metadata-only outline; review remains necessary.'],
  groups: [{ id: 'new-group', title: 'Hope Expressed Through Care', type: 'sermon', source_chapters: ['old-0', 'old-1', 'old-2'],
    summary: 'INTERNAL PARENT SYNOPSIS', keywords: ['hope'], cues: [{ source_id: 'old-1', title: 'Patient Care for Others', summary: 'INTERNAL CUE SYNOPSIS', keywords: ['hope'] }] }],
};
describe('concise service outlines', () => {
  it('derives bounds from contiguous originals, keeps a selective cue and does not mutate evidence', () => {
    const before = structuredClone(source), result = deriveOutline(source, plan);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0]).toMatchObject({ id: 'new-group', start: 0, end: 90, source_chapters: ['old-0', 'old-1', 'old-2'] });
    expect(result.chapters[1]).toMatchObject({ id: 'old-1', parent_id: 'new-group', start: 30, end: 60 });
    expect(result.editorial_status).toBe('needs_review'); expect(source).toEqual(before);
  });
  it('rejects missing/duplicated/reordered coverage, foreign cues, unsupported keywords and cross-upload grouping', () => {
    for (const ids of [['old-0'], ['old-0', 'old-0', 'old-2'], ['old-1', 'old-0', 'old-2']]) {
      expect(() => deriveOutline(source, { ...plan, groups: [{ ...plan.groups[0], source_chapters: ids }] })).toThrow('exactly once');
    }
    expect(() => deriveOutline(source, { ...plan, groups: [{ ...plan.groups[0], cues: [{ ...plan.groups[0].cues[0], source_id: 'other' }] }] })).toThrow('belong');
    expect(() => deriveOutline(source, { ...plan, groups: [{ ...plan.groups[0], keywords: ['unsupported'] }] }, new Map())).toThrow('spoken evidence');
    const crossed = structuredClone(source); crossed.chapters[2].video_id = 'BBBBBBBBBBB';
    expect(() => deriveOutline(crossed, plan)).toThrow('physical uploads');
  });
  it('requires same-video containment and one-level parents in canonical source validation', () => {
    const outlined = deriveOutline(source, plan);
    for (const parent_id of ['missing', 'old-1']) {
      const changed = structuredClone(outlined); changed.chapters[1].parent_id = parent_id;
      expect(ServiceSourceSchema.safeParse(changed).success).toBe(false);
    }
    outlined.chapters[1].end = 91;
    expect(ServiceSourceSchema.safeParse(outlined).success).toBe(false);
  });
  it('preserves all frozen original section fields internally while permitting new public group IDs/titles', () => {
    const { chapters, ...metadata } = source;
    const sections = chapters.map(({ summary: _summary, keywords: _keywords, scripture: _scripture, topics: _topics, ...section }) => section);
    const old = originalLegacy(stringify({ ...metadata, review_notes: [], sections, passages: chapters.map(({ keywords: _keywords, ...chapter }) => ({ ...chapter,
      id: `passage-${chapter.id}`, section_id: chapter.id, questions: [], transcript: 'Frozen original transcript.' })) }), 'fixture.yaml');
    const next = deriveOutline(source, plan), snapshot = stringify({ chapters });
    const internal = stringify({ passages: old.passages });
    expect(() => assertMigrationPreserved(old, stringify(next), internal, 'fixture.yaml', snapshot)).not.toThrow();
    const altered = structuredClone(chapters); altered[0].title = 'Rewritten Original';
    expect(() => assertMigrationPreserved(old, stringify(next), internal, 'fixture.yaml', stringify({ chapters: altered }))).toThrow('original section fields');
    expect(outlineLegacyMap(old, next.chapters)).toMatchObject({ 'old-0': 'new-group', 'old-2': 'new-group', 'passage-old-1': 'old-1' });
  });
  it('renders compact parent rows with optional cues and never renders internal synopses', () => {
    const outlined = deriveOutline(source, plan), index = flattenChapters([outlined], 'preview');
    const display = displayServices([outlined], index)[0];
    expect(display.sermonDescription).toBe(plan.sermon_description);
    expect(display.chapters.every(chapter => !('summary' in chapter) && !('source_chapters' in chapter))).toBe(true);
    const html = renderToStaticMarkup(createElement(OutlineRows, { service: display, base: '/review/' }));
    expect(html).toContain('Show 1 subsection in Hope Expressed Through Care'); expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('chapter-subsections'); expect(html).not.toContain('<details');
    expect(html).not.toContain('INTERNAL'); expect(html).not.toContain('Original boundary');
    const result = renderToStaticMarkup(createElement(ChapterResult, { chapter: index.find(chapter => chapter.parentId)!, base: '/review/' }));
    expect(result).toContain('Hope Expressed Through Care'); expect(result).not.toContain('INTERNAL');
  });
  it('validates Title Case without forcing small prepositions to capitals', () => {
    for (const title of ['Opening', 'Worship and Scripture', 'Serving God through Faith', 'Youth Choir: A New Hope']) expect(isTitleCase(title)).toBe(true);
    for (const title of ['opening', 'Worship and scripture', 'Serving God through faith']) expect(isTitleCase(title)).toBe(false);
  });
});
