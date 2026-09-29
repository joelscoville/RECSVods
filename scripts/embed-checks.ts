/** Archive-sized checks use bounded batches and share one wall-clock probing budget. */
import { MAX_EMBED_BATCH_SIZE, probeEmbeds, type EmbedProbeResult } from './probe-embeds';

export const DEFAULT_EMBED_BUDGET_SECONDS = 600;
export const MAX_EMBED_BUDGET_SECONDS = 900;
export interface EmbedCheckOptions { budgetSeconds: number; startAt?: string }

export async function checkArchiveEmbeds(ids: readonly string[], options: EmbedCheckOptions) {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id))) {
    throw new Error('Select at least one unique YouTube ID');
  }
  if (!Number.isInteger(options.budgetSeconds) || options.budgetSeconds < 1 || options.budgetSeconds > MAX_EMBED_BUDGET_SECONDS) {
    throw new Error(`Embed budget must be 1–${MAX_EMBED_BUDGET_SECONDS} whole seconds`);
  }
  const start = options.startAt === undefined ? 0 : ids.indexOf(options.startAt);
  if (start < 0) throw new Error('--start-at must name a video in the selected archive');
  // Wrap so a resumed check still visits every selected upload if time permits.
  const ordered = [...ids.slice(start), ...ids.slice(0, start)];
  const deadlineMs = Date.now() + options.budgetSeconds * 1000;
  const results: EmbedProbeResult[] = [];
  for (let offset = 0; offset < ordered.length; offset += MAX_EMBED_BATCH_SIZE) {
    if (Date.now() >= deadlineMs) break;
    const batch = ordered.slice(offset, offset + MAX_EMBED_BATCH_SIZE);
    const checked = await probeEmbeds(batch, { deadlineMs });
    results.push(...checked);
    if (checked.length < batch.length) break;
  }
  const skippedVideoIds = ordered.slice(results.length);
  return { results, skippedVideoIds, nextStartAt: skippedVideoIds[0] ?? null, budgetSeconds: options.budgetSeconds };
}
