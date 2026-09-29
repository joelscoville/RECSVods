/** Keep artifact verification on ordinary HTTP previews as well as HTTPS/localhost.
 * Web Crypto is secure-context-only; the fallback computes the same SHA-256.
 */
export async function artifactSha256(bytes: Uint8Array): Promise<string> {
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
    : (await import('@noble/hashes/sha2.js')).sha256(bytes);
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}
