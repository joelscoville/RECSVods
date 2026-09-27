/// <reference types="astro/client" />
interface ImportMetaEnv {
  readonly ARCHIVE_MODE: 'production' | 'preview';
  readonly PUBLIC_REPOSITORY_URL?: string;
  readonly PUBLIC_SOURCE_REF?: string;
}
/** Structured Vite build constant, shared by SSR and client code; not a string environment variable. */
declare const __RECS_CORRECTIONS__: import('./lib/corrections').CorrectionConfig;
