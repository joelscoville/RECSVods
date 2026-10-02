/** Search vectors, built during the site build from the published text of each search unit: its title,
 * summary, topics, and the BSB text of the passages it cites. Nothing private is read. Results are cached by
 * text, so a build only embeds what changed. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHAPTER_VECTOR_CONFIG } from '../site/lib/chapter-vectors';
import { isEmbeddingVector } from '../site/lib/embedding-config';
import type { ScriptureIndex } from '../site/lib/chapter-index';
import type { SearchUnit } from '../site/lib/display';
import { parseScriptureReference } from '../site/lib/scripture';
import { createEmbeddingSession, privateDirectory } from './embeddings';

/** The words a unit is about. A recording also carries its passages' BSB text. */
export function unitText(unit: SearchUnit, scripture?: ScriptureIndex): string {
  const verses = scripture ? [...new Set(unit.scripture.flatMap(ref => scripture.references[parseScriptureReference(ref)?.canonical ?? ref] ?? []))]
    .map(key => scripture.verses[key]).filter(Boolean) : [];
  return [unit.title, unit.text, unit.topics.join(', '), unit.scripture.join('; '), ...verses].filter(Boolean).join('. ');
}

export function tokenWindows(contentIds: readonly number[]): number[][] {
  const { contentTokens, overlapTokens } = CHAPTER_VECTOR_CONFIG.windowing;
  const windows: number[][] = [];
  for (let start = 0; start < contentIds.length; start += contentTokens - overlapTokens) {
    windows.push(contentIds.slice(start, start + contentTokens));
    if (start + contentTokens >= contentIds.length) break;
  }
  return windows;
}
export function averageWindows(vectors: readonly number[][]): number[] {
  const average = new Array<number>(CHAPTER_VECTOR_CONFIG.dimension).fill(0);
  for (const vector of vectors) {
    if (!isEmbeddingVector(vector)) throw new Error('Invalid normalized window vector');
    for (let i = 0; i < average.length; i++) average[i] += vector[i] / vectors.length;
  }
  const norm = Math.sqrt(average.reduce((sum, v) => sum + v * v, 0));
  return norm ? average.map(v => v / norm) : average;
}
export function quantize(vector: ArrayLike<number>): Int8Array {
  if (Array.from(vector).some(value => !Number.isFinite(value))) throw new Error('Cannot quantize a non-finite vector');
  let max = 0;
  for (let i = 0; i < vector.length; i++) max = Math.max(max, Math.abs(vector[i]));
  if (!max) return new Int8Array(vector.length);
  return Int8Array.from(Array.from(vector, v => Math.sign(v) * Math.min(127, Math.floor(Math.abs(v) / max * 127 + 0.5))));
}

/** One int8 row per unit, in order. Cached in .local/search-vectors by model and text. */
export async function searchVectorRows(root: string, units: readonly SearchUnit[], scripture: ScriptureIndex): Promise<Int8Array[]> {
  if (!units.length) return [];
  const cache = await privateDirectory(root, ['search-vectors']);
  const recipe = JSON.stringify(CHAPTER_VECTOR_CONFIG);
  const keyOf = (text: string) => createHash('sha256').update(recipe).update('\0').update(text).digest('hex');
  const texts = units.map(unit => unitText(unit, scripture));
  const rows: (Int8Array | undefined)[] = await Promise.all(texts.map(async text => {
    try { const bytes = await readFile(path.join(cache, `${keyOf(text)}.bin`)); return bytes.length === CHAPTER_VECTOR_CONFIG.dimension ? new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length).slice() : undefined; }
    catch { return undefined; }
  }));
  if (rows.some(row => !row)) {
    const session = await createEmbeddingSession(root);
    try {
      await mkdir(cache, { recursive: true });
      for (const [i, text] of texts.entries()) if (!rows[i]) {
        const windows = tokenWindows(session.tokenize(text));
        const vectors: number[][] = [];
        for (const window of windows) if (window.length) vectors.push(await session.embedTokenIds(window));
        const row = quantize(averageWindows(vectors));
        rows[i] = row;
        await writeFile(path.join(cache, `${keyOf(text)}.bin`), Buffer.from(row.buffer, row.byteOffset, row.byteLength));
      }
    } finally { await session.dispose(); }
  }
  return rows as Int8Array[];
}
