import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runChecks, type CheckTask } from './test-runner';
import { browserWorkers, testBudget, unitWorkers } from './testing-config';

const budget = testBudget(), unit = Math.min(budget, unitWorkers()), browser = Math.min(budget, browserWorkers());
/** Environment every check group runs with: Python writes no bytecode files, and media tooling is not
 * authorised (RECS_MEDIA_AUTHORIZED empty). It does not by itself guarantee there is no network access. */
const checkEnvironment = { PYTHONDONTWRITEBYTECODE: '1', RECS_MEDIA_AUTHORIZED: '' };
const task = (name: string, script: string, slots = 1, env = {}): CheckTask => ({
  name, command: 'pnpm', args: [script], slots, env: { ...checkEnvironment, ...env }, timeoutMs: name === 'browser' ? 15 * 60_000 : 10 * 60_000,
  // astro check and astro build both write .astro/. Other independent jobs may overlap either.
  resources: ['types', 'browser'].includes(name) ? ['astro-generated'] : [],
});
const tasks = [
  task('unit', 'test:unit', unit, { RECS_TEST_WORKERS: String(unit) }),
  task('python', 'test:python'), task('lint', 'lint'), task('types', 'typecheck'), task('archive', 'test:archive'),
  task('browser', 'test:browser', browser, { RECS_E2E_WORKERS: String(browser), RECS_E2E_NO_MODEL: '1', SITE_BASE_PATH: '/replay-check/' }),
];
const names = process.argv.slice(2);
if (names.some(name => !tasks.some(task => task.name === name))) throw new Error(`Choose check groups: ${tasks.map(task => task.name).join(', ')}`);
const selected = names.length ? tasks.filter(task => names.includes(task.name)) : tasks;
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
function fingerprint(): string {
  const hash = createHash('sha256').update(git('rev-parse', 'HEAD')).update(git('diff', '--binary', 'HEAD'));
  for (const file of git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()) hash.update(file).update(readFileSync(file));
  return hash.digest('hex');
}
const revision = git('rev-parse', '--short', 'HEAD').trim(), source = fingerprint(), started = new Date();
console.log(`Checking ${revision} · source ${source.slice(0, 12)} · budget ${budget} · ${selected.map(task => task.name).join(', ')}`);
const abort = new AbortController();
const stop = () => abort.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
const results = await runChecks(selected, { budget, signal: abort.signal });
process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
const sourceChanged = source !== fingerprint();
const report = { revision, source, sourceChanged, started: started.toISOString(), durationMs: Date.now() - started.getTime(), results };
mkdirSync('.local/testing', { recursive: true });
const filename = `.local/testing/${started.toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`;
writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
console.table(results.map(({ name, status, durationMs }) => ({ group: name, status, seconds: (durationMs / 1000).toFixed(1) })));
console.log(`Total ${(report.durationMs / 1000).toFixed(1)}s · report ${filename}`);
if (sourceChanged) console.error('Source changed during this run. Rerun affected groups against the final source before accepting the result.');
process.exitCode = sourceChanged || results.some(result => result.code !== 0) ? 1 : 0;
