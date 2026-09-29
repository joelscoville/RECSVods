import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { publicQuirks } from '../site/lib/video-quirks';
import { editServiceDocument, stringifyService } from '../site/lib/service-document';
import * as probes from '../scripts/probe-embeds';
import { embeddingAdditions, embeddingRemovalsToReview } from '../scripts/video-observations';
import { quirksCli } from '../scripts/video-quirks';
import { flattenChapters, loadArchive, ServiceSchema, VideoSchema, SOURCE_CHANNEL_ID } from '../site/lib/archive';
import { displayServices, homeItems } from '../site/components/archive-display';
import YouTubePlayer from '../site/components/YouTubePlayer';
import VideoQuirks from '../site/components/VideoQuirks';

const when = '2026-09-28T00:00:00Z';
const fixture = () => ServiceSchema.parse({ id: 'fixture', title: 'Fixture', date: '2026-09-20', type: 'service', workflow_status: 'complete', editorial_status: 'needs_review',
  videos: [{ id: 'AAAAAAAAAAA', channel_id: SOURCE_CHANNEL_ID, sequence: 1, duration: 180, workflow_status: 'complete', media_disposition: 'playable' }],
  chapters: [{ id: 'chapter', title: 'Chapter', summary: 'Example', keywords: [], topics: [], scripture: [], type: 'sermon', video_id: 'AAAAAAAAAAA', start: 10, end: 80 }] });
const roots: string[] = [];
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'recs-simple-quirks-')); roots.push(root);
  const file = path.join(root, 'services/2026/fixture/service.yaml'); mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringifyService(fixture())); return { root, file };
}
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); process.exitCode = undefined; });

describe('simple source quirks', () => {
  it('accepts human flags without dates, measurements or a separate catalog', () => {
    const video = { ...fixture().videos[0], quirks: ['embed_blocked', 'audio_choppy'] };
    expect(VideoSchema.parse(video).quirks).toEqual(['embed_blocked', 'audio_choppy']);
    expect(publicQuirks(['audio_left_only'])).toEqual([{ kind: 'audio_left_only' }]);
    for (const quirks of [['unknown'], ['embed_blocked', 'embed_blocked'], [{ kind: 'audio_choppy', checkedAt: when }]]) expect(VideoSchema.safeParse({ ...video, quirks }).success).toBe(false);
  });
  it('keeps flagged media in preview/search without changing publication approval', () => {
    const source = fixture(); source.videos[0].quirks = ['embed_blocked'];
    const chapters = flattenChapters([source], 'preview'), service = displayServices([source], chapters)[0];
    expect(service.videos[0].quirks).toEqual([{ kind: 'embed_blocked' }]);
    expect(homeItems([service], '/')[0].quirks).toEqual([{ kind: 'embed_blocked' }]);
    expect(chapters).toHaveLength(1); expect(flattenChapters([source], 'production')).toEqual([]);
  });
  it('flags and clears only the selected video, preserving source comments and clocks', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { root, file } = repo(), before = parse(readFileSync(file, 'utf8'));
    await quirksCli(['flag', '--video', 'AAAAAAAAAAA', '--kind', 'audio_choppy', '--note', 'Listen near 0:42'], root);
    const text = readFileSync(file, 'utf8'), flagged = parse(text);
    expect(text).toContain('# Listen near 0:42'); expect(text).toContain('start: "0:10"');
    expect(flagged.videos[0].quirks).toEqual(['audio_choppy']); delete flagged.videos[0].quirks;
    expect(flagged).toEqual(before);
    await quirksCli(['clear', '--video', 'AAAAAAAAAAA', '--kind', 'audio_choppy'], root);
    expect(parse(readFileSync(file, 'utf8'))).toEqual(before);
  });
  it('protects an in-progress human edit with a compare-and-swap', () => {
    const { root, file } = repo(), before = readFileSync(file, 'utf8'); writeFileSync(file, `# New human note\n${before}`);
    expect(() => editServiceDocument(root, fixture(), () => {}, before)).toThrow('changed');
    expect(readFileSync(file, 'utf8')).toBe(`# New human note\n${before}`);
  });
});

describe('checks are reports, not persistent quirk state machines', () => {
  it('only proposes hard restrictions as automatic additions', () => {
    expect(embeddingAdditions([], probes.classifyEmbedProbe({ code: 150 }, when))).toEqual(['embed_blocked']);
    expect(embeddingAdditions(['embed_blocked'], probes.classifyEmbedProbe({ code: 150 }, when))).toEqual([]);
    expect(embeddingAdditions([], probes.classifyEmbedProbe({ code: 100 }, when))).toEqual(['video_unavailable']);
    for (const code of [2, 5, 153]) expect(embeddingAdditions([], probes.classifyEmbedProbe({ code }, when))).toEqual([]);
    expect(embeddingAdditions(['audio_choppy'], probes.classifyEmbedProbe({}, when))).toEqual([]);
  });
  it('suggests checking obsolete flags but never infers that a short successful check clears human audio reports', () => {
    const observation = probes.classifyEmbedProbe({ advanced: true }, when);
    expect(embeddingAdditions(['embed_blocked', 'audio_choppy'], observation)).toEqual([]);
    expect(embeddingRemovalsToReview(['embed_blocked', 'audio_choppy'], observation)).toEqual(['embed_blocked']);
  });
  it('writes check details to docs and leaves metadata alone on an inconclusive result', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { root, file } = repo(), before = readFileSync(file, 'utf8');
    vi.spyOn(probes, 'probeEmbeds').mockResolvedValue([{ videoId: 'AAAAAAAAAAA', observation: probes.classifyEmbedProbe({ code: 153 }, when) }]);
    await quirksCli(['check-embeds', '--all', '--apply'], root);
    expect(readFileSync(file, 'utf8')).toBe(before);
    const report = readFileSync(path.join(root, 'docs/checks/fixture.md'), 'utf8');
    expect(report).toContain('inconclusive'); expect(report).toContain('153');
  });
  it('explicit --apply adds a restriction, and a later successful check does not silently remove it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { root, file } = repo();
    const probe = vi.spyOn(probes, 'probeEmbeds').mockResolvedValue([{ videoId: 'AAAAAAAAAAA', observation: probes.classifyEmbedProbe({ code: 150 }, when) }]);
    await quirksCli(['check-embeds', '--all', '--apply'], root);
    expect(loadArchive(root)[0].videos[0].quirks).toEqual(['embed_blocked']);
    const before = readFileSync(file, 'utf8');
    probe.mockResolvedValue([{ videoId: 'AAAAAAAAAAA', observation: probes.classifyEmbedProbe({ advanced: true }, when) }]);
    await quirksCli(['check-embeds', '--all', '--apply'], root);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readFileSync(path.join(root, 'docs/checks/fixture.md'), 'utf8')).toContain('Existing flags to review for removal | embed_blocked');
  });
  it('does not accept automatic application of sampled audio guesses', async () => {
    const { root, file } = repo(), before = readFileSync(file, 'utf8');
    await expect(quirksCli(['check-audio', '--video', 'AAAAAAAAAAA', '--youtube', '--apply'], root)).rejects.toThrow('Usage');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

it('renders a timestamped external flow and simple human recording notes', () => {
  const flags = publicQuirks(['embed_blocked', 'audio_left_only']);
  const html = renderToStaticMarkup(createElement(YouTubePlayer, { videoId: 'AAAAAAAAAAA', serviceId: 'fixture', title: 'Fixture', range: { id: 'chapter', start: 42.5 }, seekRequest: 0, onTime: () => {}, quirks: flags }));
  expect(html).toContain('youtube.com/watch?v=AAAAAAAAAAA&amp;t=42'); expect(html).toContain('Try embedded player'); expect(html).not.toContain('<iframe');
  const notes = renderToStaticMarkup(createElement(VideoQuirks, { quirks: flags }));
  expect(notes).toContain('Audio on the left only'); expect(notes).not.toMatch(/Checked|Reported|sample|measurement/);
});
