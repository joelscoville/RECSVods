import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { loadCorrectionConfig } from './site/lib/source-links.ts';

const base = process.env.SITE_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
  throw new Error('SITE_BASE_PATH must be / or a slash-delimited path such as /replay/');
}
export default defineConfig({
  srcDir: './site',
  publicDir: './site/public',
  outDir: `./dist/${process.env.ARCHIVE_MODE === 'preview' ? 'preview' : 'production'}`,
  base,
  trailingSlash: 'always',
  output: 'static',
  integrations: [react()],
  vite: { define: {
    'import.meta.env.ARCHIVE_MODE': JSON.stringify(process.env.ARCHIVE_MODE || 'production'),
    __RECS_CORRECTIONS__: JSON.stringify(loadCorrectionConfig()),
  } },
});
