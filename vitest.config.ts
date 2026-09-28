import { defineConfig } from 'vitest/config';
import { unitWorkers } from './scripts/testing-config.ts';
export default defineConfig({ test: {
  include: ['tests/**/*.test.ts'], pool: 'forks', isolate: true,
  fileParallelism: true, maxWorkers: unitWorkers(),
} });
