/** Writes an edited recording into the real recording file, in the browser or in Node. Only the parts the
 * editor changed are rewritten, so comments and layout elsewhere are kept, and each of those parts must
 * still match what the editor started from: edits made to the file since are refused, never overwritten. */
import { isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { RecordingSchema, type Recording, type RecordingSource } from './recording-schema';
import { parseFile } from './parse-file';

/** The order of a recording file's top-level fields. */
const ORDER = ['recordingTitle', 'serviceDate', 'status', 'sermonDescription', 'sermonScripture', 'sermonTopics', 'uploads', 'chapters', 'markers'];
const FIELDS = { recordingTitle: 'title', sermonDescription: 'sermon description', sermonScripture: 'scripture', sermonTopics: 'topics', markers: 'markers' } as const;
const CHAPTER_FIELDS = { chapterTitle: 'title', chapterKind: 'type', chapterStart: 'start', chapterEnd: 'end', chapterScripture: 'scripture', subchapters: 'subchapters', points: 'points' } as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class ChangeConflictError extends Error {
  constructor(readonly problems: string[]) { super(`The file changed since this page was made:\n  - ${problems.join('\n  - ')}`); }
}

/** Clock values stay quoted ("42:54.62") so YAML never reads them as numbers. */
export function quoteClocks(document: Document): void {
  const quote = (node: unknown) => {
    if (isMap(node)) for (const pair of node.items) {
      if (isScalar(pair.value) && typeof pair.value.value === 'string' && /(Start|End|Time|Duration|Skip)$/.test(String((pair.key as Scalar).value))) pair.value.type = Scalar.QUOTE_DOUBLE;
      quote(pair.value);
    } else if (isSeq(node)) node.items.forEach(quote);
  };
  quote(document.contents);
}

/** Writes `value` into `node` changing only what differs, so untouched lines (and their wrapping and
 * comments) stay exactly as they were. Returns the node to use in place of the old one. */
function assign(document: Document, node: unknown, value: unknown): unknown {
  if (isMap(node) && value && typeof value === 'object' && !Array.isArray(value)) {
    const map = node as YAMLMap, entries = value as Record<string, unknown>;
    for (const pair of [...map.items]) if (!(String((pair.key as Scalar).value) in entries)) map.delete(pair.key);
    for (const [key, child] of Object.entries(entries)) {
      const current = map.get(key, true);
      if (current === undefined) map.set(key, document.createNode(child));
      else if (!equal((current as { toJSON?: () => unknown }).toJSON?.() ?? (isScalar(current) ? current.value : current), child)) map.set(key, assign(document, current, child));
    }
    return map;
  }
  if (isSeq(node) && Array.isArray(value) && (node as YAMLSeq).items.length === value.length) {
    const seq = node as YAMLSeq;
    seq.items = seq.items.map((item, i) => assign(document, item, value[i]));
    return seq;
  }
  return document.createNode(value);
}

export interface AppliedChanges { text: string; recording: Recording; /** The file was a draft; this change publishes it. */ published: boolean }
/** `base` is the recording the editor started from; `edited` is the editor's finished recording. */
export function applyChanges(input: { text: string; base: Recording; edited: RecordingSource; filename: string }): AppliedChanges {
  const { base, filename } = input;
  const document = parseDocument(input.text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${filename} is not valid YAML`);
  const current = parseFile(RecordingSchema, input.text, filename);
  const edited = RecordingSchema.parse(input.edited);
  const source = input.edited, root = document.contents as YAMLMap;
  const problems: string[] = [], writes: (() => void)[] = [];

  // All edits were checked against this sequence of uploads. A duration, cut or
  // source replacement changes what every recording-time boundary refers to.
  // Playback notes can still merge independently.
  const clock = (recording: Recording) => recording.uploads.map(upload => [upload.youtubeId, upload.uploadDuration, upload.uploadSkip ?? 0]);
  if (!equal(clock(current), clock(base))) problems.push('the uploads or recording clock');

  for (const [field, name] of Object.entries(FIELDS) as [keyof typeof FIELDS, string][]) {
    if (equal(base[field], edited[field])) continue;
    if (!equal(current[field], base[field])) problems.push(`the recording’s ${name}`);
    else writes.push(() => source[field] === undefined ? root.delete(field) : root.set(field, assign(document, root.get(field, true), source[field])));
  }
  const ids = (recording: Pick<Recording, 'chapters'>) => recording.chapters.map(chapter => chapter.chapterId).join();
  if (!equal(base.chapters, edited.chapters)) {
    const chapters = document.get('chapters');
    if (ids(base) === ids(edited) && ids(base) === ids(current) && isSeq(chapters)) {
      // The same chapters: rewrite only what changed in each, keeping everything else in the file as it is.
      base.chapters.forEach((chapter, i) => {
        for (const [field, name] of Object.entries(CHAPTER_FIELDS) as [keyof typeof CHAPTER_FIELDS, string][]) {
          if (equal(chapter[field], edited.chapters[i][field])) continue;
          if (!equal(current.chapters[i][field], chapter[field])) { problems.push(`the ${name} of “${chapter.chapterTitle}”`); continue; }
          const node = chapters.items[i] as YAMLMap, value = source.chapters[i][field];
          writes.push(() => value === undefined ? node.delete(field) : node.set(field, assign(document, node.get(field, true), value)));
        }
      });
    } else if (!equal(current.chapters, base.chapters)) problems.push('the chapters');
    else writes.push(() => root.set('chapters', document.createNode(source.chapters)));
  }
  if (problems.length) throw new ChangeConflictError(problems.map(problem => `${problem} changed on GitHub`));
  for (const write of writes) write();

  // A person sent this from the editor, so they have checked it: it goes on the website once merged.
  // (AI drafts never come through here; they stay drafts until a person checks them.)
  const published = current.status !== 'published';
  if (published) root.set('status', 'published');
  root.items.sort((a, b) => ORDER.indexOf(String((a.key as Scalar).value)) - ORDER.indexOf(String((b.key as Scalar).value)));
  quoteClocks(document);
  const text = document.toString({ lineWidth: 100 });
  return { text, recording: parseFile(RecordingSchema, text, filename), published };
}
