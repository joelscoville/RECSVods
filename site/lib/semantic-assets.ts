import { EMBEDDING_CONFIG, semanticAssetPaths } from './embedding-config';

export interface SemanticAsset { path: string; bytes: number; sha256: string }
// This web build uses JSEP even on device:wasm. Do not install the unused plain pair.
export const SEMANTIC_ASSETS: readonly SemanticAsset[] = [
  { path: `models/${EMBEDDING_CONFIG.model}/config.json`, bytes: 650, sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7' },
  { path: `models/${EMBEDDING_CONFIG.model}/tokenizer.json`, bytes: 711661, sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
  { path: `models/${EMBEDDING_CONFIG.model}/tokenizer_config.json`, bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
  { path: `models/${EMBEDDING_CONFIG.model}/special_tokens_map.json`, bytes: 125, sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3' },
  { path: `models/${EMBEDDING_CONFIG.model}/onnx/model_quantized.onnx`, bytes: 22972370, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
  { path: 'onnx/ort-wasm-simd-threaded.jsep.mjs', bytes: 44484, sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9' },
  { path: 'onnx/ort-wasm-simd-threaded.jsep.wasm', bytes: 21596019, sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39' },
];
// Use raw bytes for a conservative forecast; compressed delivery is not assumed.
export const SEMANTIC_INSTALL_BYTES = SEMANTIC_ASSETS.reduce((sum, file) => sum + file.bytes, 0);
export function semanticCacheName(base: string): string {
  semanticAssetPaths(base);
  return `recs-semantic:${encodeURIComponent(base)}:v1:${EMBEDDING_CONFIG.model}:${EMBEDDING_CONFIG.revision}:${EMBEDDING_CONFIG.dtype}:${EMBEDDING_CONFIG.transformersVersion}:${EMBEDDING_CONFIG.runtimeVersion}`;
}
export async function semanticAssetsCached(base: string): Promise<boolean> {
  try {
    const name = semanticCacheName(base);
    if (!await caches.has(name)) return false;
    const cache = await caches.open(name);
    for (const file of SEMANTIC_ASSETS) {
      const response = await cache.match(new URL(`${base}${file.path}`, location.origin).href);
      if (!response || response.headers.get('x-recs-sha256') !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}
