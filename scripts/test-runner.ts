import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CheckTask {
  name: string; command: string; args: string[]; slots?: number;
  env?: NodeJS.ProcessEnv; timeoutMs?: number; resources?: string[];
}
export interface CheckResult { name: string; code: number; durationMs: number; status: 'passed' | 'failed' | 'cancelled' | 'timeout'; rerun: string }

/** Independent jobs continue after failures. Cases inside each runner remain sequential/isolated.
 * Children own process groups on POSIX, so interrupting a run also terminates servers and grandchildren. */
export async function runChecks(tasks: CheckTask[], options: {
  budget: number; cwd?: string; signal?: AbortSignal; log?: (line: string) => void;
}): Promise<CheckResult[]> {
  if (!Number.isSafeInteger(options.budget) || options.budget < 1) throw new Error('Invalid check budget');
  if (new Set(tasks.map(task => task.name)).size !== tasks.length) throw new Error('Duplicate check names');
  for (const task of tasks) if (!Number.isSafeInteger(task.slots ?? 1) || (task.slots ?? 1) < 1 || (task.slots ?? 1) > options.budget) throw new Error(`Invalid slots for ${task.name}`);
  const log = options.log ?? console.log;
  const pending = [...tasks], results = new Map<string, CheckResult>();
  const running = new Map<string, { slots: number; promise: Promise<void> }>();
  const resources = new Set<string>();
  let used = 0;
  const run = async (task: CheckTask): Promise<void> => {
    const quote = (value: string) => /^[\w./:=+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
    const overrides = ['RECS_TEST_WORKERS', 'RECS_E2E_WORKERS', 'RECS_TEST_PORT', 'RECS_TEST_SEED']
      .flatMap(key => { const value = task.env?.[key] ?? process.env[key]; return value === undefined ? [] : [`${key}=${quote(value)}`]; });
    const started = performance.now(), rerun = [...overrides, ...[task.command, ...task.args].map(quote)].join(' ');
    const state: { status: CheckResult['status'] } = { status: 'failed' };
    let code = 1;
    if (options.signal?.aborted) state.status = 'cancelled';
    else {
      log(`[${task.name}] START · ${rerun}`);
      const child = spawn(task.command, task.args, { cwd: options.cwd, env: { ...process.env, ...task.env },
        stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => log(`[${task.name}] ${line}`));
      const kill = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      };
      let force: ReturnType<typeof setTimeout> | undefined;
      const stop = (reason: 'timeout' | 'cancelled') => {
        state.status = reason; kill('SIGTERM');
        force ??= setTimeout(() => kill('SIGKILL'), 2000);
      };
      const abort = () => stop('cancelled');
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => stop('timeout'), task.timeoutMs ?? 10 * 60_000);
      code = await new Promise<number>(resolve => {
        child.on('error', error => log(`[${task.name}] ${error.message}`));
        child.on('close', exit => resolve(exit ?? 1));
        if (options.signal?.aborted) abort();
      });
      clearTimeout(timer); clearTimeout(force);
      options.signal?.removeEventListener('abort', abort);
      if (state.status === 'timeout' || state.status === 'cancelled') { kill('SIGKILL'); code = 1; }
      else state.status = code === 0 ? 'passed' : 'failed';
    }
    const result = { name: task.name, code, durationMs: Math.round(performance.now() - started), status: state.status, rerun };
    results.set(task.name, result);
    log(`[${task.name}] ${result.status.toUpperCase()} · ${(result.durationMs / 1000).toFixed(1)}s · rerun: ${rerun}`);
  };
  while (pending.length || running.size) {
    for (let i = 0; i < pending.length;) {
      const task = pending[i], slots = task.slots ?? 1;
      if (used + slots > options.budget || task.resources?.some(resource => resources.has(resource))) { i++; continue; }
      pending.splice(i, 1); used += slots;
      task.resources?.forEach(resource => resources.add(resource));
      const promise = run(task).finally(() => {
        used -= slots; running.delete(task.name);
        task.resources?.forEach(resource => resources.delete(resource));
      });
      running.set(task.name, { slots, promise });
    }
    if (running.size) await Promise.race([...running.values()].map(item => item.promise));
  }
  return tasks.map(task => results.get(task.name)!);
}
