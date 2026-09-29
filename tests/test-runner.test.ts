import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runChecks, type CheckTask } from '../scripts/test-runner';
import { workerLimit } from '../scripts/testing-config';

const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(path.join(tmpdir(), 'recs-runner-')); roots.push(root); return root; };
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const node = (name: string, code: string, slots = 1): CheckTask => ({ name, command: process.execPath, args: ['-e', code], slots, timeoutMs: 8000 });
const quiet = () => {};

it('overlaps independent jobs, reports failures immediately and continues queued work', async () => {
  const logs: string[] = [];
  // File handshakes prove overlap; no fragile wall-clock speed assertion.
  const result = await runChecks([
    node('slow', `const fs=require('node:fs');fs.writeFileSync('ready','');const t=setInterval(()=>{if(fs.existsSync('release')){clearInterval(t);console.log('done')}},10)`),
    node('broken', `const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync('ready')){fs.writeFileSync('release','');clearInterval(t);process.exitCode=7}},10)`),
    node('later', `console.log('still ran')`),
  ], { budget: 2, cwd: fixture(), log: line => logs.push(line) });
  expect(result.map(({ name, code, status }) => ({ name, code, status }))).toEqual([
    { name: 'slow', code: 0, status: 'passed' }, { name: 'broken', code: 7, status: 'failed' }, { name: 'later', code: 0, status: 'passed' },
  ]);
  expect(logs).toContain('[later] still ran');
  expect(logs.some(line => line.startsWith('[broken] FAILED') && line.includes('rerun:'))).toBe(true);
}, 15_000);

it('honours weighted worker limits', async () => {
  const code = `const fs=require('node:fs');fs.mkdirSync('exclusive');setTimeout(()=>fs.rmdirSync('exclusive'),50)`;
  const result = await runChecks([node('a', code, 2), node('b', code, 2)], { budget: 2, cwd: fixture(), log: quiet });
  expect(result.map(item => item.status)).toEqual(['passed', 'passed']);
});

it('serializes shared generated resources even when worker slots are available', async () => {
  const code = `const fs=require('node:fs');fs.mkdirSync('exclusive');setTimeout(()=>fs.rmdirSync('exclusive'),50)`;
  const tasks = [node('check', code), node('build', code)].map(task => ({ ...task, resources: ['astro-generated'] }));
  const result = await runChecks(tasks, { budget: 2, cwd: fixture(), log: quiet });
  expect(result.map(item => item.status)).toEqual(['passed', 'passed']);
});

it('bounds hung tasks and still reports other failures and missing commands', async () => {
  const result = await runChecks([
    { ...node('hung', 'setInterval(()=>{},1000)'), timeoutMs: 150 },
    { name: 'missing', command: '/no-such-recs-test-command', args: [] }, node('healthy', ''),
  ], { budget: 2, log: quiet });
  expect(result.map(item => item.status)).toEqual(['timeout', 'failed', 'passed']);
});

it('cancels active jobs and does not launch queued jobs', async () => {
  const controller = new AbortController(), logs: string[] = [];
  const result = await runChecks([
    node('active', `console.log('ready');setInterval(()=>{},1000)`), node('queued', `console.log('should not run')`),
  ], { budget: 1, signal: controller.signal, log: line => { logs.push(line); if (line === '[active] ready') controller.abort(); } });
  expect(result.map(item => item.status)).toEqual(['cancelled', 'cancelled']);
  expect(logs).not.toContain('[queued] should not run');
});

it.skipIf(process.platform === 'win32')('cancels owned grandchildren as well as the immediate runner', async () => {
  const controller = new AbortController();
  let descendant = 0;
  const child = `console.log('ready '+process.pid);setInterval(()=>{},1000)`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
  const results = await runChecks([node('tree', parent)], { budget: 1, signal: controller.signal, log: line => {
    const ready = /\[tree\] ready (\d+)/.exec(line);
    if (ready) { descendant = Number(ready[1]); controller.abort(); }
  } });
  expect(descendant).toBeGreaterThan(0);
  expect(results[0].status).toBe('cancelled');
  await expect.poll(() => { try { process.kill(descendant, 0); return true; } catch { return false; } }).toBe(false);
});

it.each(['0', '-1', 'NaN', '2.5', '', '2workers'])('rejects invalid worker limit %j', value => {
  expect(() => workerLimit(value, 2)).toThrow('positive integers');
});
