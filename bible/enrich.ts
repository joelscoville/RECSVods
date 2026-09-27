/** Build-only: never import the full Bible into a browser bundle or display projection. */
import { loadBible, type BibleText } from '../scripts/bible';
import { parseScriptureReference } from '../site/lib/scripture';

export function verseTextForReferences(references: readonly string[], bible: BibleText): string {
  const seen = new Set<string>();
  const text: string[] = [];
  for (const input of references) {
    const reference = parseScriptureReference(input);
    if (!reference) throw new Error(`Invalid scripture reference: ${input}`);
    for (let chapter = reference.start.chapter; chapter <= reference.end.chapter; chapter++) {
      const verses = bible[reference.book]?.[chapter - 1];
      if (!verses) throw new Error(`Missing BSB chapter: ${reference.book} ${chapter}`);
      const start = chapter === reference.start.chapter ? reference.start.verse : 1;
      const end = chapter === reference.end.chapter ? reference.end.verse : verses.length;
      for (let verse = start; verse <= end; verse++) {
        const key = `${reference.book} ${chapter}:${verse}`;
        const value = verses[verse - 1];
        if (value === undefined) throw new Error(`Missing BSB verse: ${key}`);
        // Blank rows are present in the official source; do not invent replacement text.
        if (!seen.has(key) && value) text.push(value);
        seen.add(key);
      }
    }
  }
  return text.join('\n');
}

/** Compatibility helper for in-memory search consumers; never serialize its result. */
export function enrichPassages<T extends { scripture: readonly string[]; verseText?: string }>(passages: readonly T[], bible = loadBible()): (Omit<T, 'verseText'> & { verseText?: string })[] {
  return passages.map((passage) => {
    const { verseText: _oldText, ...display } = passage;
    const verseText = verseTextForReferences(passage.scripture, bible);
    return { ...display, ...(verseText ? { verseText } : {}) };
  });
}
