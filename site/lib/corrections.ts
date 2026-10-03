/** Where suggested changes go: the public repository the chapter editor sends pull requests to. */
export interface CorrectionConfig {
  repositoryUrl?: string;
  correctionUrl?: string;
  sourceRef?: string;
}
/** Reject credentials, queries, ports and URL normalization tricks. */
export function validateRepositoryUrl(value: string): string | undefined {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9_.-]+)\/?$/.exec(value);
  if (!match) return undefined;
  const repository = match[2].replace(/\.git$/, '');
  if (!repository || repository === '.' || repository === '..') return undefined;
  return `https://github.com/${match[1]}/${repository}`;
}
/** Explicit public contact/form destination. Never derive accessibility from a Git remote. */
export function validateCorrectionUrl(value: string): string | undefined {
  if (/[\s\\]/.test(value) || /%0[ad]/i.test(value)) return undefined;
  if (/^mailto:[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && url.hostname) return url.href;
  } catch { /* Invalid URL. */ }
  return undefined;
}
export function validateSourceRef(value: string): string | undefined {
  if (!value || value === 'HEAD' || value === '@' || /[\s~^:?*[\\]/.test(value)
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || value.includes('..') || value.includes('@{') || value.startsWith('-')
    || value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) return undefined;
  return value;
}
export function correctionConfig(): CorrectionConfig {
  return typeof __RECS_CORRECTIONS__ === 'undefined' ? {} : __RECS_CORRECTIONS__;
}
