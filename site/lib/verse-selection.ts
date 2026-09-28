import type { ScriptureIndex } from './chapter-index';
import { prepareVerseScorer } from './search';
import { parseScriptureReference } from './scripture';

export type BestVerse = (reference: string) => { verse: string; score: number } | undefined;

/** Prepare once per scripture index, then cache passage choices per query. Hidden text is never returned. */
export function prepareVerseSelection(index: ScriptureIndex): (query: string) => BestVerse {
  const scorer = prepareVerseScorer(index.verses);
  return (query) => {
    const score = scorer(query), cache = new Map<string, ReturnType<BestVerse>>();
    return (reference) => {
      if (!cache.has(reference)) {
        const keys = index.references[parseScriptureReference(reference)?.canonical ?? reference] ?? [];
        let best: ReturnType<BestVerse>;
        for (const verse of keys) { const value = score(verse); if (value > (best?.score ?? 0)) best = { verse, score: value }; }
        cache.set(reference, best);
      }
      return cache.get(reference);
    };
  };
}
