import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/*.acceptance.ts'], fileParallelism: false } });
