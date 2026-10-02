import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_CONFIG, EMBEDDING_OPTIONS, isCompatibleEmbeddingConfig, isEmbeddingVector, MODEL_FILES, preprocessEmbedding, semanticAssetPaths } from '../site/lib/embedding-config';
import { parseFullDateQuery, prepareSearchIndex, prepareVerseScorer, search, SEARCH_WEIGHTS } from '../site/lib/search';
import { CHAPTER_VECTOR_CONFIG, decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { enrichUnits, parseChapterMetadata } from '../site/lib/chapter-index';
import { createSemanticClient, type SemanticRequest, type SemanticResponse, type SemanticStatus } from '../site/lib/semantic';
import type { SearchUnit } from '../site/lib/display';
import { sha256, verifyModelFile } from '../scripts/embeddings';

// Fictional metadata and compact vector rows; never emitted into an archive.
const fixture: SearchUnit = {
  id: 'fixture', recordingId: 'fixture-service', kind: 'point', start: 60,
  recordingTitle: 'Fixture gathering', title: 'Serving our neighbours', text: 'Practical care and quiet generosity, a daily practice.',
  topics: ['Community'], scripture: ['Romans 12:1-2'], date: '2026-09-06', preview: true,
};
function unit(index = 0): number[] { return Array.from({ length: 384 }, (_, i) => i === index ? 1 : 0); }
function vectors(indices = [0]) {
  return decodeChapterVectors(packChapterVectors(indices.map((index) => Int8Array.from(unit(index), (value) => value * 127))));
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('embedding and chapter metadata contracts', () => {
  it('shares normalization, pooling, dimensions, dtype, revision and tokenizer limits', () => {
    expect(preprocessEmbedding('  Ａ\tword\nwith   spaces  ')).toBe('A word with spaces');
    expect(EMBEDDING_OPTIONS).toEqual({ pooling: 'mean', normalize: true });
    expect(EMBEDDING_CONFIG).toMatchObject({ dtype: 'q8', dimension: 384, maxLength: 256, revision: '751bff37182d3f1213fa05d7196b954e230abad9' });
    expect(isCompatibleEmbeddingConfig(JSON.parse(JSON.stringify(EMBEDDING_CONFIG)))).toBe(true);
    for (const key of Object.keys(EMBEDDING_CONFIG)) expect(isCompatibleEmbeddingConfig({ ...EMBEDDING_CONFIG, [key]: 'different' })).toBe(false);
    expect(isEmbeddingVector(unit())).toBe(true);
    for (const vector of [unit().slice(1), Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(1), null]) expect(isEmbeddingVector(vector)).toBe(false);
  });
  it('validates the full chapter recipe before a binary row can be paired with metadata', () => {
    const hash = sha256(packChapterVectors([new Int8Array(384).fill(127)]));
    const metadata = { schemaVersion: 5, model: CHAPTER_VECTOR_CONFIG, vectors: { file: `vectors.${hash}.bin`, sha256: hash }, units: [fixture] };
    expect(parseChapterMetadata(metadata).units).toEqual([fixture]);
    for (const key of Object.keys(CHAPTER_VECTOR_CONFIG)) expect(() => parseChapterMetadata({ ...metadata, model: { ...CHAPTER_VECTOR_CONFIG, [key]: 'different' } })).toThrow();
    expect(() => parseChapterMetadata({ ...metadata, units: [{ ...fixture, verseText: 'browser-only' }] })).toThrow();
  });
  it('builds same-origin model assets under any deployment path', () => {
    expect(semanticAssetPaths('/review/')).toEqual({ models: '/review/models/', onnx: '/review/onnx/' });
    for (const base of ['https://cdn.test/', '//cdn.test/', 'relative', '/a/../', '/a?b', '/a\\b']) expect(() => semanticAssetPaths(base)).toThrow();
  });
  it('rejects damaged model bytes even at the correct byte count', () => {
    expect(verifyModelFile(Buffer.alloc(MODEL_FILES[0].bytes), MODEL_FILES[0])).toBe(false);
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('transparent chapter ranking', () => {
  it('finds metadata immediately without BSB, vectors or a model', () => {
    expect(search([fixture], 'daily practice')[0].reasons).toEqual(['Summary match (exact phrase)']);
    expect(search([fixture], 'Community')[0].reasons).toEqual(['Topic match']);
    expect(search([fixture], 'fixture gathering')[0].reasons).toEqual(['Service match (exact phrase)']);
    expect(search([fixture], 'neighbours')[0].reasons).toEqual(['Title match']);
    expect(search([fixture], 'neigh')).toEqual([]);
  });
  it('ignores question scaffolding but preserves negation and meaningful title words', () => {
    const records = ['Daily practice', 'Not willing', 'Willing', 'Only'].map((title, i) => ({ ...fixture, id: String(i), title, text: 'A musician describes practice.' }));
    expect(search(records, 'Should my daily practice matter if I am being a musician?').map((r) => r.unit.id)).toEqual(['0']);
    expect(search(records, 'not willing').map((r) => r.unit.id)).toEqual(['1']);
    expect(search(records, 'only')[0].unit.id).toBe('3');
  });
  it('matches optional series as a general metadata field', () => {
    const chapter = { ...fixture, series: { id: 'orchard', title: 'Fictional orchard' } };
    expect(search([chapter], 'fictional orchard')[0].reasons).toEqual(['Series match (exact phrase)']);
    expect(search([chapter], 'orchard')[0].score).toBe(SEARCH_WEIGHTS.series * (1 + SEARCH_WEIGHTS.phraseBonus));
    expect(search([fixture], 'fictional orchard')).toEqual([]);
  });
  it('matches inflected metadata words without prefix matching or changing source text', () => {
    const chapter = { ...fixture, title: 'Restoring the garden', text: 'Plants need careful tending by stumbling gardeners.' };
    for (const query of ['stumble', 'gardener', 'restore', 'plant']) expect(search([chapter], query)[0]?.unit).toBe(chapter);
    expect(search([chapter], 'gard')).toEqual([]);
    expect(chapter.text).toBe('Plants need careful tending by stumbling gardeners.');
  });
  it('admits distinctive two-term metadata cues in longer questions without generic partial flooding', () => {
    const target = { ...fixture, id: 'target', title: 'Orchard pruning', text: 'Annual care for trees in the orchard.', scripture: [] };
    const common = Array.from({ length: 50 }, (_, i) => ({ ...fixture, id: `other-${i}`, title: 'Annual care', text: 'Care for our community.', scripture: [] }));
    expect(search([target, ...common], 'What does annual orchard pruning mean for a healthy future?')[0]?.unit.id).toBe('target');
    expect(search([target, ...common], 'orchard unknownone unknowntwo')).toEqual([]);
  });
  it('adds hidden BSB matches only after enrichment, without mutating metadata', () => {
    const original = structuredClone(fixture);
    const [enriched] = enrichUnits([fixture], { schemaVersion: 1, references: { 'Romans 12:1-2': ['Romans 12:1'] }, verses: { 'Romans 12:1': 'living sacrifices' } });
    expect(search([fixture], 'living sacrifice')).toEqual([]);
    expect(search([enriched], 'living sacrifice')[0].reasons).toEqual(['Verse-text match (BSB)']);
    expect(fixture).toEqual(original);
  });
  it.each(['Romans 13', 'Rom 13', 'Rom13', 'ROM.13:3', 'Romans 12:21-13:2'])('prioritizes overlapping scripture for %s', (query) => {
    const referenced = { ...fixture, id: 'referenced', scripture: ['Romans 13:1-7'] };
    const other = { ...fixture, id: 'other', scripture: [], text: 'Romans 13' };
    const result = search([other, referenced], query, { vectors: vectors([0, -1]), queryVector: unit() });
    expect(result[0].unit.id).toBe('referenced');
    expect(result[0].reasons.some((reason) => reason.startsWith('Scripture: '))).toBe(true);
    expect(search([referenced], 'Romans 13:8')).toEqual([]);
  });
  it('treats a reference as one term: loose book words and numbers do not match', () => {
    const psalmOne = { ...fixture, id: 'psalm-one', scripture: ['Psalms 1:1-6'] };
    // Mentions a psalm and the number 1 (and cites Psalms 98:1-3), but not Psalm 1.
    const loose = { ...fixture, id: 'loose', scripture: ['Psalms 98:1-3'], text: 'Psalms: sing a new song from Psalms 98:1-3 and 1 Corinthians 11.' };
    const written = { ...fixture, id: 'written', scripture: [], text: 'Reads Psalm 1 aloud before prayer.' };
    for (const query of ['Psalms 1', 'Psalm 1', 'Ps 1']) expect(search([loose, written, psalmOne], query).map((result) => result.unit.id)).toEqual(['psalm-one', 'written']);
    expect(search([loose], 'John 3')).toEqual([]);
  });
  it('keeps numbered and unnumbered books apart in references written in text', () => {
    const firstJohn = { ...fixture, id: 'first-john', scripture: ['1 John 3:16'], text: 'Reading from 1 John 3:16.' };
    const secondJohn = { ...fixture, id: 'second-john', scripture: [], text: 'Greeting in 2 John 1:3 and 3 John 1:2.' };
    const gospel = { ...fixture, id: 'gospel', scripture: [], text: 'Nicodemus hears John 3:1-21 at night.' };
    const rows = [firstJohn, secondJohn, gospel], prepared = prepareSearchIndex(rows);
    for (const query of ['John 3', 'John 3:16']) {
      // Exhaustive and prepared search agree: only the Gospel of John, written as a range, matches.
      expect(search(rows, query).map((result) => result.unit.id)).toEqual(['gospel']);
      expect(prepared.search(query).map((result) => result.unit.id)).toEqual(['gospel']);
    }
    expect(search(rows, '1 John 3').map((result) => result.unit.id)).toEqual(['first-john']);
    expect(search(rows, '3 John 1').map((result) => result.unit.id)).toEqual(['second-john']);
  });
  it('reads complete book names in text: multiword names, Roman numerals and aliases', () => {
    const song = { ...fixture, id: 'song', scripture: [], text: 'Reading from Song of Solomon 2:1.' };
    const roman = { ...fixture, id: 'roman', scripture: [], text: 'Reading from I John 3:16.' };
    const alias = { ...fixture, id: 'alias', scripture: [], text: 'See 1 Jn 4:8 and Rom. 13:1.' };
    const prose = { ...fixture, id: 'prose', scripture: [], text: 'It is 3 weeks until John returns.' };
    const rows = [song, roman, alias, prose], prepared = prepareSearchIndex(rows);
    const ids = (query: string) => {
      const exhaustive = search(rows, query).map((result) => result.unit.id);
      expect(prepared.search(query).map((result) => result.unit.id)).toEqual(exhaustive);
      return exhaustive;
    };
    expect(ids('Song of Solomon 2:1')).toEqual(['song']);
    // "I John" is 1 John, never the Gospel of John.
    expect(ids('John 3:16')).toEqual([]);
    expect(ids('1 John 3:16')).toEqual(['roman']);
    expect(ids('1 John 4')).toEqual(['alias']);
    expect(ids('Romans 13')).toEqual(['alias']);
    expect(ids('Isaiah 3')).toEqual([]);
  });
  it('reads each written reference as a whole chapter:verse unit, so its numbers never start the next one', () => {
    const listed = { ...fixture, id: 'listed', scripture: [], text: 'Read Romans 12:1; John 3:16.' };
    const spaced = { ...fixture, id: 'spaced', scripture: [], text: 'Read Romans 12:1 John 3:16 together.' };
    const numbered = { ...fixture, id: 'numbered', scripture: [], text: 'Compare Romans 12; 1 John 3 and Romans 12:1 and 1 John 4:8.' };
    const rows = [listed, spaced, numbered], prepared = prepareSearchIndex(rows);
    const ids = (query: string) => {
      const exhaustive = search(rows, query).map((result) => result.unit.id);
      expect(prepared.search(query).map((result) => result.unit.id)).toEqual(exhaustive);
      return exhaustive;
    };
    expect(ids('John 3:16')).toEqual(['listed', 'spaced']);
    expect(ids('1 John 3:16')).toEqual(['numbered']);
    expect(ids('1 John 4')).toEqual(['numbered']);
    expect(ids('Romans 12').sort()).toEqual(['listed', 'numbered', 'spaced']);
    // Without any punctuation, a chapter-only reference ends at its chapter: the next number starts 1 John.
    const bare = [{ ...fixture, id: 'bare', scripture: [], text: 'Romans 12 1 John 3 tonight.' }];
    expect(search(bare, '1 John 3').map((result) => result.unit.id)).toEqual(['bare']);
    expect(search(bare, 'John 3')).toEqual([]);
    // A book name with an invalid chapter is skipped whole: 1 John has five chapters, so this is not John 9.
    expect(search([{ ...fixture, id: 'invalid', scripture: [], text: 'Compare 1 John 9 with nothing.' }], 'John 9')).toEqual([]);
    // Cross-chapter ranges are one unit too.
    expect(search([{ ...fixture, id: 'range', scripture: [], text: 'Reading Romans 12:21-13:2 aloud.' }], 'Romans 13:1').map((result) => result.unit.id)).toEqual(['range']);
  });
  it('normalises written references as the scripture parser does: Unicode book numbers and every dash', () => {
    const rows = [
      { ...fixture, id: 'roman-numeral', scripture: [], text: 'Reading from Ⅰ John 3:16.' },
      { ...fixture, id: 'full-width', scripture: [], text: 'Reading from １ John 4:8.' },
      { ...fixture, id: 'em-dash', scripture: [], text: 'Reading Romans 12:21—13:2 aloud.' },
      { ...fixture, id: 'en-dash', scripture: [], text: 'Reading Romans 8:28–30 aloud.' },
    ];
    const prepared = prepareSearchIndex(rows);
    const ids = (query: string) => {
      const exhaustive = search(rows, query).map((result) => result.unit.id);
      expect(prepared.search(query).map((result) => result.unit.id)).toEqual(exhaustive);
      return exhaustive;
    };
    // "Ⅰ" and "１" keep their book number: these are 1 John, never the Gospel of John.
    expect(ids('John 3:16')).toEqual([]);
    expect(ids('1 John 3:16')).toEqual(['roman-numeral']);
    expect(ids('1 John 4')).toEqual(['full-width']);
    // An em-dash range is read whole, so it reaches Romans 13; an en-dash range still works.
    expect(ids('Romans 13')).toEqual(['em-dash']);
    expect(ids('Romans 8:30')).toEqual(['en-dash']);
  });
  it('reads unambiguous lowercase book names but not everyday words', () => {
    const rows = [
      { ...fixture, id: 'lower-john', scripture: [], text: 'Reading from john 3:16.' },
      { ...fixture, id: 'lower-psalm', scripture: [], text: 'A reading of psalm 23 before prayer.' },
      { ...fixture, id: 'prose', scripture: [], text: 'It is 3 weeks away; mark 3 items and note the acts 2 cast list.' },
    ];
    const prepared = prepareSearchIndex(rows);
    for (const [query, expected] of [['John 3:16', ['lower-john']], ['Psalms 23', ['lower-psalm']], ['Isaiah 3', []], ['Mark 3', []], ['Acts 2', []]] as const) {
      expect(search(rows, query).map((result) => result.unit.id)).toEqual(expected);
      expect(prepared.search(query).map((result) => result.unit.id)).toEqual(expected);
    }
  });
  it('scores the verse a natural-language query is about, ignoring common words alone', () => {
    const verses = {
      'Romans 12:1': 'Therefore I urge you, brothers, on account of God’s mercy, to offer your bodies as living sacrifices, holy and pleasing to God.',
      'Romans 12:2': 'Do not be conformed to this world, but be transformed by the renewing of your mind.',
      'Psalms 95:1': 'Come, let us sing for joy to the LORD; let us shout to the Rock of our salvation!',
      ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Filler 1:${i + 1}`, 'The word of God endures forever.'])),
    };
    const score = prepareVerseScorer(verses)('offering our bodies as a living sacrifice');
    expect(score('Romans 12:1')).toBeGreaterThan(score('Romans 12:2'));
    expect(score('Romans 12:2')).toBe(0);
    // "God" appears in most verses, so on its own it never picks a verse.
    expect(prepareVerseScorer(verses)('God')('Filler 1:1')).toBe(0);
    expect(prepareVerseScorer(verses)('renewing your mind')('Romans 12:2')).toBeGreaterThan(0);
    // Most of a longer query's words must appear: one shared word is not enough.
    expect(prepareVerseScorer(verses)('shout for the rock of ages')('Psalms 95:1')).toBeGreaterThan(0);
    expect(prepareVerseScorer(verses)('holy mountain temple offering')('Romans 12:1')).toBe(0);
  });
  it('keeps a negation attached to what it negates when choosing a verse', () => {
    const verses = {
      '1 John 2:15': 'Do not love the world or anything in the world. If anyone loves the world, the love of the Father is not in him.',
      'John 3:16': 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.',
      // With only the two verses above, every query term has zero IDF. The wrong
      // verse would score zero even with the negation guard deleted: a vacuous regression test.
      'Psalms 95:1': 'Come, let us sing for joy to the LORD; let us shout to the Rock of our salvation!',
    };
    const score = prepareVerseScorer(verses)('do not love the world');
    // John 3:16 has "not", "loved" and "world", but not "not love".
    expect(score('1 John 2:15')).toBeGreaterThan(0);
    expect(score('John 3:16')).toBe(0);
  });
  it('keeps per-value phrase boundaries and combines field coverage', () => {
    const separated = { ...fixture, id: 'separated', topics: ['Quiet', 'Generosity'], text: undefined };
    const phrase = { ...separated, id: 'phrase', topics: ['Quiet generosity'] };
    expect(search([separated, phrase], 'quiet generosity').map((r) => r.unit.id)).toEqual(['phrase', 'separated']);
    expect(search([fixture], 'fixture community')[0].reasons).toEqual(['Topic match', 'Service match']);
  });
  it('scores int8 cosine, skips zero rows, rejects mismatched shape and invalid query vectors', () => {
    expect(search([fixture], 'unrelated', { vectors: vectors(), queryVector: unit() })[0].reasons).toEqual(['Similar in meaning']);
    for (const index of [vectors([-1]), vectors([1]), { ...vectors(), dimension: 768 }, vectors([0, 0])]) {
      expect(search([fixture], 'unrelated', { vectors: index, queryVector: unit() })).toEqual([]);
    }
    for (const queryVector of [[1], Array(384).fill(0), Array(384).fill(NaN)]) expect(search([fixture], 'unrelated', { vectors: vectors(), queryVector })).toEqual([]);
    const near = unit().map((_, i) => i === 0 ? 0.44 : i === 1 ? Math.sqrt(1 - 0.44 ** 2) : 0);
    expect(search([fixture], 'unrelated', { vectors: vectors(), queryVector: near })).toEqual([]);
    expect(search([fixture], 'unrelated', { vectors: vectors([-1]), queryVector: unit(), semanticThreshold: 0 })).toEqual([]);
  });
  it('has honest empty results and deterministic ties with limits applied after ranking', () => {
    for (const query of ['', '  ', '?!', 'the and', 'zxqvpl']) expect(search([fixture], query)).toEqual([]);
    const chapters = [{ ...fixture, id: 'b' }, { ...fixture, id: 'a' }, { ...fixture, id: 'early', start: 1 }, { ...fixture, id: 'old', date: '2025-09-06' }];
    expect(search(chapters, 'community').map((r) => r.unit.id)).toEqual(['early', 'a', 'b', 'old']);
    expect(search([...chapters].reverse(), 'community')).toEqual(search(chapters, 'community'));
    expect(search(chapters, 'community', { limit: 2 })).toHaveLength(2);
    expect(search(chapters, 'community', { limit: 0 })).toEqual([]);
  });
  it('reevaluates caller edits; metadata edits do not fabricate or invalidate transcript-derived rows', () => {
    const chapter = structuredClone(fixture), index = vectors();
    const options = { vectors: index, queryVector: unit() };
    chapter.text = 'An edited public summary.'; chapter.topics = ['Orchard'];
    expect(search([chapter], 'unrelated', options)[0].reasons).toEqual(['Similar in meaning']);
    index.values[0] = 0;
    expect(search([chapter], 'unrelated', options)).toEqual([]);
    expect(search([chapter], 'orchard')[0].unit).toBe(chapter);
    expect(Object.isFrozen(chapter)).toBe(false);
  });
});

describe('whole-query calendar scope', () => {
  it.each([['2026-07-05', '2026-07-05'], ['5 July 2026', '2026-07-05'], ['July 5, 2026', '2026-07-05'], ['  05 JUL.\n2020 ', '2020-07-05'], ['29 Feb 2000', '2000-02-29'], ['February 29, 2024', '2024-02-29'], ['1 Jan 0099', '0099-01-01']])('parses %s generically and scopes before semantics', (query, date) => {
    expect(parseFullDateQuery(query)).toBe(date);
    const target = { ...fixture, date };
    const incidental = { ...fixture, id: 'other', date: '2025-01-01', title: query };
    expect(search([incidental, target], query, { vectors: vectors([0, 0]), queryVector: unit() }).map((r) => r.unit.id)).toEqual(['fixture']);
  });
  it.each(['2026-02-29', '29 February 1900', '31 Apr 2024', '2026-13-05', '2026-00-05', '2026-07-00', '32 July 2026', '5 Jule 2026', '5 July 0000', 'July', '2026-7-5', 'on 5 July 2026', '5 July 2026 prayer'])('keeps %s ordinary text without rolling over', (query) => {
    expect(parseFullDateQuery(query)).toBeUndefined();
    expect(search([{ ...fixture, title: query }], query)).toHaveLength(1);
  });
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: SemanticResponse }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  onmessageerror?: () => void;
  requests: SemanticRequest[] = []; terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: SemanticRequest) { this.requests.push(message); }
  terminate() { this.terminated = true; }
  receive(data: SemanticResponse) { this.onmessage?.({ data }); }
}
function setupClient() {
  FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  const statuses: SemanticStatus[] = [];
  return { client: createSemanticClient('/review/', (state) => statuses.push(state)), statuses };
}
describe('lazy semantic client', () => {
  it('prepares without a fake query and cancels obsolete requests without destroying the worker', async () => {
    const { client } = setupClient();
    const preparing = client.prepare();
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0]).toEqual({ type: 'prepare', id: 1, base: '/review/' });
    worker.receive({ type: 'prepared', id: 1 }); await preparing;
    const obsolete = expect(client.embed('old query')).rejects.toMatchObject({ name: 'AbortError' });
    client.cancel(); await obsolete;
    expect(worker.requests.at(-1)).toEqual({ type: 'cancel', id: 2 });
    expect(worker.terminated).toBe(false);
    const latest = client.embed('latest');
    worker.receive({ type: 'result', id: 2, vector: unit() });
    worker.receive({ type: 'result', id: 3, vector: unit(1) });
    expect(await latest).toEqual(unit(1)); client.dispose();
  });
  it('initializes only on embed and correlates out-of-order replies', async () => {
    const { client, statuses } = setupClient();
    expect(FakeWorker.instances).toHaveLength(0); expect(statuses).toEqual([{ state: 'idle' }]);
    const first = client.embed('  First\nquery '), second = client.embed('Second query');
    const worker = FakeWorker.instances[0];
    expect(worker.requests[0]).toEqual({ type: 'embed', id: 1, query: 'First query', base: '/review/' });
    worker.receive({ type: 'status', status: { state: 'loading', progress: 0.5 } });
    worker.receive({ type: 'result', id: 2, vector: unit(1) }); worker.receive({ type: 'result', id: 1, vector: unit() });
    expect(await first).toEqual(unit()); expect(await second).toEqual(unit(1));
    expect(statuses).toContainEqual({ state: 'loading', progress: 0.5 });
    client.dispose(); expect(worker.terminated).toBe(true);
  });
  it('rejects failed pending queries and retries with a fresh worker while exact search works', async () => {
    const { client, statuses } = setupClient();
    const assertions = [expect(client.embed('community')).rejects.toThrow('offline'), expect(client.embed('care')).rejects.toThrow('offline')];
    FakeWorker.instances[0].receive({ type: 'error', id: 1, message: 'offline' }); await Promise.all(assertions);
    expect(statuses.at(-1)?.state).toBe('error'); expect(search([fixture], 'community')).toHaveLength(1);
    const retry = client.embed('community'); FakeWorker.instances[1].receive({ type: 'result', id: 3, vector: unit() });
    expect(await retry).toEqual(unit()); client.dispose();
  });
  it('bounds stalled downloads and disposes pending work', async () => {
    vi.useFakeTimers(); const { client } = setupClient();
    const timedOut = expect(client.embed('care')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(120_000); await timedOut;
    const disposed = expect(client.embed('retry')).rejects.toThrow('disposed'); client.dispose(); await disposed;
    await expect(client.embed('again')).rejects.toThrow('disposed');
  });
  it('handles unavailable workers and rejects empty inputs without loading', async () => {
    const { client } = setupClient(); await expect(client.embed('   ')).rejects.toThrow('empty');
    expect(FakeWorker.instances).toHaveLength(0); vi.stubGlobal('Worker', undefined);
    await expect(client.embed('care')).rejects.toThrow(); client.dispose();
  });
});
