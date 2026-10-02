import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { loadRecordings } from '../site/lib/recordings';
import { loadCorrectionConfig } from '../site/lib/source-links';

it('uses the operator-configured project destination in ordinary builds', () => {
  const repositoryUrl = 'https://github.com/example/renamed-archive';
  expect(loadCorrectionConfig(process.cwd(), {}).repositoryUrl).toBe('https://github.com/joelscoville/RECSVods');
  expect(loadCorrectionConfig(process.cwd(), { PUBLIC_REPOSITORY_URL: repositoryUrl }).repositoryUrl).toBe(repositoryUrl);
});

// Explicit built-artifact lane: missing output fails rather than silently skipping.
it('verifies one Suggest a change link per built recording page and no build-only code in the bundle', () => {
  const root = process.cwd(), output = path.join(root, 'dist/preview');
  const build = JSON.parse(readFileSync(path.join(output, 'build-mode.json'), 'utf8')) as { mode: string; base: string };
  expect(build).toEqual({ mode: 'preview', base: '/replay-check/' });
  const { recordings } = loadRecordings(root);
  expect(recordings.length).toBeGreaterThan(0);
  for (const { recordingId } of recordings) {
    const html = readFileSync(path.join(output, 'services', recordingId, 'index.html'), 'utf8');
    // One correction control per page: Suggest a change, opening the editor for this recording.
    const suggestions = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter(match => match[2].startsWith('Suggest a change'));
    expect(suggestions).toHaveLength(1); expect(html).not.toMatch(/Report a problem|Edit this transcript/);
    expect(/\bhref="([^"]+)"/.exec(suggestions[0][1])![1]).toBe(`${build.base}edit/${recordingId}/`);
  }
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
