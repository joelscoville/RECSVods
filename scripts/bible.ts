import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BIBLE_BOOKS, canonicalBook } from '../bible/books';
import provenance from '../bible/provenance.json';

const BIBLE_ROOT = fileURLToPath(new URL('../bible/', import.meta.url));
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export type BibleText = Record<string, string[][]>;
export function verifyBibleSource(bytes: Uint8Array): void {
  if (bytes.length !== provenance.bytes || hash(bytes) !== provenance.sha256) {
    throw new Error('BSB source integrity mismatch; review the official source and deliberately update bible/provenance.json');
  }
}

/** Source lines are reference TAB text. Reject gaps, duplicates and unexpected rows. */
export function parseBibleSource(source: string): BibleText {
  const lines = source.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const header = lines.indexOf('Verse\tBerean Standard Bible');
  if (header !== 2) throw new Error('Unexpected BSB source header');
  const bible: BibleText = {};
  let previousBook = -1;
  for (const line of lines.slice(header + 1)) {
    const match = /^(.*?) ([1-9]\d*):([1-9]\d*)\t([^\t]*)$/.exec(line);
    if (!match) throw new Error(`Invalid BSB source row: ${line.slice(0, 80)}`);
    const book = canonicalBook(match[1]);
    const index = BIBLE_BOOKS.indexOf(book as typeof BIBLE_BOOKS[number]);
    if (!book || index < previousBook || index > previousBook + 1) throw new Error('Unexpected BSB book order');
    previousBook = index;
    const chapter = Number(match[2]);
    const verse = Number(match[3]);
    const chapters = bible[book] ??= [];
    if (chapter > chapters.length + 1 || chapter < chapters.length) throw new Error(`BSB chapter gap: ${match[0]}`);
    const verses = chapters[chapter - 1] ??= [];
    if (verse !== verses.length + 1) throw new Error(`BSB verse gap: ${match[0]}`);
    verses.push(match[4]);
  }
  if (Object.keys(bible).length !== 66) throw new Error('BSB must contain all 66 books');
  return bible;
}

export function loadBible(directory = BIBLE_ROOT): BibleText {
  const bytes = readFileSync(path.join(directory, 'bsb.txt'));
  verifyBibleSource(bytes);
  return parseBibleSource(bytes.toString('utf8'));
}

export function generateBibleCounts(check = false): void {
  const bible = loadBible();
  const counts = Object.fromEntries(Object.entries(bible).map(([book, chapters]) => [book, chapters.map((verses) => verses.length)]));
  const output = `${JSON.stringify(counts, null, 2)}\n`;
  const filename = path.join(BIBLE_ROOT, 'verse-counts.json');
  if (check) {
    if (readFileSync(filename, 'utf8') !== output) throw new Error('BSB verse counts are stale; run scripts/bible.ts generate');
  } else writeFileSync(filename, output);
}

/** Explicit source acquisition; normal builds are offline. */
async function download(): Promise<void> {
  const response = await fetch(provenance.sourceUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`BSB download: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyBibleSource(bytes);
  parseBibleSource(bytes.toString('utf8'));
  mkdirSync(BIBLE_ROOT, { recursive: true });
  writeFileSync(path.join(BIBLE_ROOT, 'bsb.txt'), bytes);
  generateBibleCounts();
  console.log(`Verified BSB: ${bytes.length} bytes, SHA-256 ${hash(bytes)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    if (args.length !== 1 || !['download', 'generate', 'verify'].includes(args[0])) throw new Error('Usage: tsx scripts/bible.ts download | generate | verify');
    if (args[0] === 'download') await download();
    else { generateBibleCounts(args[0] === 'verify'); console.log(`BSB ${args[0]} complete`); }
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
