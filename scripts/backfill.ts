import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadArchive } from '../site/lib/archive';
import { importBackfill, loadBackfill, nextBackfill, reportBackfill, transitionBackfill, validateBackfill } from '../site/lib/backfill';

const USAGE = 'Usage: tsx scripts/backfill.ts import --input PATH | validate | next --batch ID [--limit N] [--resume SERVICE] | transition --service ID --to registered|in_progress|complete|blocked [--reason TEXT] | report [--batch ID] [--year YYYY] [--baseline ROOT]';
export function backfillCli(args = process.argv.slice(2), root = process.cwd()): unknown {
  if (args[0] === '--') args = args.slice(1);
  const [command, ...rest] = args; const options: Record<string, string> = {};
  const allowed: Record<string, string[]> = { import: ['input'], validate: [], next: ['batch', 'limit', 'resume'], transition: ['service', 'to', 'reason'], report: ['batch', 'year', 'baseline'] };
  if (!Object.hasOwn(allowed, command)) throw new Error(USAGE);
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2); const value = rest[i + 1];
    if (!rest[i].startsWith('--') || !allowed[command].includes(key) || key in options || !value || value.startsWith('--')) throw new Error(USAGE);
    options[key] = value;
  }
  if (command === 'import' && options.input) return importBackfill(root, options.input);
  if (command === 'validate') return validateBackfill(root);
  if (command === 'next' && options.batch) return nextBackfill(loadBackfill(root), options.batch, { ...(options.limit ? { limit: Number(options.limit) } : {}), resume: options.resume });
  if (command === 'transition' && options.service && ['registered', 'in_progress', 'complete', 'blocked'].includes(options.to)) {
    return transitionBackfill(root, options.service, options.to as 'registered' | 'in_progress' | 'complete' | 'blocked', options.reason);
  }
  if (command === 'report') return reportBackfill(root, { batch: options.batch, year: options.year, baseline: options.baseline ? loadArchive(path.resolve(root, options.baseline)) : undefined });
  throw new Error(USAGE);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(backfillCli(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
