import { describe, expect, it } from 'vitest';
import { cosineChapterVector, decodeChapterVectors, packChapterVectors } from '../site/lib/chapter-vectors';
import { averageWindows, quantize, tokenWindows, unitText } from '../scripts/search-vectors';
import { units } from './recording-fixtures';

const DIM = 384;
function unit(index = 0): number[] { return Array.from({ length: DIM }, (_, i) => i === index ? 1 : 0); }
function normalized(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

describe('browser chapter codec', () => {
  it('encodes the exact LE header, signed rows and offset views', () => {
    const row = new Int8Array(DIM); row[0] = -127; row[1] = 127;
    const bytes = packChapterVectors([row, new Int8Array(DIM)]);
    expect(Array.from(bytes.subarray(0, 16))).toEqual([82, 69, 67, 83, 67, 72, 48, 49, 128, 1, 1, 0, 2, 0, 0, 0]);
    expect(bytes.length).toBe(16 + 2 * DIM);
    const padded = new Uint8Array(bytes.length + 7); padded.set(bytes, 3);
    const decoded = decodeChapterVectors(padded.subarray(3, 3 + bytes.length));
    expect(decoded.dimension).toBe(DIM); expect(decoded.rowCount).toBe(2);
    expect(decoded.values[0]).toBe(-127); expect(decoded.values[1]).toBe(127);
    expect(decodeChapterVectors(bytes.buffer as ArrayBuffer).values).toEqual(decoded.values);
    expect(decodeChapterVectors(packChapterVectors([])).rowCount).toBe(0);
  });

  it('rejects malformed headers, length mismatches and out-of-recipe int8', () => {
    const original = packChapterVectors([new Int8Array(DIM)]);
    for (const [offset, value] of [[0, 0], [8, 127], [10, 2], [12, 2], [16, 128]]) {
      const bytes = original.slice(); bytes[offset] = value;
      expect(() => decodeChapterVectors(bytes)).toThrow();
    }
    expect(() => decodeChapterVectors(original.subarray(0, 15))).toThrow(/header/u);
    expect(() => decodeChapterVectors(original.subarray(0, -1))).toThrow(/length/u);
    expect(() => decodeChapterVectors(new Uint8Array([...original, 0]))).toThrow(/length/u);
    expect(() => packChapterVectors([new Int8Array(383)])).toThrow();
    expect(() => packChapterVectors([new Int8Array(DIM).fill(-128)])).toThrow();
  });

  it('normalizes both row and query; skips zero rows and rejects invalid queries', () => {
    const row = new Int8Array(DIM); row[0] = 3; row[1] = 4;
    const query = unit(); query[0] = 6; query[1] = 8;
    const file = decodeChapterVectors(packChapterVectors([row, new Int8Array(DIM)]));
    expect(cosineChapterVector(file, 0, query)).toBeCloseTo(1, 12);
    expect(cosineChapterVector(file, 0, query.map((v) => -v))).toBeCloseTo(-1, 12);
    expect(cosineChapterVector(file, 1, query)).toBe(0);
    expect(cosineChapterVector(file, 0, new Float32Array(DIM))).toBe(0);
    expect(() => cosineChapterVector(file, -1, query)).toThrow();
    expect(() => cosineChapterVector(file, 2, query)).toThrow();
    expect(() => cosineChapterVector(file, 0, [1])).toThrow();
    expect(() => cosineChapterVector(file, 0, new Array(DIM).fill(NaN))).toThrow();
  });

  it('has low cosine quantization error and symmetric rounding', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const source = normalized(Array.from({ length: DIM }, (_, i) => Math.sin(i * seed + 0.37)));
      const quantized = quantize(source);
      expect(Math.max(...quantized.map(Math.abs))).toBe(127);
      const file = decodeChapterVectors(packChapterVectors([quantized]));
      expect(cosineChapterVector(file, 0, source)).toBeGreaterThan(0.99998);
      const query = normalized(Array.from({ length: DIM }, (_, i) => Math.cos(i * (seed + 0.5))));
      const expected = source.reduce((sum, v, i) => sum + v * query[i], 0);
      expect(Math.abs(cosineChapterVector(file, 0, query) - expected)).toBeLessThan(0.001);
    }
    const v = new Array(DIM).fill(0); v[0] = 127; v[1] = 0.5; v[2] = -0.5;
    expect(Array.from(quantize(v).subarray(0, 3))).toEqual([127, 1, -1]);
    expect(quantize(new Array(DIM).fill(0))).toEqual(new Int8Array(DIM));
    expect(() => quantize(new Array(DIM).fill(Infinity))).toThrow();
  });
});

describe('deterministic working inputs and windows', () => {
  it.each([0, 1, 190, 254, 255, 444, 445, 1000])('fits 256 including specials for %i content tokens, with exact 64 overlap', (length) => {
    const ids = Array.from({ length }, (_, i) => i + 1000), windows = tokenWindows(ids);
    expect(windows).toEqual(tokenWindows(ids));
    expect(windows.length).toBe(length ? 1 + Math.ceil(Math.max(0, length - 254) / 190) : 0);
    for (const [i, window] of windows.entries()) {
      expect(window.length + 2).toBeLessThanOrEqual(256);
      if (i) expect(window.slice(0, 64)).toEqual(windows[i - 1].slice(-64));
    }
    const reconstructed = windows.flatMap((window, i) => i ? window.slice(64) : window);
    expect(reconstructed).toEqual(ids);
  });

  it('averages normalized windows and L2 normalizes before quantization', () => {
    const vector = averageWindows([unit(), unit(1)]);
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 12); expect(vector[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(quantize(vector).subarray(0, 2)).toEqual(new Int8Array([127, 127]));
    expect(averageWindows([])).toEqual(new Array(DIM).fill(0));
    // Windows that cancel out leave a zero row, which search skips.
    expect(averageWindows([unit(), unit().map((v) => -v)])).toEqual(new Array(DIM).fill(0));
  });

});

describe('what a search vector is made from', () => {
  it('embeds the published words of a unit and the BSB text of its passages, nothing else', () => {
    const [recording] = units();
    const text = unitText(recording, { schemaVersion: 1, references: { 'Romans 12:9-13': ['Romans 12:9'] }, verses: { 'Romans 12:9': 'Love must be sincere.' } });
    expect(text).toContain('Serving Our Neighbours');
    expect(text).toContain('Romans 12:9-13');
    expect(text).toContain('Love must be sincere.');
    expect(unitText(recording)).not.toContain('Love must be sincere.');
  });
});
