/** Keep duplicate and command-inapplicable options from silently changing a CLI request. */
export function assertCommandOptions(tokens: readonly { kind: string; name?: string }[], allowed: readonly string[], usage: string): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option' || !token.name || !allowed.includes(token.name) || seen.has(token.name)) {
      throw new Error(usage);
    }
    seen.add(token.name);
  }
}
