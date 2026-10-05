import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSemanticSearchSession,
  type SemanticSnapshot,
} from '../site/lib/semantic-search-session';
import { CHAPTER_VECTOR_CONFIG } from '../site/lib/chapter-vectors';
import type {
  ChapterMetadata,
  ChapterVectors,
} from '../site/lib/chapter-index';
import type { SemanticClient, SemanticStatus } from '../site/lib/semantic';
import { units } from './recording-fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function metadata(digest = 'a'): ChapterMetadata {
  const sha256 = digest.repeat(64);
  return {
    schemaVersion: 6,
    model: CHAPTER_VECTOR_CONFIG,
    vectors: { sha256, file: `vectors.${sha256}.bin` },
    units: units().slice(0, 1),
  };
}
function rows(): ChapterVectors {
  return { dimension: 384, rowCount: 1, values: new Int8Array(384).fill(1) };
}
const vector = (axis: number) =>
  Array.from({ length: 384 }, (_, index) => Number(index === axis));
const query = (text: string, immediate = true) => ({ text, immediate });
const sessions: ReturnType<typeof createSemanticSearchSession>[] = [];

function setup(delayedPreparation = false) {
  const embeddings: {
    text: string;
    task: ReturnType<typeof deferred<number[]>>;
  }[] = [];
  const downloads: {
    metadata: ChapterMetadata;
    task: ReturnType<typeof deferred<ChapterVectors>>;
  }[] = [];
  const clients: {
    client: SemanticClient;
    preparation: ReturnType<typeof deferred<void>>;
    emit: (status: SemanticStatus) => void;
  }[] = [];
  let latest: SemanticSnapshot = { status: { state: 'idle' }, error: false };
  const publish = vi.fn((snapshot: SemanticSnapshot) => {
    latest = snapshot;
  });
  const createClient = vi.fn(
    (
      _base: string,
      emit: (status: SemanticStatus) => void = () => {},
      _cacheOnly = false,
    ): SemanticClient => {
      const preparation = deferred<void>();
      if (!delayedPreparation) preparation.resolve();
      const client: SemanticClient = {
        prepare: vi.fn(() => preparation.promise),
        // Deliberately allow work to settle after cancellation, as an external worker can.
        cancel: vi.fn(),
        dispose: vi.fn(),
        embed: vi.fn((text: string) => {
          const task = deferred<number[]>();
          embeddings.push({ text, task });
          return task.promise;
        }),
      };
      clients.push({ client, preparation, emit });
      emit({ state: 'idle' });
      return client;
    },
  );
  const loadVectors = vi.fn((_base: string, archive: ChapterMetadata) => {
    const task = deferred<ChapterVectors>();
    downloads.push({ metadata: archive, task });
    return task.promise;
  });
  const session = createSemanticSearchSession('/replay-check/', publish, {
    createClient,
    loadVectors,
  });
  sessions.push(session);
  return {
    session,
    publish,
    createClient,
    loadVectors,
    embeddings,
    downloads,
    clients,
    latest: () => latest,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.useRealTimers();
});

describe('semantic search ownership', () => {
  it('prepares automatically, debounces typing and reuses one client', async () => {
    const env = setup();
    const archive = metadata();
    env.session.update({
      query: query('', false),
      metadata: archive,
      allowed: true,
    });
    expect(env.createClient).toHaveBeenCalledExactlyOnceWith(
      '/replay-check/',
      expect.any(Function),
      true,
    );
    expect(env.clients[0].client.prepare).toHaveBeenCalledOnce();
    env.session.update({
      query: query('pray', false),
      metadata: archive,
      allowed: true,
    });
    env.session.update({
      query: query('prayer', false),
      metadata: archive,
      allowed: true,
    });
    expect(env.embeddings).toHaveLength(0);
    await vi.runOnlyPendingTimersAsync();
    expect(env.embeddings.map((request) => request.text)).toEqual(['prayer']);
    expect(env.createClient).toHaveBeenCalledOnce();
  });

  it.each(['success', 'error'] as const)(
    'ignores a stale query %s after a newer query completes',
    async (outcome) => {
      const env = setup();
      const archive = metadata();
      env.session.update({
        query: query('old'),
        metadata: archive,
        allowed: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      const currentQuery = query('current');
      env.session.update({
        query: currentQuery,
        metadata: archive,
        allowed: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      env.downloads[0].task.resolve(rows());
      env.embeddings[1].task.resolve(vector(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(env.latest().result).toEqual({
        query: currentQuery,
        metadata: archive,
        queryVector: vector(1),
      });
      env.publish.mockClear();
      if (outcome === 'success') env.embeddings[0].task.resolve(vector(0));
      else env.embeddings[0].task.reject(new Error('Late worker failure'));
      await vi.advanceTimersByTimeAsync(0);
      expect(env.publish).not.toHaveBeenCalled();
      expect(env.loadVectors).toHaveBeenCalledOnce();
      expect(env.clients[0].client.cancel).toHaveBeenCalled();
    },
  );

  it('rejects old archive results even when the query object and row count are unchanged', async () => {
    const env = setup();
    const request = query('prayer');
    const first = metadata('a');
    const second = metadata('b');
    env.session.update({ query: request, metadata: first, allowed: true });
    await vi.advanceTimersByTimeAsync(0);
    env.session.update({ query: request, metadata: second, allowed: true });
    await vi.advanceTimersByTimeAsync(0);
    env.downloads[1].task.resolve(rows());
    env.embeddings[1].task.resolve(vector(1));
    await vi.advanceTimersByTimeAsync(0);
    env.publish.mockClear();
    env.downloads[0].task.resolve(rows());
    env.embeddings[0].task.resolve(vector(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(env.publish).not.toHaveBeenCalled();
    expect(env.latest().vectors?.metadata).toBe(second);
    expect(env.latest().result?.metadata).toBe(second);
    expect(env.loadVectors).toHaveBeenCalledTimes(2);
  });

  it.each(['disable', 'dispose', 'cancel'] as const)(
    'rejects pending work after %s',
    async (stop) => {
      const env = setup();
      const input = {
        query: query('pending'),
        metadata: metadata(),
        allowed: true,
      };
      env.session.update(input);
      await vi.advanceTimersByTimeAsync(0);
      if (stop === 'disable') env.session.update({ ...input, allowed: false });
      else if (stop === 'dispose') env.session.dispose();
      else env.session.cancelQuery();
      env.publish.mockClear();
      env.downloads[0].task.resolve(rows());
      env.embeddings[0].task.resolve(vector(0));
      await vi.advanceTimersByTimeAsync(0);
      expect(env.publish).not.toHaveBeenCalled();
      expect(env.latest().result).toBeUndefined();
      if (stop !== 'cancel')
        expect(env.clients[0].client.dispose).toHaveBeenCalledOnce();
    },
  );

  it('cannot start delayed work or accept updates after disposal', async () => {
    const env = setup();
    const input = {
      query: query('pending', false),
      metadata: metadata(),
      allowed: true,
    };
    env.session.update(input);
    env.session.dispose();
    env.publish.mockClear();
    env.session.update({ ...input, query: query('too late') });
    env.clients[0].emit({ state: 'error' });
    await vi.runOnlyPendingTimersAsync();
    expect(env.embeddings).toEqual([]);
    expect(env.publish).not.toHaveBeenCalled();
  });

  it('ignores disposed-client status and preparation failures after re-enabling', async () => {
    const env = setup(true);
    const input = {
      query: query('prayer'),
      metadata: metadata(),
      allowed: true,
    };
    env.session.update(input);
    await vi.advanceTimersByTimeAsync(0);
    env.downloads[0].task.resolve(rows());
    env.session.update({ ...input, allowed: false });
    env.session.update(input);
    await vi.advanceTimersByTimeAsync(0);
    env.publish.mockClear();
    env.clients[0].emit({ state: 'error' });
    env.clients[0].preparation.reject(
      new Error('Old model preparation failed'),
    );
    env.embeddings[0].task.reject(new Error('Old query failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(env.publish).not.toHaveBeenCalled();
    env.clients[1].emit({ state: 'ready' });
    env.clients[1].preparation.resolve();
    env.embeddings[1].task.resolve(vector(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(env.latest().error).toBe(false);
    expect(env.latest().result?.queryVector).toEqual(vector(1));
    expect(env.createClient).toHaveBeenCalledTimes(2);
    expect(env.loadVectors).toHaveBeenCalledOnce();
  });

  it('reports a current failure and retries the failed vector load', async () => {
    const env = setup();
    const input = {
      query: query('prayer'),
      metadata: metadata(),
      allowed: true,
    };
    env.session.update(input);
    await vi.advanceTimersByTimeAsync(0);
    env.downloads[0].task.reject(new Error('Download failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(env.latest().error).toBe(true);
    env.session.update(input);
    expect(env.latest().error).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    env.downloads[1].task.resolve(rows());
    env.embeddings[1].task.resolve(vector(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(env.latest().result?.queryVector).toEqual(vector(1));
    expect(env.loadVectors).toHaveBeenCalledTimes(2);
    expect(env.createClient).toHaveBeenCalledOnce();
  });
});
