import type { ScriptureIndex } from './chapter-index';
import { prepareVerseScorer } from './search';
import { parseScriptureReference } from './scripture';

/** The verse within a cited passage that best matches a search, and how strongly it matches. */
export interface VerseMatch {
  reference: string;
  score: number;
}

/** Finds the best-matching verse within a cited passage, or undefined when no verse matches well enough. */
export type BestVerseSelector = (passageReference: string) => VerseMatch | undefined;

/** Prepare once per scripture index, then call with a query to get that query's selector. Each selector
 * caches its passage choices. Hidden verse text is used for scoring only and never returned. */
export function prepareVerseSelection(index: ScriptureIndex): (query: string) => BestVerseSelector {
  const scorerFor = prepareVerseScorer(index.verses);
  return (query) => {
    const scoreVerse = scorerFor(query);
    const bestByPassage = new Map<string, VerseMatch | undefined>();
    return (passageReference) => {
      if (!bestByPassage.has(passageReference)) {
        const verseKeys = index.references[parseScriptureReference(passageReference)?.canonical ?? passageReference] ?? [];
        let best: VerseMatch | undefined;
        for (const verseKey of verseKeys) {
          const score = scoreVerse(verseKey);
          if (score > (best?.score ?? 0)) best = { reference: verseKey, score };
        }
        bestByPassage.set(passageReference, best);
      }
      return bestByPassage.get(passageReference);
    };
  };
}
