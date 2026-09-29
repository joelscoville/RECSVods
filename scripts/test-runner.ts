import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface CheckTask {
  name: string; command: string; args: string[]; slots?: number;
  env?: NodeJS.ProcessEnv; timeoutMs?: number; resources?: string[];
}
export interface CheckResult { name: string; code: number; durationMs: number; status: 'passed' | 'failed' | 'cancelled' | 'timeout'; rerun: string }
interface RunContext { cwd?: string; signal?: AbortSignal; log: (line: string) => void }

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** After SIGTERM, a process group that has not exited is killed outright after this delay. */
const FORCE_KILL_DELAY_MS = 2000;
/** Environment variables that change how a task runs, so they belong in its rerun command. */
const RERUN_OVERRIDES = ['RECS_TEST_WORKERS', 'RECS_E2E_WORKERS', 'RECS_TEST_PORT', 'RECS_TEST_SEED'];

function shellQuote(value: string): string {
  return /^[\w./:=+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
/** The command line that reproduces a task, including the environment overrides that affect it. */
function rerunCommand(task: CheckTask): string {
  const overrides = RERUN_OVERRIDES.flatMap((key) => {
    const value = task.env?.[key] ?? process.env[key];
    return value === undefined ? [] : [`${key}=${shellQuote(value)}`];
  });
  return [...overrides, ...[task.command, ...task.args].map(shellQuote)].join(' ');
}

/** Runs one task as its own process group (on POSIX), streaming its output with a [name] prefix. It stops
 * the whole group, including servers and grandchildren, on timeout or cancellation. It resolves with the
 * result and never rejects because the command failed. */
export async function runCheckTask(task: CheckTask, context: RunContext): Promise<CheckResult> {
  const { log, signal } = context;
  const started = performance.now(), rerun = rerunCommand(task);
  let status: CheckResult['status'] = 'failed';
  let code = 1;
  if (signal?.aborted) {
    status = 'cancelled';
  } else {
    log(`[${task.name}] START · ${rerun}`);
    const child = spawn(task.command, task.args, {
      cwd: context.cwd, env: { ...process.env, ...task.env },
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => log(`[${task.name}] ${line}`));
    const killGroup = (killSignal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(killSignal);
        else process.kill(-child.pid, killSignal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    // Set from the timeout and abort callbacks; decides the outcome once the process has closed.
    let stoppedBy: 'timeout' | 'cancelled' | undefined;
    const stop = (reason: 'timeout' | 'cancelled') => {
      stoppedBy = reason;
      killGroup('SIGTERM');
      forceKill ??= setTimeout(() => killGroup('SIGKILL'), FORCE_KILL_DELAY_MS);
    };
    const onAbort = () => stop('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => stop('timeout'), task.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    code = await new Promise<number>((resolve) => {
      child.on('error', (error) => log(`[${task.name}] ${error.message}`));
      child.on('close', (exit) => resolve(exit ?? 1));
      if (signal?.aborted) onAbort();
    });
    clearTimeout(timeout);
    clearTimeout(forceKill);
    signal?.removeEventListener('abort', onAbort);
    if (stoppedBy) {
      status = stoppedBy;
      killGroup('SIGKILL');
      code = 1;
    } else {
      status = code === 0 ? 'passed' : 'failed';
    }
  }
  const result: CheckResult = { name: task.name, code, durationMs: Math.round(performance.now() - started), status, rerun };
  log(`[${task.name}] ${result.status.toUpperCase()} · ${(result.durationMs / 1000).toFixed(1)}s · rerun: ${rerun}`);
  return result;
}

function validateTasks(tasks: CheckTask[], budget: number): void {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('Invalid check budget');
  if (new Set(tasks.map((task) => task.name)).size !== tasks.length) throw new Error('Duplicate check names');
  for (const task of tasks) {
    const slots = task.slots ?? 1;
    if (!Number.isSafeInteger(slots) || slots < 1 || slots > budget) throw new Error(`Invalid slots for ${task.name}`);
  }
}

/** Schedules independent tasks within a budget of worker slots. A task starts when its slots fit and none
 * of its named resources is held by a running task. Jobs continue after failures, and cases inside each
 * runner stay sequential and isolated. Results are returned in task order. */
export async function runChecks(tasks: CheckTask[], options: {
  budget: number; cwd?: string; signal?: AbortSignal; log?: (line: string) => void;
}): Promise<CheckResult[]> {
  validateTasks(tasks, options.budget);
  const context: RunContext = { cwd: options.cwd, signal: options.signal, log: options.log ?? console.log };
  const pending = [...tasks];
  const results = new Map<string, CheckResult>();
  const running = new Map<string, Promise<void>>();
  const heldResources = new Set<string>();
  let usedSlots = 0;
  const canStart = (task: CheckTask) => usedSlots + (task.slots ?? 1) <= options.budget
    && !task.resources?.some((resource) => heldResources.has(resource));
  const start = (task: CheckTask) => {
    const slots = task.slots ?? 1;
    usedSlots += slots;
    task.resources?.forEach((resource) => heldResources.add(resource));
    const finished = runCheckTask(task, context)
      .then((result) => { results.set(task.name, result); })
      .finally(() => {
        usedSlots -= slots;
        running.delete(task.name);
        task.resources?.forEach((resource) => heldResources.delete(resource));
      });
    running.set(task.name, finished);
  };
  while (pending.length || running.size) {
    for (let index = 0; index < pending.length;) {
      if (canStart(pending[index])) start(pending.splice(index, 1)[0]);
      else index += 1;
    }
    if (running.size) await Promise.race(running.values());
  }
  return tasks.map((task) => results.get(task.name)!);
}
