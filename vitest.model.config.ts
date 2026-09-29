import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/model.integration.ts'], fileParallelism: false, isolate: true, pool: 'forks' } });
