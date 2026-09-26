/** Build-only: pinned public-domain BSB, once per distinct verse, never per chapter. */
import { loadBible, type BibleText } from '../scripts/bible';
import { parseScriptureReference } from '../site/lib/scripture';
import type { ScriptureIndex } from '../site/lib/chapter-index';

export function buildScriptureIndex(chapters: readonly { scripture: readonly string[] }[], bible?: BibleText): ScriptureIndex {
  const references: ScriptureIndex['references'] = Object.create(null);
  const verses: ScriptureIndex['verses'] = Object.create(null);
  for (const input of chapters.flatMap((chapter) => [...chapter.scripture])) {
    const ref = parseScriptureReference(input);
    if (!ref) throw new Error(`Invalid scripture reference: ${input}`);
    if (Object.hasOwn(references, ref.canonical)) continue;
    bible ??= loadBible();
    const keys: string[] = [];
    for (let chapter = ref.start.chapter; chapter <= ref.end.chapter; chapter++) {
      const values = bible[ref.book]?.[chapter - 1];
      if (!values) throw new Error(`Missing BSB chapter: ${ref.book} ${chapter}`);
      const start = chapter === ref.start.chapter ? ref.start.verse : 1;
      const end = chapter === ref.end.chapter ? ref.end.verse : values.length;
      for (let verse = start; verse <= end; verse++) {
        const key = `${ref.book} ${chapter}:${verse}`;
        const text = values[verse - 1];
        if (text === undefined) throw new Error(`Missing BSB verse: ${key}`);
        keys.push(key);
        verses[key] = text; // Preserve official blank rows too.
      }
    }
    references[ref.canonical] = keys;
  }
  return { schemaVersion: 1, references, verses };
}
