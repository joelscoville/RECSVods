import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareBudget, parseBudgets, percentile, validateOutputPath, type Measurement } from '../scripts/benchmark-search';

const policy = () => JSON.parse(readFileSync(new URL('../performance/budgets.json', import.meta.url), 'utf8'));

describe('performance policy and evidence helpers', () => {
  it('distinguishes inclusive, strict host limits, and exact counts at the boundary', () => {
    const reading: Measurement = { status: 'measured', value: 10 };
    expect(compareBudget({ limit: 10, operator: '<=', unit: 'bytes' }, reading).status).toBe('pass');
    expect(compareBudget({ limit: 10, operator: '<', unit: 'bytes' }, reading).status).toBe('fail');
    expect(compareBudget({ limit: 11, operator: '<', unit: 'bytes' }, reading).status).toBe('pass');
    expect(compareBudget({ limit: 1, operator: '==', unit: 'requests' }, { status: 'measured', value: 0 }).status).toBe('fail');
    expect(compareBudget({ limit: 0, operator: '==', unit: 'requests' }, { status: 'measured', value: 0 }).status).toBe('pass');
  });

  it('preserves unsupported evidence and rejects missing, nonfinite, or coerced measurements', () => {
    const rule = { limit: 10, operator: '<=', unit: 'bytes' } as const;
    expect(compareBudget(rule, { status: 'unsupported', reason: 'Worker heap protocol unavailable' })).toMatchObject({ status: 'unsupported', reason: 'Worker heap protocol unavailable' });
    for (const value of [NaN, Infinity, -1, '0', null, undefined, false]) {
      expect(() => compareBudget(rule, { status: 'measured', value } as Measurement)).toThrow();
    }
    expect(() => compareBudget(rule, { status: 'unsupported', reason: '' })).toThrow();
    expect(() => compareBudget(rule, { status: 'invented', value: 0 } as unknown as Measurement)).toThrow();
  });

  it('uses nearest rank without mutating samples or concealing tails with interpolation', () => {
    const samples = [80, 10, 30, 20];
    expect(percentile(samples, 0.5)).toBe(20);
    expect(percentile(samples, 0.95)).toBe(80);
    expect(samples).toEqual([80, 10, 30, 20]);
    expect(percentile([...Array<number>(19).fill(1), 100], 0.95)).toBe(1);
    expect(percentile([0], 1)).toBe(0);
    for (const input of [[], [NaN], [-1], [Infinity]]) expect(() => percentile(input, 0.95)).toThrow();
    for (const quantile of [0, -1, 1.01, NaN, Infinity]) expect(() => percentile([1], quantile)).toThrow();
  });

  it('loads the declared policy strictly, requiring coverage and correctly typed units', () => {
    expect(parseBudgets(policy()).schemaVersion).toBe(1);
    const missing = policy(); delete missing.budgets['model.coldJsHeapBytes'];
    expect(() => parseBudgets(missing)).toThrow('Missing budget');
    const wrongUnit = policy(); wrongUnit.budgets['model.coldMs'].unit = 'bytes';
    expect(() => parseBudgets(wrongUnit)).toThrow('Wrong unit');
    const typo = policy(); typo.budgets['model.typoBytes'] = { limit: 1, operator: '<=', unit: 'bytes' };
    expect(() => parseBudgets(typo)).toThrow();
    for (const value of ['150', null, Infinity, -1]) {
      const invalid = policy(); invalid.budgets['search.exactP95Ms'].limit = value;
      expect(() => parseBudgets(invalid)).toThrow();
    }
    const unbounded = policy(); unbounded.profile.runTimeoutMs = 0;
    expect(() => parseBudgets(unbounded)).toThrow();
  });

  it('restricts report destinations to local performance JSON names', () => {
    expect(validateOutputPath('.local/performance-report.json')).toBe('.local/performance-report.json');
    expect(validateOutputPath('.local/performance-after-12.json')).toBe('.local/performance-after-12.json');
    for (const filename of ['dist/preview/report.json', 'site/public/report.json', '/tmp/performance.json', '.local/../performance.json',
      '.local/nested/performance.json', '.local/media-authorization.json', '.local/performance.json/other', '.local/performance.txt', '.local\\performance.json']) {
      expect(() => validateOutputPath(filename)).toThrow();
    }
  });
});
