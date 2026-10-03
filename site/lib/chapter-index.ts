/** Browser-safe chapter artifacts. Metadata loading never waits for BSB or the model. */
import { z } from 'zod';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors } from './chapter-vectors';
import { parseScriptureReference } from './scripture';
import type { SearchUnit } from './display';
import { artifactSha256 } from './integrity';

/** The public search data: one row per unit, in the same order as the vector rows. */
export interface ChapterMetadata {
  schemaVersion: 6;
  model: typeof CHAPTER_VECTOR_CONFIG;
  vectors: { file: string; sha256: string };
  units: SearchUnit[];
}
export interface ScriptureIndex {
  schemaVersion: 1;
  references: Record<string, string[]>;
  verses: Record<string, string>;
}
export type ChapterVectors = ReturnType<typeof decodeChapterVectors>;

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_/-]*$/);
const text = z.string().trim().min(1);
const reference = text.refine((value) => parseScriptureReference(value)?.canonical === value);
/** Deliberately excludes even the optional browser-only verseText property. */
export const PublicUnitSchema = z.object({
  id, recordingId: id, recordingTitle: text, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['recording', 'chapter', 'subchapter', 'point']), title: text, text: text.optional(), entryId: id.optional(),
  start: z.number().finite().nonnegative(), end: z.number().finite().positive().optional(),
  scripture: z.array(reference), scriptureDisplay: z.array(text).optional(), topics: z.array(text),
  series: z.object({ id, title: text }).strict().optional(), preview: z.boolean(),
}).strict().superRefine((unit, ctx) => {
  if (unit.kind === 'point' ? unit.end !== undefined : unit.end === undefined || unit.end <= unit.start) ctx.addIssue({ code: 'custom', message: 'Points have a time only; chapters require valid start and end times' });
  if (unit.scriptureDisplay && (unit.scriptureDisplay.length !== unit.scripture.length
    || unit.scriptureDisplay.some((value, i) => parseScriptureReference(value)?.canonical !== unit.scripture[i]))) {
    ctx.addIssue({ code: 'custom', message: 'Scripture display references must align' });
  }
});

/** Key order is immaterial; additional model keys are rejected. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length
    && Object.keys(aa).every((key) => Object.hasOwn(bb, key) && sameJson(aa[key], bb[key]));
}

export function parseChapterMetadata(value: unknown): ChapterMetadata {
  const data = z.object({ schemaVersion: z.literal(6), model: z.unknown(),
    vectors: z.object({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    units: z.array(PublicUnitSchema) }).strict().parse(value);
  if (data.vectors.file !== `vectors.${data.vectors.sha256}.bin`) throw new Error('Invalid vector asset identity');
  if (!sameJson(data.model, CHAPTER_VECTOR_CONFIG)) throw new Error('Incompatible chapter vector model');
  if (new Set(data.units.map((unit) => unit.id)).size !== data.units.length) throw new Error('Duplicate search unit ID');
  return { ...data, model: CHAPTER_VECTOR_CONFIG };
}

export function parseScriptureIndex(value: unknown): ScriptureIndex {
  const data = z.object({ schemaVersion: z.literal(1), references: z.record(z.string(), z.array(z.string())),
    verses: z.record(z.string(), z.string()) }).strict().parse(value);
  const used = new Set<string>();
  for (const [ref, keys] of Object.entries(data.references)) {
    if (parseScriptureReference(ref)?.canonical !== ref || new Set(keys).size !== keys.length) throw new Error('Invalid scripture reference mapping');
    for (const key of keys) {
      const parsed = parseScriptureReference(key);
      if (!parsed || parsed.canonical !== key || !/^.+ \d+:\d+$/.test(key) || !Object.hasOwn(data.verses, key)) {
        throw new Error('Invalid or missing BSB verse key');
      }
      used.add(key);
    }
  }
  if (Object.keys(data.verses).some((key) => !used.has(key))) throw new Error('Unreferenced BSB verse');
  return data;
}

function artifactUrl(base: string, name: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}generated/${name}`;
}

/** Static hosts may send .gz as raw bytes OR decode it using Content-Encoding.
 * Sniff bytes, not headers, to avoid double-decompression. Older browsers use raw files.
 */
async function loadArtifact<T>(base: string, name: string, decode: (bytes: Uint8Array) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const fetchBytes = async (filename: string) => {
    const response = await fetch(artifactUrl(base, filename), { signal });
    if (!response.ok) throw new Error(`Unable to load ${filename}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const bytes = await fetchBytes(`${name}.gz`);
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return await decode(bytes);
      const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await decode(new Uint8Array(await new Response(stream).arrayBuffer()));
    } catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
      // A missing/corrupt gzip companion must not disable ordinary static hosting.
    }
  }
  return decode(await fetchBytes(name));
}
async function loadJson<T>(base: string, name: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  return loadArtifact(base, name, (bytes) => parse(JSON.parse(new TextDecoder().decode(bytes))), signal);
}

export async function loadChapterMetadata(base: string, signal?: AbortSignal): Promise<ChapterMetadata> {
  return loadJson(base, 'chapters.json', parseChapterMetadata, signal);
}
export async function loadScriptureIndex(base: string, signal?: AbortSignal): Promise<ScriptureIndex> {
  return loadJson(base, 'scripture.json', parseScriptureIndex, signal);
}
/** Returns copies; hidden BSB search text must never be displayed as ESV or reserialized. */
export function enrichUnits(units: readonly SearchUnit[], scripture: ScriptureIndex): SearchUnit[] {
  return units.map((unit) => {
    const { verseText: _previous, ...metadata } = unit;
    const keys = new Set(unit.scripture.flatMap((ref) => scripture.references[parseScriptureReference(ref)?.canonical ?? ref] ?? []));
    const verseText = [...keys].map((key) => scripture.verses[key]).filter(Boolean).join('\n');
    return { ...metadata, ...(verseText ? { verseText } : {}) };
  });
}
export async function loadChapterVectors(base: string, metadata: ChapterMetadata, signal?: AbortSignal): Promise<ChapterVectors> {
  // Validate even direct callers: neither paths nor a same-sized binary can override identity.
  parseChapterMetadata(metadata);
  return loadArtifact(base, metadata.vectors.file, async (bytes) => {
    const hash = await artifactSha256(bytes);
    if (hash !== metadata.vectors.sha256) throw new Error('Chapter vector checksum mismatch');
    const index = decodeChapterVectors(bytes);
    if (index.rowCount !== metadata.units.length) throw new Error('Chapter vector row mismatch');
    return index;
  }, signal);
}
