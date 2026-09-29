import { afterEach, expect, it, vi } from 'vitest';
import { checkArchiveEmbeds } from '../scripts/embed-checks';
import * as probes from '../scripts/probe-embeds';

const ids = Array.from({ length: 101 }, (_, i) => `V${String(i).padStart(10, '0')}`);
const playable = (batch: readonly string[]) => batch.map(videoId => ({ videoId, observation: probes.classifyEmbedProbe({ advanced: true }, '2026-09-29T00:00:00Z') }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('checks archives larger than 50 in bounded batches sharing one deadline', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const probe = vi.spyOn(probes, 'probeEmbeds').mockImplementation(async batch => {
    vi.setSystemTime(Date.now() + 100);
    return playable(batch);
  });
  const report = await checkArchiveEmbeds(ids, { budgetSeconds: 2 });
  expect(probe.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 1]);
  expect(probe.mock.calls.map(([, options]) => options?.deadlineMs)).toEqual([2000, 2000, 2000]);
  expect(report.results.map(result => result.videoId)).toEqual(ids);
  expect(report.skippedVideoIds).toEqual([]); expect(report.nextStartAt).toBeNull();
});

it('stops between batches at the budget, retaining results and identifying unchecked uploads', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const probe = vi.spyOn(probes, 'probeEmbeds').mockImplementation(async batch => {
    vi.setSystemTime(1000);
    return playable(batch);
  });
  const report = await checkArchiveEmbeds(ids, { budgetSeconds: 1 });
  expect(probe).toHaveBeenCalledTimes(1); expect(report.results).toHaveLength(50);
  expect(report.skippedVideoIds).toEqual(ids.slice(50)); expect(report.nextStartAt).toBe(ids[50]);
});

it('resumes from the first skipped upload after a partial batch and wraps without duplicates', async () => {
  const probe = vi.spyOn(probes, 'probeEmbeds').mockResolvedValueOnce(playable(ids.slice(0, 3)));
  const first = await checkArchiveEmbeds(ids, { budgetSeconds: 1 });
  expect(first.skippedVideoIds).toEqual(ids.slice(3)); expect(first.nextStartAt).toBe(ids[3]);
  probe.mockImplementation(async batch => playable(batch));
  const resumed = await checkArchiveEmbeds(ids, { budgetSeconds: 600, startAt: first.nextStartAt! });
  expect(resumed.results.map(result => result.videoId)).toEqual([...ids.slice(3), ...ids.slice(0, 3)]);
  expect(resumed.skippedVideoIds).toEqual([]);
});

it('rejects invalid selection/budgets before starting browser work', async () => {
  const probe = vi.spyOn(probes, 'probeEmbeds');
  for (const selected of [[], [ids[0], ids[0]], ['bad-id']]) {
    await expect(checkArchiveEmbeds(selected, { budgetSeconds: 600 })).rejects.toThrow();
  }
  for (const budgetSeconds of [0, -1, 1.1, 901, Infinity, NaN]) {
    await expect(checkArchiveEmbeds(ids, { budgetSeconds })).rejects.toThrow('budget');
  }
  await expect(checkArchiveEmbeds(ids, { budgetSeconds: 600, startAt: 'ZZZZZZZZZZZ' })).rejects.toThrow('--start-at');
  expect(probe).not.toHaveBeenCalled();
});

it('does not launch a browser for an already-expired batch', async () => {
  await expect(probes.probeEmbeds([ids[0]], { deadlineMs: Date.now() - 1 })).resolves.toEqual([]);
});
