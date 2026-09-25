import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { enrichPassages } from '../bible/enrich';
import { flattenArchive, loadArchive, publishedServices } from '../site/lib/archive';
import { EMBEDDING_CONFIG, isCompatibleEmbeddingConfig, isEmbeddingVector, MODEL_FILES } from '../site/lib/embedding-config';
import { buildEmbeddingDocument, search, type SearchResult, type VectorIndex } from '../site/lib/search';
import { normalizeScriptureReference, scriptureUrl } from '../site/lib/scripture';
import type { SearchPassage } from '../site/lib/types';
import { embedTexts, sha256, verifyModelFile } from './embeddings';

// Acceptance expectations only: all ranking goes through the product's shared search().
const core = {
  '2026-09-06': ['ZTDYIJUDb0M'],
  '2026-08-16': ['mw4SAoJRZgo', 'XWAH9SWFcoo', 'IcIxBc--VvM'],
  '2026-06-28': ['wh4mCRKRJ-4', 'k27dmsPvmG8'],
  '2020-09-27': ['W2IZ6MUX-Yk'],
  '2025-11-02': ['94fynFHtreg'],
};
const failedId = 'wh4mCRKRJ-4';
interface AcceptanceCase {
  query: string;
  serviceId: string;
  passageIds?: string[];
  speaker?: string;
  reason?: string;
  maxRank: number;
}
const cases: AcceptanceCase[] = [
  { query: 'Romans 13', serviceId: '2020-09-27', reason: 'Scripture match (reference)', maxRank: 1 },
  { query: 'Rom 13', serviceId: '2020-09-27', reason: 'Scripture match (reference)', maxRank: 1 },
  { query: 'Yong Teck Meng', serviceId: '2020-09-27', speaker: 'Rev. Yong Teck Meng', reason: 'Speaker match', maxRank: 3 },
  { query: 'How should Christians relate to government?', serviceId: '2020-09-27', passageIds: ['p0927-romans-government', 'p0927-government-allegiance'], maxRank: 3 },
  { query: 'Abraham and Isaac', serviceId: '2025-11-02', passageIds: ['p1102-abraham-isaac'], maxRank: 3 },
  { query: 'living sacrifice', serviceId: '2025-11-02', passageIds: ['p1102-living-sacrifice'], reason: 'Verse-text match (BSB)', maxRank: 3 },
  { query: '16 August 2026', serviceId: '2026-08-16', reason: 'Date match', maxRank: 1 },
  { query: '27 September 2020', serviceId: '2020-09-27', reason: 'Date match', maxRank: 1 },
];

async function evaluate() {
  if (process.argv.slice(2).filter((arg) => arg !== '--').length) throw new Error('Usage: tsx scripts/evaluate-core.ts');
  const artifact = existsSync('dist/preview/generated/passages.json') ? 'dist/preview/generated' : 'site/public/generated';
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  function check(name: string, run: () => void, detail: string) {
    try { run(); checks.push({ name, pass: true, detail }); }
    catch (error) { checks.push({ name, pass: false, detail: error instanceof Error ? error.message : String(error) }); }
  }
  const services = loadArchive(); // Strict source schema also checks sequence, membership and bounds.
  const source = readFileSync(path.join(artifact, 'passages.json'));
  const passages = JSON.parse(source.toString('utf8')) as SearchPassage[];
  const vectors = JSON.parse(readFileSync(path.join(artifact, 'vectors.json'), 'utf8')) as VectorIndex;
  const production = JSON.parse(readFileSync('dist/production/generated/passages.json', 'utf8')) as SearchPassage[];
  const projected = publishedServices(services, 'preview');
  const physical = services.flatMap((service) => service.videos);
  const service = (id: string) => { const found = services.find((item) => item.id === id); assert.ok(found, `Missing service ${id}`); return found; };

  check('core source and editorial status', () => {
    assert.deepEqual(services.map((item) => item.id).sort(), Object.keys(core).sort());
    for (const [id, videoIds] of Object.entries(core)) {
      const item = service(id);
      assert.equal(item.editorial_status, 'needs_review', id);
      assert.deepEqual(item.videos.map((video) => video.id), videoIds, id);
    }
  }, '5 needs_review services; all 8 required physical IDs retained in order');
  check('evidence-based physical dispositions', () => {
    assert.equal(physical.length, 8);
    for (const video of physical) {
      assert.equal(video.media_disposition, video.id === failedId ? 'failed' : 'playable', video.id);
      assert.ok(video.disposition_evidence?.trim(), `Missing evidence: ${video.id}`);
    }
    assert.ok(physical.find((video) => video.id === failedId)!.duration <= 7);
  }, 'failed seven-second upload retained with evidence; other 7 playable with evidence');
  check('preview canonical artifact', () => {
    assert.deepEqual(passages, enrichPassages(flattenArchive(services, 'preview')));
    assert.ok(passages.length > 0 && passages.every((passage) => passage.preview));
  }, `${passages.length} passages equal the current enriched source projection`);
  check('production exclusion', () => {
    assert.deepEqual(production, flattenArchive(services, 'production'));
    assert.equal(production.length, 0);
  }, '0 production passages; all unapproved records excluded');
  check('failed-media projection exclusion and playable defaults', () => {
    assert.equal(projected.length, 5);
    for (const item of projected) {
      assert.ok(item.videos.length);
      assert.ok(item.videos.every((video) => video.media_disposition === 'playable' && video.id !== failedId));
      assert.ok([...item.sections, ...item.passages].every((segment) => segment.video_id !== failedId));
    }
    assert.ok(passages.every((passage) => passage.videoId !== failedId));
    assert.equal(projected.find((item) => item.id === '2026-06-28')!.videos[0].id, 'k27dmsPvmG8');
  }, 'failed upload absent from display/search projections; June defaults to full stream');
  check('August multipart', () => {
    const august = service('2026-08-16');
    assert.deepEqual(august.videos.map((video) => video.sequence), [1, 2, 3]);
    for (const video of august.videos) assert.ok(passages.some((passage) => passage.serviceId === august.id && passage.videoId === video.id));
  }, 'one service, 3 ordered uploads, indexed passages on each physical upload');
  check('trusted metadata and pre-trimmed sermon', () => {
    const authority = service('2020-09-27');
    assert.equal(authority.title, 'Authority');
    assert.ok(authority.speakers.some((speaker) => speaker.id === 'yong-teck-meng' && speaker.name === 'Rev. Yong Teck Meng'));
    const sacrifice = service('2025-11-02');
    assert.equal(sacrifice.title, 'The Death That Brings Life: Sacrifice');
    assert.equal(sacrifice.type, 'sermon');
    assert.ok(sacrifice.sections.length && sacrifice.sections.every((section) => section.type === 'sermon'));
    for (const [item, references] of [[authority, ['Luke 20:19-26', 'Romans 13:1-7']], [sacrifice, ['Genesis 22:1-19', 'Romans 12:1-2']]] as const) {
      for (const reference of references) assert.ok(item.passages.some((passage) => passage.scripture.includes(reference)), `${item.id}: ${reference}`);
    }
  }, 'Authority speaker/references and Sacrifice title/references/sermon-only chapters preserved');
  check('normalized ESV reference links', () => {
    assert.equal(normalizeScriptureReference('Rom 13'), 'Romans 13');
    for (const passage of passages) for (const reference of passage.scripture) {
      assert.equal(normalizeScriptureReference(reference), reference);
      const url = new URL(scriptureUrl(reference));
      assert.equal(url.origin, 'https://www.esv.org');
      assert.equal(decodeURIComponent(url.pathname), `/${reference}/`);
    }
  }, 'all indexed references normalize and generate reference-only esv.org links');
  check('vector artifact digest/config/inputs', () => {
    assert.equal(vectors.schemaVersion, 1);
    assert.ok(isCompatibleEmbeddingConfig(vectors.model));
    assert.equal(vectors.passagesSha256, sha256(source));
    assert.deepEqual(Object.keys(vectors.vectors).sort(), passages.map((passage) => passage.id).sort());
    for (const passage of passages) {
      const entry = vectors.vectors[passage.id];
      assert.equal(entry.document, buildEmbeddingDocument(passage), passage.id);
      assert.ok(isEmbeddingVector(entry.vector), passage.id);
    }
  }, 'SHA-256 of exact index bytes, shared config, complete ID set, normalized vectors and exact embedding documents');
  check('prepared local model integrity', () => {
    for (const file of MODEL_FILES) {
      assert.ok(verifyModelFile(readFileSync(`site/public/models/${EMBEDDING_CONFIG.model}/${file.path}`), file), file.path);
      if (artifact.startsWith('dist/')) assert.ok(verifyModelFile(readFileSync(`dist/preview/models/${EMBEDDING_CONFIG.model}/${file.path}`), file), `built ${file.path}`);
    }
  }, 'prepared and built model bytes match pinned upstream hashes; no download or external inference');

  // Invalid artifacts cannot earn hybrid acceptance by silently falling back to exact search.
  const ready = checks.every((item) => item.pass);
  const queryVectors = ready ? await embedTexts(cases.map((item) => item.query)) : [];
  const queries = cases.flatMap((item, index) => (['exact', 'hybrid'] as const).map((mode) => {
    const results: SearchResult[] = mode === 'hybrid' && !ready ? [] : search(passages, item.query,
      mode === 'hybrid' ? { vectors, queryVector: queryVectors[index] } : {});
    const rankIndex = results.findIndex(({ passage, reasons }) => passage.serviceId === item.serviceId
      && (!item.passageIds || item.passageIds.includes(passage.id))
      && (!item.speaker || passage.speaker === item.speaker)
      && (!item.reason || reasons.some((reason) => reason.startsWith(item.reason!))));
    const rank = rankIndex < 0 ? null : rankIndex + 1;
    const pass = rank !== null && rank <= item.maxRank;
    return { mode, query: item.query, pass, rank, maxRank: item.maxRank,
      acceptedServiceId: item.serviceId, acceptedPassageIds: item.passageIds,
      detail: mode === 'hybrid' && !ready ? 'Blocked by corpus/artifact checks' : pass ? 'Accepted target and required metadata/reason within rank threshold' : 'Accepted target or required metadata/reason missing from rank threshold',
      top: results.slice(0, 3).map(({ passage, score, reasons }, i) => ({ rank: i + 1, id: passage.id, serviceId: passage.serviceId, videoId: passage.videoId, start: passage.start, end: passage.end, score: Number(score.toFixed(6)), reasons })),
    };
  }));
  const semanticUsed = queries.some((query) => query.mode === 'hybrid' && query.top.some((result) => result.reasons.includes('Semantic similarity')));
  check('real hybrid contribution', () => assert.ok(ready && semanticUsed), 'actual query embeddings contribute semantic similarity to ranked results');
  const failures = checks.filter((item) => !item.pass).length + queries.filter((item) => !item.pass).length;
  console.log(JSON.stringify({ artifact, passagesSha256: sha256(source), model: EMBEDDING_CONFIG,
    counts: { services: services.length, physical: physical.length, preview: passages.length, production: production.length },
    checks, queries, summary: { passed: checks.length + queries.length - failures, failed: failures, total: checks.length + queries.length } }, null, 2));
  if (failures) process.exitCode = 1;
}

evaluate().catch((error: unknown) => {
  console.error(JSON.stringify({ pass: false, blocker: 'Core acceptance could not run', reason: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
