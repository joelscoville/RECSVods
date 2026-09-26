import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { isMap, parseDocument, stringify } from 'yaml';
import { parseWithPath, parseYaml, ServiceSourceSchema } from '../site/lib/archive';
import { normalizeScriptureReference } from '../site/lib/scripture';
import { assertMigrationPreserved, assertPassagesPreserved, MIGRATION_NOTE, originalLegacy, outlineLegacyMap, type RawLegacyService } from '../site/lib/internal-validation';

export const BASELINE_PATH = 'docs/migrations/chapter-search-baseline.json';
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const valueHash = (value: unknown) => sha(stable(value));
function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function safePath(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split('/').some((p) => p === '..' || p === '.')) throw new Error(`unsafe path ${relative}`);
  let current = path.resolve(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${relative}: symlinks are not allowed`);
  }
  return current;
}
export function readMigrationBaseline(root: string, revision: string) {
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
  const files = new Map<string, string>();
  for (const entry of git(root, ['ls-tree', '-r', '-z', commit, '--', 'services']).split('\0').filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
    if (!match || match[1] === '120000') throw new Error('unsupported/symlink baseline service entry');
    if (/\.(yaml|md)$/.test(match[3])) files.set(match[3], git(root, ['cat-file', 'blob', match[2]]));
  }
  const sources = [...files].filter(([filename]) => /^services\/\d{4}\/[^/]+\/service\.yaml$/.test(filename))
    .map(([filename, text]) => ({ filename, text, original: originalLegacy(text, filename) }));
  if (!sources.length) throw new Error('baseline contains no legacy services');
  const services = sources.map(({ filename, text, original }) => {
    const { sections, passages, ...metadata } = original;
    const transcripts = passages.map((p) => {
      const transcript = p.transcript ?? files.get(path.posix.join(path.posix.dirname(filename), p.transcript_file!));
      if (transcript === undefined) throw new Error(`${filename}: missing baseline transcript ${p.id}`);
      return { id: p.id, bytes: Buffer.byteLength(transcript), sha256: sha(transcript) };
    });
    return { id: original.id, filename, bytes: Buffer.byteLength(text), sourceSha256: sha(text),
      metadataSha256: valueHash(metadata), sectionCount: sections.length, sectionsSha256: valueHash(sections),
      passageCount: passages.length, passagesSha256: valueHash(passages),
      transcriptBytes: transcripts.reduce((n, t) => n + t.bytes, 0), transcriptsSha256: valueHash(transcripts) };
  });
  const manifest = { schemaVersion: 1, baselineCommit: commit, hashAlgorithm: 'sha256',
    semanticHashEncoding: 'JSON with recursively sorted object keys; original array order; UTF-8',
    serviceCount: services.length, sectionCount: services.reduce((n, s) => n + s.sectionCount, 0),
    passageCount: services.reduce((n, s) => n + s.passageCount, 0),
    sourceBytes: services.reduce((n, s) => n + s.bytes, 0), services };
  return { files, sources, manifest };
}

/** Copy the literal sequence when possible, validating all original parsed values. */
export function preservePassageBlock(text: string, original: RawLegacyService): string {
  const doc = parseDocument(text);
  if (isMap(doc.contents)) {
    const pair = doc.contents.items.find((p) => String(p.key) === 'passages');
    const node = pair?.value;
    if (node && 'range' in node && node.range) {
      const begin = text.lastIndexOf('\n', node.range[0] - 1) + 1;
      const sequence = text.slice(begin, node.range[2]);
      const literal = sequence.trimStart().startsWith('-') ? `passages:\n${sequence}` : `passages: ${text.slice(node.range[0], node.range[2])}`;
      try { assertPassagesPreserved(original.passages, literal, 'passages.internal.yaml'); return literal; } catch { /* aliases may require serialization */ }
    }
  }
  const serialized = stringify({ passages: original.passages }, { lineWidth: 0 });
  assertPassagesPreserved(original.passages, serialized, 'passages.internal.yaml');
  return serialized;
}
const words = (text: string) => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const STOP = new Set('a an and are as at be been but by for from god he her him his i in is it its jesus lord of on or our she that the their them there they this to us was we were what when which who will with you your'.split(' '));
export function spokenKeywordCandidates(titles: string[], spoken: string): string[] {
  // Bracketed editorial annotations are evidence about speech, not spoken words.
  const speech = ` ${words(spoken.replace(/\[[^\]]*\]/g, ' ')).join(' ')} `; const found = new Set<string>();
  for (const title of titles) {
    const tokens = words(title);
    for (let length = Math.min(3, tokens.length); length >= 1; length--) for (let i = 0; i + length <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + length);
      if (STOP.has(phrase[0]) || STOP.has(phrase.at(-1)!) || (length === 1 && phrase[0].length < 4)) continue;
      const candidate = phrase.join(' ');
      if (speech.includes(` ${candidate} `)) found.add(candidate);
    }
  }
  return [...found];
}
/** Exact video-ID filename only; raw ASR is read in memory, never copied to review inputs. */
function privateSpeech(directory: string | undefined, videoId: string, start: number, end: number): string | undefined {
  if (!directory) return undefined;
  const filename = path.join(directory, `${videoId}.json`);
  if (!existsSync(filename)) return undefined;
  const raw = JSON.parse(readFileSync(filename, 'utf8')) as { segments?: { start: number; end: number; text: string }[] };
  if (!Array.isArray(raw.segments) || raw.segments.some((s) => !Number.isFinite(s.start) || !Number.isFinite(s.end) || typeof s.text !== 'string')) throw new Error(`${videoId}: invalid private ASR segments`);
  return raw.segments.filter((s) => s.start < end && s.end > start).map((s) => s.text).join(' ');
}
export function deriveChapters(original: RawLegacyService, filename: string, files: ReadonlyMap<string, string>, privateDirectory?: string) {
  const { sections, passages, ...metadata } = original;
  const reviewChapters: Record<string, unknown>[] = [];
  const chapters = sections.map((section) => {
    const children = passages.filter((p) => p.section_id === section.id);
    const rawSpeech = privateSpeech(privateDirectory, section.video_id, section.start, section.end);
    const spoken = rawSpeech ?? children.map((p) => p.transcript ?? files.get(path.posix.join(path.posix.dirname(filename), p.transcript_file!)) ?? '').join(' ');
    const topics = [...new Set(children.flatMap((p) => p.topics.map((id) => id.trim())))];
    const scripture = [...new Set(children.flatMap((p) => p.scripture.map(normalizeScriptureReference)))];
    const titles = [...children.map((p) => p.title), ...topics.map((id) => original.topics?.find((t) => t.id === id)?.name ?? id)];
    const candidates = spokenKeywordCandidates(titles, spoken);
    const summary = children[0]?.summary ?? 'No existing passage summary is available; chapter summary requires review.';
    reviewChapters.push({ id: section.id, title: section.title, type: section.type, video_id: section.video_id,
      start: section.start, end: section.end, ...(section.speaker_id ? { speaker_id: section.speaker_id } : {}),
      scripture, topics, summary_seed: summary, summary_needs_review: true,
      passage_summaries: children.map((p) => ({ id: p.id, title: p.title, summary: p.summary })),
      keyword_candidates: candidates, keywords_need_review: true, keyword_evidence: rawSpeech === undefined ? 'legacy_passages' : 'private_colab' });
    return { ...section, scripture, topics, summary, keywords: candidates.slice(0, 10) };
  });
  const service = { ...metadata, review_notes: [...(metadata.review_notes ?? []), MIGRATION_NOTE], chapters };
  parseWithPath(ServiceSourceSchema, service, filename);
  const legacyMap = Object.fromEntries(passages.map((p) => [p.id, p.section_id]));
  return { service, legacyMap, review: { schemaVersion: 1, service_id: original.id, needs_review: true, chapters: reviewChapters } };
}

function immutableWrite(root: string, relative: string, text: string): void {
  const filename = safePath(root, relative);
  if (existsSync(filename)) {
    if (readFileSync(filename, 'utf8') !== text) throw new Error(`${relative}: conflicting existing file; refusing overwrite`);
    return;
  }
  mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    linkSync(temp, filename); // atomic exclusive publication: no partial quarantine file on interruption
  } finally { rmSync(temp, { force: true }); }
}
function atomicReplace(filename: string, original: string, text: string): void {
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    if (readFileSync(filename, 'utf8') !== original) throw new Error(`${filename}: source changed during migration`);
    renameSync(temp, filename);
  } finally { rmSync(temp, { force: true }); }
}
export interface MigrationOptions { baseline: string; mode: 'prepare' | 'verify' | 'record-baseline'; privateDirectory?: string }
export function migrateChapters(root: string, options: MigrationOptions) {
  const baseline = readMigrationBaseline(root, options.baseline);
  const baselineText = `${JSON.stringify(baseline.manifest, null, 2)}\n`;
  const baselineFile = safePath(root, BASELINE_PATH);
  if (existsSync(baselineFile) && readFileSync(baselineFile, 'utf8') !== baselineText) throw new Error('conflicting persisted migration baseline');
  if (options.mode === 'record-baseline') { immutableWrite(root, BASELINE_PATH, baselineText); return baseline.manifest; }
  const plans = baseline.sources.map(({ filename, text, original }) => {
    if (original.editorial_status !== 'needs_review') throw new Error(`${filename}: migration requires needs_review; approved input is unchanged`);
    const absolute = safePath(root, filename); const current = readFileSync(absolute, 'utf8');
    for (const p of original.passages) if (p.transcript_file) {
      const external = path.posix.join(path.posix.dirname(filename), p.transcript_file);
      if (readFileSync(safePath(root, external), 'utf8') !== baseline.files.get(external)) throw new Error(`${external}: original transcript bytes changed`);
    }
    const directory = path.posix.dirname(filename);
    const internalPath = `${directory}/passages.internal.yaml`;
    const mapPath = `${directory}/legacy-chapters.json`;
    const reviewPath = `.local/chapter-review/${original.id}.json`;
    const internal = preservePassageBlock(text, original);
    const { service, legacyMap: initialMap, review } = deriveChapters(original, filename, baseline.files, options.mode === 'verify' ? undefined : options.privateDirectory);
    const publicText = stringify(service, { lineWidth: 100 });
    assertMigrationPreserved(original, publicText, internal, filename);
    const migrated = 'chapters' in (parseYaml(current, filename) as object);
    const chapterInternalPath = safePath(root, `${directory}/chapters.internal.yaml`);
    const chapterInternal = existsSync(chapterInternalPath) ? readFileSync(chapterInternalPath, 'utf8') : undefined;
    if (migrated) assertMigrationPreserved(original, current, internal, filename, chapterInternal);
    else if (current !== text) throw new Error(`${filename}: source differs from frozen baseline; refusing overwrite`);
    const existingInternal = existsSync(safePath(root, internalPath)) ? readFileSync(safePath(root, internalPath), 'utf8') : undefined;
    if (existingInternal !== undefined) assertPassagesPreserved(original.passages, existingInternal, internalPath);
    const legacyMap = chapterInternal ? outlineLegacyMap(original, parseWithPath(ServiceSourceSchema, parseYaml(current, filename), filename).chapters) : initialMap;
    const mapText = `${JSON.stringify(legacyMap, null, 2)}\n`;
    if (existsSync(safePath(root, mapPath)) && !isDeepStrictEqual(JSON.parse(readFileSync(safePath(root, mapPath), 'utf8')), legacyMap)) throw new Error(`${mapPath}: conflicting compatibility map`);
    if (options.mode === 'verify' && (!migrated || existingInternal === undefined || !existsSync(safePath(root, mapPath)))) throw new Error(`${filename}: migration incomplete`);
    return { absolute, current, migrated, publicText, internalPath, internal, existingInternal, mapPath, mapText, reviewPath, reviewText: `${JSON.stringify(review, null, 2)}\n` };
  });
  if (options.mode === 'verify') return baseline.manifest;
  // Preflight every service before any write. Internal material always lands before public source.
  immutableWrite(root, BASELINE_PATH, baselineText);
  for (const plan of plans) {
    if (plan.existingInternal === undefined) immutableWrite(root, plan.internalPath, plan.internal);
    if (!existsSync(safePath(root, plan.mapPath))) immutableWrite(root, plan.mapPath, plan.mapText);
    if (!existsSync(safePath(root, plan.reviewPath))) immutableWrite(root, plan.reviewPath, plan.reviewText);
    if (!plan.migrated) atomicReplace(plan.absolute, plan.current, plan.publicText);
  }
  return baseline.manifest;
}
export function migrationCli(args = process.argv.slice(2), root = process.cwd()) {
  let baseline: string | undefined; let mode: MigrationOptions['mode'] | undefined;
  let privateDirectory = path.join(homedir(), 'RECS-colab/transcripts');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--baseline' && !baseline && args[i + 1] && !args[i + 1].startsWith('--')) baseline = args[++i];
    else if (arg === '--private-transcripts' && args[i + 1] && !args[i + 1].startsWith('--')) privateDirectory = args[++i];
    else if (['--prepare', '--verify', '--record-baseline'].includes(arg) && !mode) mode = arg.slice(2) as MigrationOptions['mode'];
    else throw new Error('Usage: tsx scripts/migrate-chapters.ts --baseline <commit> --prepare|--verify|--record-baseline [--private-transcripts <directory>]');
  }
  if (!baseline || !mode) throw new Error('Usage: supply --baseline <commit> and --prepare, --verify, or --record-baseline');
  return migrateChapters(root, { baseline, mode, privateDirectory });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = migrationCli(); console.log(`Chapter migration: ${result.serviceCount} services, ${result.sectionCount} chapters, ${result.passageCount} preserved internal passages.`); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
