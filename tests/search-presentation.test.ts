import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { enrichUnits, PublicUnitSchema, parseScriptureIndex } from '../site/lib/chapter-index';
import { prepareSearchIndex } from '../site/lib/search';
import { prepareVerseSelection } from '../site/lib/verse-selection';
import RecordingResult, { selectResultReferences } from '../site/components/RecordingResult';
import { groupByRecording, type HomeItem } from '../site/components/archive-display';

const index = parseScriptureIndex({ schemaVersion: 1, references: {
  'John 3:16-17': ['John 3:16', 'John 3:17'], '1 John 2:15-16': ['1 John 2:15'],
  'Romans 12:1-2': ['Romans 12:1', 'Romans 12:2'], 'Romans 12:1': ['Romans 12:1'],
}, verses: {
  'John 3:16': 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.',
  'John 3:17': 'For God did not send His Son into the world to condemn the world, but to save the world through Him.',
  '1 John 2:15': 'Do not love the world or anything in the world. If anyone loves the world, the love of the Father is not in him.',
  'Romans 12:1': 'Offer your bodies as living sacrifices, holy and pleasing to God.',
  'Romans 12:2': 'Do not be conformed to this world, but be transformed by the renewing of your mind.',
} });
const unit = PublicUnitSchema.parse({
  id: 'match', recordingId: 'match', kind: 'recording', start: 0, end: 300, recordingTitle: 'Gathering',
  title: 'Gathering', text: 'PRIVATE_SYNOPSIS_SENTINEL', date: '2026-01-04',
  preview: true, topics: [], scripture: ['John 3:16-17', '1 John 2:15-16', 'Romans 12:1-2', 'Romans 12:1'],
  scriptureDisplay: ['Jn 3:16-17', 'I John 2:15-16', 'Rom 12:1-2', 'Rom 12:1'],
});
const recording: HomeItem = {
  id: 'abcdefghijk', recordingId: 'match', title: 'Gathering', date: unit.date, hasSermon: true,
  length: 300, start: 0, preview: true, href: '/watch/?r=match',
};

describe('real search evidence to rendered result', () => {
  it.each([
    ['do not love the world', '1 John 2:15', '1 John 2:15'],
    ['living sacrifice', 'Romans 12:1', 'Romans 12:1'],
    ['John 3', 'John 3:16-17', 'Jn 3:16-17'],
    ['1 John 2', '1 John 2:15-16', 'I John 2:15-16'],
  ])('%s leads with %s', (query, expected, display) => {
    const enriched = enrichUnits([unit], index);
    const results = groupByRecording(prepareSearchIndex(enriched).search(query), [recording], '/');
    expect(results).toHaveLength(1);
    expect(results[0].unit.id).toBe('match');
    const findBestVerse = prepareVerseSelection(index)(query);
    const html = renderToStaticMarkup(createElement(RecordingResult, { ...results[0], units: enriched, query, findBestVerse }));
    const referenceLabels = [...html.matchAll(/aria-label="Read ([^"]+) in the ESV"/g)].map(match => match[1]);
    expect(referenceLabels[0]).toBe(expected);
    expect(html).toContain(`https://www.esv.org/${encodeURIComponent(expected)}/`);
    expect(html).toContain(display);
    expect(html).toContain('/watch/?r=match');
    expect(html).not.toContain('PRIVATE_SYNOPSIS_SENTINEL');
    for (const text of Object.values(index.verses)) expect(html).not.toContain(text);
    expect(unit).not.toHaveProperty('verseText');
  });
  it('deduplicates real narrowed choices and keeps caches query-local', () => {
    const select = prepareVerseSelection(index), first = select('living sacrifice');
    expect(first('Rom 12:1-2')?.reference).toBe('Romans 12:1');
    expect(select('renewing your mind')('Romans 12:1-2')?.reference).toBe('Romans 12:2');
    expect(first('Romans 12:1-2')?.reference).toBe('Romans 12:1');
    const shown = selectResultReferences(unit, 'living sacrifice', first);
    expect(shown.references.filter(ref => ref === 'Romans 12:1')).toHaveLength(1);
    expect(first('Unknown 1')).toBeUndefined();
  });
  it('does not narrow an unrelated passage when its negation modifies another word', () => {
    const query = 'do not love the world', select = prepareVerseSelection(index)(query);
    // The misleading verse contains all three significant words. It must get no evidence,
    // even when a chapter does not cite the correct verse as a higher-scoring alternative.
    expect(select('John 3:16-17')).toBeUndefined();
    expect(select('1 John 2:15-16')?.reference).toBe('1 John 2:15');
    expect(selectResultReferences({ scripture: ['John 3:16-17'] }, query, select).references).toEqual(['John 3:16-17']);
  });
  it('retains source order and labels when no verse provides evidence', () => {
    expect(selectResultReferences(unit, 'unknown terms', prepareVerseSelection(index)('unknown terms'))).toEqual({
      references: unit.scripture, displayReferences: unit.scriptureDisplay,
    });
  });
});
