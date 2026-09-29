import type { APIRoute } from 'astro';
import { semanticCacheWorker } from '../workers/semantic-cache';
import { SEMANTIC_ASSETS, semanticCacheName } from '../lib/semantic-assets';

export const GET: APIRoute = () => {
  const base = import.meta.env.BASE_URL;
  return new Response(`(${semanticCacheWorker.toString()})(${JSON.stringify({ base, cache: semanticCacheName(base), assets: SEMANTIC_ASSETS })});`,
    { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
};
