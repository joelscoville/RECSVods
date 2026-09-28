import { availableParallelism } from 'node:os';

/** Explicit, positive limits; never let nested runners independently claim every CPU. */
export function workerLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Test worker limits must be positive integers');
  return Number(value);
}
export const testBudget = () => workerLimit(process.env.RECS_TEST_JOBS, Math.min(4, availableParallelism()));
export const unitWorkers = () => workerLimit(process.env.RECS_TEST_WORKERS, Math.min(2, testBudget()));
export const browserWorkers = () => workerLimit(process.env.RECS_E2E_WORKERS, Math.min(2, testBudget()));
export function browserEndpoints() {
  const port = workerLimit(process.env.RECS_TEST_PORT, 4173);
  if (port > 65534) throw new Error('RECS_TEST_PORT needs two consecutive ports below 65536');
  return { port, preview: `http://127.0.0.1:${port}/replay-check/`, production: `http://127.0.0.1:${port + 1}/replay-check/` };
}
