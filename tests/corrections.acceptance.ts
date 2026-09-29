import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadArchive, publishedServices } from '../site/lib/archive';
import { loadCorrectionConfig } from '../site/lib/source-links';

it('uses the operator-configured project destination in ordinary builds', () => {
  const repositoryUrl = 'https://github.com/example/renamed-archive';
  expect(loadCorrectionConfig(process.cwd(), {}).repositoryUrl).toBe('https://github.com/joelscoville/RECSVods');
  expect(loadCorrectionConfig(process.cwd(), { PUBLIC_REPOSITORY_URL: repositoryUrl }).repositoryUrl).toBe(repositoryUrl);
});

// Explicit built-artifact lane: missing output fails rather than silently skipping.
it('verifies one service suggestion per built page and build-only configuration exclusion', () => {
  const root = process.cwd(), output = path.join(root, 'dist/preview');
  const build = JSON.parse(readFileSync(path.join(output, 'build-mode.json'), 'utf8')) as { mode: string; base: string };
  expect(build).toEqual({ mode: 'preview', base: '/replay-check/' });
  const services = publishedServices(loadArchive(root), 'preview');
  expect(services.length).toBeGreaterThan(0);
  const data = loadCorrectionConfig(root, { ...process.env, ARCHIVE_MODE: 'preview' });
  for (const service of services) {
    const html = readFileSync(path.join(output, 'services', service.id, 'index.html'), 'utf8');
    const suggestions = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter(match => match[2].startsWith('Suggest a correction'));
    expect(suggestions).toHaveLength(1); expect(html).not.toContain('Edit this transcript');
    const attributes = suggestions[0][1];
    expect(attributes).toMatch(/\brel="noreferrer"/); expect(attributes).toMatch(/\breferrerpolicy="no-referrer"/i);
    const url = new URL(/\bhref="([^"]+)"/.exec(attributes)![1].replaceAll('&amp;', '&'));
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('service-id')).toBe(service.id);
    expect(url.searchParams.get('page')).toBe(`${build.base}services/${service.id}/`);
    expect(url.searchParams.get('chapter-id')).toBe('Not selected (whole recording/service)');
    expect(url.searchParams.get('video-id')).toBe(service.videos.map(video => video.id).join(', '));
    expect(url.searchParams.get('body')).toContain(`### service-id\n${service.id}`);
  }
  expect(Object.keys(data.chapters)).toHaveLength(services.reduce((sum, service) => sum + service.chapters.length, 0));
  const chunks = readdirSync(path.join(output, '_astro')).filter(file => file.endsWith('.js'));
  expect(chunks.length).toBeGreaterThan(0);
  for (const file of chunks) {
    const code = readFileSync(path.join(output, '_astro', file), 'utf8');
    expect(code.match(/__RECS_CORRECTIONS__|node:child_process|execFileSync|readFileSync/), file).toBeNull();
    // The pinned Transformers worker contains webpack's "node:fs (ignored)" comments.
    // Application chunks must not carry even that Node dependency; never dump entire bundles on failure.
    if (!file.startsWith('semantic.worker-')) expect(code.match(/node:fs/), file).toBeNull();
  }
});
