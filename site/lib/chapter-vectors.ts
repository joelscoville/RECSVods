import { EMBEDDING_CONFIG } from './embedding-config';

/** Browser-safe, versioned recipe. Any change invalidates cached search rows. */
export const CHAPTER_VECTOR_CONFIG = Object.freeze({
  ...EMBEDDING_CONFIG,
  windowing: Object.freeze({ contentTokens: 254, overlapTokens: 64, specialTokens: 2, maxTokens: 256,
    algorithm: 'token-id-slices-v1' }),
  aggregation: 'mean-normalized-windows-then-l2-v1',
  quantization: 'symmetric-maxabs-int8-127-round-half-away-from-zero-v1',
  sourceText: 'published-unit-title-text-topics-scripture-bsb-v1',
  binary: Object.freeze({ magic: 'RECSCH01', version: 1, headerBytes: 16, dimension: 384 }),
});

export interface ChapterVectorFile { dimension: number; rowCount: number; values: Int8Array }
export type ChapterVectorBytes = ArrayBuffer | ArrayBufferView;

function asBytes(input: ChapterVectorBytes): Uint8Array {
  return ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
}

export function packChapterVectors(rows: Int8Array[]): Uint8Array {
  const { dimension, headerBytes, magic, version } = CHAPTER_VECTOR_CONFIG.binary;
  if (rows.length > 0xffffffff) throw new Error('Too many chapter vector rows');
  for (const row of rows) {
    if (!(row instanceof Int8Array) || row.length !== dimension || row.some((v) => v === -128)) {
      throw new Error('Chapter rows must be 384 int8 values in [-127,127]');
    }
  }
  const bytes = new Uint8Array(headerBytes + rows.length * dimension);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < magic.length; i++) bytes[i] = magic.charCodeAt(i);
  view.setUint16(8, dimension, true);
  view.setUint16(10, version, true);
  view.setUint32(12, rows.length, true);
  rows.forEach((row, i) => bytes.set(new Uint8Array(row.buffer, row.byteOffset, row.byteLength), headerBytes + i * dimension));
  return bytes;
}

export function decodeChapterVectors(input: ChapterVectorBytes): ChapterVectorFile {
  const bytes = asBytes(input);
  const expected = CHAPTER_VECTOR_CONFIG.binary;
  if (bytes.byteLength < expected.headerBytes) throw new Error('Truncated chapter vector header');
  for (let i = 0; i < 8; i++) if (bytes[i] !== expected.magic.charCodeAt(i)) throw new Error('Invalid chapter vector magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dimension = view.getUint16(8, true), version = view.getUint16(10, true), rowCount = view.getUint32(12, true);
  if (dimension !== expected.dimension || version !== expected.version) throw new Error('Incompatible chapter vector dimension/version');
  if (bytes.byteLength !== expected.headerBytes + rowCount * dimension) throw new Error('Chapter vector byte length/row count mismatch');
  const values = new Int8Array(bytes.buffer, bytes.byteOffset + expected.headerBytes, rowCount * dimension);
  if (values.some((value) => value === -128)) throw new Error('Invalid chapter quantization value -128');
  return { dimension, rowCount, values };
}

/** Zero rows return 0; callers must skip them, not label them semantic matches. */
export function cosineChapterVector(file: ChapterVectorFile, rowIndex: number, queryVector: ArrayLike<number>): number {
  if (file.dimension !== 384 || file.values.length !== file.rowCount * file.dimension
    || !Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= file.rowCount) throw new Error('Invalid chapter vector row');
  if (queryVector.length !== file.dimension) throw new Error('Query vector dimension mismatch');
  let dot = 0, rowNorm = 0, queryNorm = 0;
  for (let i = 0; i < file.dimension; i++) {
    const a = file.values[rowIndex * file.dimension + i], b = queryVector[i];
    if (!Number.isFinite(b)) throw new Error('Nonfinite query vector');
    dot += a * b; rowNorm += a * a; queryNorm += b * b;
  }
  return rowNorm && queryNorm ? Math.max(-1, Math.min(1, dot / Math.sqrt(rowNorm * queryNorm))) : 0;
}
