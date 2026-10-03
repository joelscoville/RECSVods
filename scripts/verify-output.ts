import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parse } from 'yaml';
import type { BuildMode } from '../site/lib/display';
import { decodeChapterVectors } from '../site/lib/chapter-vectors';
import { parseChapterMetadata, parseScriptureIndex, sameJson } from '../site/lib/chapter-index';
import { chapterArtifacts, CHAPTER_ARTIFACTS, artifactFilename, type VectorRows } from './archive';
import { EMBEDDING_CONFIG, MODEL_FILES } from '../site/lib/embedding-config';
import { verifyModelFile } from './embeddings';

export interface OutputPrivacyOptions {
  /** Defaults on. Reads the kept transcripts (transcripts/) ONLY in this verification step, if present. */
  deepTranscriptScan?: boolean;
  /** Makes the expected vector rows; tests pass their own instead of loading the model. */
  rows?: VectorRows;
}
export const TRANSCRIPT_SHINGLE_WORDS = 12;
export const TRANSCRIPT_SHINGLE_CHARACTERS = 64;
function normalizeText(text: string): string[] {
  return (text.replace(/\\u([a-f\d]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([a-f\d]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(?:x([a-f\d]+)|(\d+));/gi, (_, hex: string, decimal: string) => {
      const code = parseInt(hex || decimal, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/\\[nrt]/g, ' ').normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []);
}
function shingles(text: string): string[] {
  const words = normalizeText(text), result: string[] = [];
  for (let i = 0; i <= words.length - TRANSCRIPT_SHINGLE_WORDS; i++) {
    const shingle = words.slice(i, i + TRANSCRIPT_SHINGLE_WORDS).join(' ');
    if (shingle.length >= TRANSCRIPT_SHINGLE_CHARACTERS) result.push(shingle);
  }
  return result;
}

/** Short keywords are permitted. A twelve-word/64-character verbatim span is not metadata. */
export function assertNoTranscriptLeak(publicText: string, privateShingles: ReadonlySet<string>, filename: string): void {
  if (shingles(publicText).some((shingle) => privateShingles.has(shingle))) {
    throw new Error(`Private transcript shingle in output: ${filename}`);
  }
}

/** The kept transcripts (transcripts/<id>.yaml): no run of their words may appear in the built site. */
async function privateTranscriptShingles(root: string): Promise<Set<string>> {
  const result = new Set<string>();
  const add = (text: string) => { for (const shingle of shingles(text)) result.add(shingle); };
  const extract = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(extract); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'transcript' && typeof child === 'string') add(child);
      else extract(child);
    }
  };
  const directory = path.join(root, 'transcripts');
  if (!existsSync(directory)) return result;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Privacy validation refuses transcript symlinks');
    if (entry.isFile() && entry.name.endsWith('.yaml')) extract(parse(await readFile(path.join(directory, entry.name), 'utf8')));
  }
  return result;
}

const privateFields = '(?:passages|transcript|transcript_file|transcript_engine|questions|confidence|review_notes|reviewNotes|source_chapters|rawBody|raw_body|raw_hash|rawHash|raw_sha256|audio_sha256|audioSha256|transcript_sha256|transcriptSha256|caption_provenance|caption_sha256|evidence_sha256|dictionary_sha256|input_sha256|source_kind|transcription_provenance|transcribed_span|sourceFileRef|source_path|sourcePath|transcriptPath)';
const privateKey = new RegExp(`(?:(?:["']|&quot;|&#34;)${privateFields}(?:["']|&quot;|&#34;)|[,{]\\s*${privateFields})\\s*:`, 'i');
function privateFieldMatch(text: string, relative: string): RegExpMatchArray | undefined {
  for (const match of text.matchAll(new RegExp(privateKey.source, 'gi'))) {
    // Transformers includes unused diarization code in its feature-extraction worker.
    // Its computed score is executable library code, not serialized archive confidence.
    // Permit only this arithmetic property shape, not a worker-wide content exemption.
    const after = text.slice(match.index! + match[0].length);
    if (/^_astro\/semantic\.worker-[\w-]+\.js$/.test(relative)
      && /^[,{]\s*confidence\s*:$/i.test(match[0])
      && /^\s*[A-Za-z_$][\w$]*\s*\/\s*\(\s*[A-Za-z_$][\w$]*\s*-\s*[A-Za-z_$][\w$]*\s*\)\s*[,}]/.test(after)) continue;
    return match;
  }
}
const forbiddenNames = /(?:^|\/)(?:\.env[^/]*|\.local|\.git|corpus|transcripts?|evidence|passages(?:\.[^/]*)?|vectors\.json(?:\.[^/]*)?|chapter-vectors\.(?:json|bin)|service\.ya?ml|media-authorization\.json|evidence\.(?:txt|json)|ggml-[^/]+|[^/]+\.internal\.[^/]+|[^/]+\.(?:ya?ml|mp4|mkv|wav|mp3|webm|part))$/i;

export async function verifyOutput(root: string, output: string, mode: BuildMode, options: OutputPrivacyOptions = {}) {
  const generated = path.join(output, 'generated');
  const expected = await chapterArtifacts(root, mode, options.rows);
  const actual = parseChapterMetadata(JSON.parse(await readFile(path.join(generated, 'chapters.json'), 'utf8')));
  const scripture = parseScriptureIndex(JSON.parse(await readFile(path.join(generated, 'scripture.json'), 'utf8')));
  if (!sameJson(actual, expected.metadata)) throw new Error('Built search index differs from the recording files');
  // Rebuilt from hash-pinned BSB source, so legitimate Bible text has a precise, isolated exception.
  if (!sameJson(scripture, expected.scripture)) throw new Error('BSB index differs from pinned source');
  if (mode === 'production' && actual.units.some((unit) => unit.preview)) throw new Error('Draft recording in production');
  const binary = await readFile(path.join(generated, actual.vectors.file));
  const decoded = decodeChapterVectors(binary);
  if (decoded.rowCount !== actual.units.length || !binary.equals(expected.files['vectors.bin'])) {
    throw new Error('Binary vectors differ from the rows built for the published units');
  }
  const filenames = CHAPTER_ARTIFACTS.map(name => artifactFilename(name, actual));
  const allowed = new Set<string>(filenames.flatMap((name) => [name, `${name}.gz`]));
  for (const name of await readdir(generated)) if (!allowed.has(name)) throw new Error(`Unexpected generated artifact: ${name}`);
  for (const name of filenames) {
    const raw = await readFile(path.join(generated, name));
    if (!gunzipSync(await readFile(path.join(generated, `${name}.gz`))).equals(raw)) throw new Error(`Gzip companion differs: ${name}`);
    if (name.endsWith('.json') && raw.toString('utf8') !== JSON.stringify(JSON.parse(raw.toString('utf8')))) {
      throw new Error(`Search JSON must be compact: ${name}`);
    }
  }
  const privateShingles = options.deepTranscriptScan === false ? new Set<string>() : await privateTranscriptShingles(root);
  function inspectText(text: string, relative: string): void {
    const privateMatch = privateFieldMatch(text, relative);
    if (privateMatch) throw new Error(`Private field or legacy object in output: ${relative} (${privateMatch[0]})`);
    assertNoTranscriptLeak(text, privateShingles, relative);
    if (relative.endsWith('.json')) {
      const walkStrings = (value: unknown): void => {
        if (typeof value === 'string') {
          if (privateKey.test(value)) throw new Error(`Private field or legacy object in output: ${relative}`);
          assertNoTranscriptLeak(value, privateShingles, relative);
        }
        else if (value && typeof value === 'object') for (const child of Object.values(value)) walkStrings(child);
      };
      walkStrings(JSON.parse(text));
    }
    if (/\.html?$/.test(relative)) {
      for (const match of text.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
        const href = (match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, '&');
        const url = new URL(href, 'https://archive.invalid');
        if (/\/watch\/?$/.test(url.pathname) && url.searchParams.has('id')) {
          throw new Error(`Current HTML links to a retired passage URL: ${relative}`);
        }
      }
    }
  }
  async function inspect(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(output, full).split(path.sep).join('/');
      if (entry.isSymbolicLink() || forbiddenNames.test(relative) || /^services\/\d{4}(?:\/|$)/.test(relative)) {
        throw new Error(`Private/media artifact in output: ${relative}`);
      }
      if (entry.isDirectory()) { await inspect(full); continue; }
      if ((await stat(full)).size >= 100 * 1024 * 1024) throw new Error(`Static-host file-size limit exceeded: ${relative}`);
      // Vocabulary keys such as "questions" are tokenizer tokens, not archive fields.
      // Only exact upstream hash-pinned model assets qualify; altered bytes fail closed.
      const modelFile = MODEL_FILES.find((file) => relative === `models/${EMBEDDING_CONFIG.model}/${file.path}`);
      if (modelFile) {
        if (!verifyModelFile(await readFile(full), modelFile)) throw new Error(`Pinned model integrity failure: ${relative}`);
        continue;
      }
      // The only other content exemption is the verified deduplicated BSB index.
      if (['generated/scripture.json', 'generated/scripture.json.gz'].includes(relative)) continue;
      const textName = relative.replace(/\.gz$/, '');
      if (/\.(?:html?|json|js|mjs|cjs|css|txt|xml|svg|map|md)$/i.test(textName)) {
        const bytes = await readFile(full);
        inspectText((relative.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'), textName);
      }
    }
  }
  await inspect(output);
  console.log(`${mode} output verified: ${actual.units.length} search units; exact BSB and int8 rows; gzip verified; ${privateShingles.size} private transcript shingles checked.`);
  return { units: actual.units.length, privateShingles: privateShingles.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const mode = args[0];
  if ((mode !== 'production' && mode !== 'preview') || args.length > 2 || (args[1] && args[1] !== '--no-deep-transcripts')) {
    throw new Error('Usage: verify-output.ts production | preview [--no-deep-transcripts]');
  }
  await verifyOutput(process.cwd(), path.resolve('dist', mode), mode, { deepTranscriptScan: args[1] !== '--no-deep-transcripts' });
}
