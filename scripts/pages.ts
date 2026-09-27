import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyOutput } from './verify-output';

export function pagesBase(value: string): string {
  const base = value === '' || value === '/' ? '/' : `${value.replace(/\/$/, '')}/`;
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('Invalid Pages base path');
  return base;
}
export async function verifyPages(root: string, expectedBase: string) {
  const output = path.join(root, 'dist/production'), base = pagesBase(expectedBase);
  const mode = JSON.parse(readFileSync(path.join(output, 'build-mode.json'), 'utf8'));
  if (mode.mode !== 'production' || mode.base !== base) throw new Error('Only the matching production build may be uploaded to Pages');
  await verifyOutput(root, output, 'production');
  const pages: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink in Pages output');
      if (entry.isDirectory()) walk(filename);
      else if (entry.name.endsWith('.html')) pages.push(filename);
    }
  };
  walk(output);
  let links = 0;
  for (const filename of pages) {
    const html = readFileSync(filename, 'utf8');
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const href = match[1].replaceAll('&amp;', '&');
      if (href.startsWith('#') || !href || /^(?:https?:|mailto:|data:)/i.test(href)) continue;
      const url = new URL(href, `https://pages.invalid${base}${path.relative(output, filename).split(path.sep).join('/')}`);
      if (url.origin !== 'https://pages.invalid' || !url.pathname.startsWith(base)) throw new Error('Local route or asset escapes the deployment base');
      let target = path.resolve(output, decodeURIComponent(url.pathname.slice(base.length)) || '.');
      if (target !== output && !target.startsWith(`${output}${path.sep}`)) throw new Error('Invalid local Pages path');
      if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html');
      if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`Missing local Pages route/asset referenced by ${path.relative(output, filename)}`);
      links++;
    }
  }
  for (const route of ['index.html', '404.html', 'search/index.html', 'watch/index.html', 'browse/index.html', 'policies/index.html']) {
    if (!existsSync(path.join(output, route))) throw new Error(`Missing required direct route: ${route}`);
  }
  return { mode: 'production', base, pages: pages.length, localLinks: links };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === 'base') console.log(pagesBase(process.env.CONFIGURED_PAGES_BASE ?? ''));
  else if (process.argv[2] === 'verify' && process.env.SITE_BASE_PATH) console.log(JSON.stringify(await verifyPages(process.cwd(), process.env.SITE_BASE_PATH)));
  else throw new Error('Usage: pages.ts base | verify (verify requires SITE_BASE_PATH)');
}
