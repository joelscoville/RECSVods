/**
 * Procedural thumbnails from the operator's Affinity designs ("RECS Replay Thumbnails").
 * Each recording deterministically gets one of four hand-transcribed patterns and one of that
 * pattern's curated colour sets, chosen by hashing its ID: stable forever, random-looking, and
 * cheap enough to build hundreds per millisecond (a string of ~10–40 SVG shapes, no DOM or canvas).
 * Patterns cover the left strip of the card; the design grid is 4×7 cells of 88 units, sampled at
 * half-cell (44-unit) resolution so the figure design keeps its finer steps.
 */
const K = '#000000', W = '#FFFFFF', P = '#E4D9FF', I = '#273469', B = '#6C0000', C = '#23A7DA', V = '#4A00FF';
export const THUMBNAIL_STRIP = { width: 352, height: 610 } as const;
const HALF = 44;

type Roles = Record<string, string>;
interface GridDesign { kind: 'grid'; rows: readonly string[]; colourways: readonly Roles[] }
interface DiamondDesign { kind: 'diamond'; colourways: readonly { base: string; accent?: string }[] }

/** Roles per half-cell: 0 light, 1 dark, 2 third colour, k fixed black. Rows are 8 half-cells wide. */
const DESIGNS: readonly (GridDesign | DiamondDesign)[] = [
  { kind: 'grid', // Stepped checker: a checkerboard that fills solid from the lower left.
    rows: ['22112211', '22112211', '11221122', '11221122', '00110011', '00110011', '11001100', '11001100', '11110011', '11110011', '11111100', '11111100', '11111111', '11111111'],
    colourways: [{ 1: K, 0: P, 2: P }, { 1: I, 0: W, 2: C }, { 1: I, 0: W, 2: W }, { 1: B, 0: W, 2: W }] },
  { kind: 'grid', // Figure: a blocky flower over two legs.
    rows: ['00110011', '00100001', '11000000', '00001100', '00001100', '11000000', '00100001', '00010010', '00010010', '00110011', '11001100', '11001100', '11001100', '11001100'],
    colourways: [{ 1: K, 0: P }, { 1: W, 0: I }, { 1: I, 0: W }, { 1: B, 0: W }] },
  { kind: 'grid', // Columns: two-colour checker columns beside a black stripe.
    rows: ['kk11kkkk', 'kk11kkkk', '112211kk', '112211kk', '221122kk', '221122kk', 'kk22kk11', 'kk22kk11', 'kk11kk22', 'kk11kk22', '112211kk', '112211kk', '221122kk', '221122kk'],
    colourways: [{ 1: P, 2: V }, { 1: C, 2: B }, { 1: I, 2: C }, { 1: I, 2: W }] },
  { kind: 'diamond', // Diamonds: a rotated lattice over a solid base.
    colourways: [{ base: B }, { base: C }, { base: I }, { base: P, accent: I }, { base: I, accent: C }, { base: I, accent: B }] },
];

// Diamond centres transcribed from the design; every diamond is the same 88-unit square rotated ~38°.
const WHITE_DIAMONDS = [[357.1, 79.6], [234, 93.7], [110.6, 108.2], [-12.8, 122.7], [371.9, 202.6], [248.5, 217.1], [125.1, 231.6], [1.8, 246], [386.4, 325.9], [263, 340.4], [139.6, 354.9]] as const;
const EXTRA_WHITE_WITH_ACCENT = [14.6, 368.9] as const;
const ACCENT_DIAMONDS = [[302.8, 148], [179.4, 162.5], [56.1, 177], [317.3, 271.4], [193.9, 285.9], [70.5, 300.4]] as const;
// Drawn 3% larger about each centre so neighbouring diamonds overlap and no hairline of the base shows.
const SCALE = 1.03, EDGE_U = [-68.9 * SCALE, -54.5 * SCALE], EDGE_V = [54.4 * SCALE, -68.9 * SCALE];
const f = (n: number) => n.toFixed(1);
const diamond = ([x, y]: readonly [number, number]) => `M${f(x - (EDGE_U[0] + EDGE_V[0]) / 2)} ${f(y - (EDGE_U[1] + EDGE_V[1]) / 2)}l${f(EDGE_U[0])} ${f(EDGE_U[1])} ${f(EDGE_V[0])} ${f(EDGE_V[1])} ${f(-EDGE_U[0])} ${f(-EDGE_U[1])}z`;

/** FNV-1a: a tiny, fast, well-spread 32-bit hash; identical in every browser and at build time. */
export function thumbnailHash(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

export function thumbnailChoice(id: string): { design: number; colourway: number } {
  const hash = thumbnailHash(id), design = hash % DESIGNS.length;
  return { design, colourway: (hash >>> 8) % DESIGNS[design].colourways.length };
}

/** Inner SVG markup for the pattern strip (viewBox 0 0 352 610). */
export function thumbnailPattern(id: string): string {
  const { design, colourway } = thumbnailChoice(id), spec = DESIGNS[design];
  if (spec.kind === 'diamond') {
    const { base, accent } = spec.colourways[colourway];
    const whites = accent ? [...WHITE_DIAMONDS, EXTRA_WHITE_WITH_ACCENT] : WHITE_DIAMONDS;
    // The lattice is scaled 8% about the strip centre so the design's edge slivers fall just outside it.
    return `<rect width="352" height="610" fill="${base}"/><g transform="matrix(1.08 0 0 1.08 -14.08 -24.4)">`
      + (accent ? `<path fill="${accent}" d="${ACCENT_DIAMONDS.map(diamond).join('')}"/>` : '')
      + `<path fill="${W}" d="${whites.map(diamond).join('')}"/></g>`;
  }
  const roles: Roles = { k: K, ...spec.colourways[colourway] };
  const background = roles[0] ?? roles[1];
  // Merge horizontal runs of one colour, then extend a run downwards while the row below repeats it,
  // so shared edges never meet at a fractional pixel (no hairline seams) and shapes stay few.
  const open = new Map<string, { x: number; y: number; w: number; h: number; fill: string }>(), done: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  spec.rows.forEach((row, r) => {
    const seen = new Set<string>();
    for (let start = 0; start < row.length;) {
      let end = start + 1;
      while (end < row.length && roles[row[end]] === roles[row[start]]) end++;
      const fill = roles[row[start]], key = `${start}:${end}:${fill}`;
      if (fill !== background) {
        const rect = open.get(key);
        if (rect && rect.y + rect.h === r) rect.h++; else { if (rect) done.push(rect); open.set(key, { x: start, y: r, w: end - start, h: 1, fill }); }
        seen.add(key);
      }
      start = end;
    }
    for (const [key, rect] of open) if (!seen.has(key)) { done.push(rect); open.delete(key); }
  });
  done.push(...open.values());
  return `<rect width="352" height="610" fill="${background}"/>`
    + done.map(({ x, y, w, h, fill }) => `<rect x="${x * HALF}" y="${y * HALF}" width="${w * HALF}" height="${h * HALF}" fill="${fill}"/>`).join('');
}
