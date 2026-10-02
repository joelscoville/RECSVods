/** A small line diff for showing exactly what a change does to a file (service.yaml is a few hundred lines). */
export interface DiffLine { kind: 'same' | 'added' | 'removed'; text: string; before?: number; after?: number }
export interface DiffHunk { lines: DiffLine[] }

export function diffLines(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.split('\n'), b = afterText.split('\n');
  // Longest common subsequence table, filled from the end.
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ kind: 'same', text: a[i], before: i + 1, after: j + 1 }); i++; j++; }
    // Removals are listed before the additions that replace them.
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { lines.push({ kind: 'removed', text: a[i], before: i + 1 }); i++; }
    else { lines.push({ kind: 'added', text: b[j], after: j + 1 }); j++; }
  }
  return lines;
}
/** Only the changed regions, each with a little surrounding context. */
export function diffHunks(beforeText: string, afterText: string, context = 3): DiffHunk[] {
  const lines = diffLines(beforeText, afterText), keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep.add(k);
  });
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | undefined, last = -2;
  for (const index of [...keep].sort((x, y) => x - y)) {
    if (index !== last + 1) { current = []; hunks.push({ lines: current }); }
    current!.push(lines[index]); last = index;
  }
  return hunks;
}
