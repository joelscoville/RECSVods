import { readFileSync } from 'node:fs';
import type { SearchChapter } from '../../site/lib/types';

export const chapterMetadata = JSON.parse(readFileSync('dist/preview/generated/chapters.json', 'utf8'));
export const previewChapters = chapterMetadata.chapters as SearchChapter[];
const legacy = JSON.parse(readFileSync('dist/preview/generated/legacy-chapters.json', 'utf8')) as Record<string, string>;
export function chapterFor(id: string): SearchChapter {
  const chapter = previewChapters.find(chapter => chapter.id === id) ?? previewChapters.find(chapter => chapter.id === legacy[id]);
  if (!chapter) throw new Error(`Missing required chapter/legacy target: ${id}`);
  return chapter;
}
