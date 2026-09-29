import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { SearchChapter } from '../../site/lib/types';
import type { Service, ServiceSource } from '../../site/lib/types';
import { parse } from 'yaml';
import { parseTimecode } from '../../site/lib/timecode';

/** Build validation checks the full schema; these browser fixtures just normalize source clocks. */
export function readServiceFixture(filename: string): Service {
  const source = parse(readFileSync(filename, 'utf8')) as ServiceSource;
  return { ...source, speakers: source.speakers ?? [], topics: source.topics ?? [], videos: source.videos.map(video => ({ ...video, duration: parseTimecode(video.duration) })),
    chapters: source.chapters.map(chapter => ({ ...chapter, start: parseTimecode(chapter.start), end: parseTimecode(chapter.end) })) };
}

export const chapterMetadata = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8'));
export const previewChapters = chapterMetadata.chapters as SearchChapter[];
const legacy = JSON.parse(readFileSync('dist/preview/generated/legacy-chapters.json', 'utf8')) as Record<string, string>;
export function chapterFor(id: string): SearchChapter {
  const chapter = previewChapters.find(chapter => chapter.id === id) ?? previewChapters.find(chapter => chapter.id === legacy[id]);
  if (!chapter) throw new Error(`Missing required chapter/legacy target: ${id}`);
  return chapter;
}

/** Where the player's stop falls after "Sermon only": the end of every consecutive top-level sermon
 * chapter around `chapter` in its upload (the archive divides a sermon into several chapters). */
export function sermonEnd(chapter: SearchChapter): number {
  const top = chapter.parentId ? previewChapters.find(item => item.id === chapter.parentId)! : chapter;
  const run = previewChapters.filter(item => item.videoId === top.videoId && !item.parentId).sort((a, b) => a.start - b.start);
  let last = run.findIndex(item => item.id === top.id);
  while (last < run.length - 1 && run[last + 1].type === 'sermon') last++;
  return run[last].end;
}

/** Clicks the under-player "Chapter only" / "Sermon only" choice and returns where playback will stop. */
export async function chooseOnly(page: Page, chapter: SearchChapter): Promise<number> {
  const button = page.locator('.chapter-controls').getByRole('button', { name: /^(Chapter|Sermon) only$/ });
  const label = await button.textContent();
  await button.click();
  return label === 'Sermon only' ? sermonEnd(chapter) : chapter.end;
}
