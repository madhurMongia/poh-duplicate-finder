import { EMBEDDING_DIMS } from './constants.js';
import type { FaceEntry, FaceIndex, IndexHeader } from './types.js';

/** 'PDX1' — PoH Duplicate-finder indeX, format v1. */
const MAGIC = 0x31584450;
const PREAMBLE_BYTES = 8; // magic u32 + header length u32, both little-endian

/**
 * Binary layout (single self-contained blob, atomic to readers):
 *   u32 magic | u32 headerLen | headerJson (padded to 4 bytes) |
 *   f32 scales[count] | i8 vectors[count * dims]
 * Vectors are int8-quantized per row with a float32 scale (max-abs / 127).
 */
export function encodeIndex(index: FaceIndex): Uint8Array {
  const { header, vectors } = index;
  const { count, dims } = header;
  if (vectors.length !== count * dims) {
    throw new Error(`encodeIndex: vectors length ${vectors.length} != count*dims ${count * dims}`);
  }
  let headerJson = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 - (headerJson.length % 4)) % 4;
  if (pad > 0) {
    const padded = new Uint8Array(headerJson.length + pad);
    padded.set(headerJson);
    padded.fill(0x20, headerJson.length); // pad with spaces, still valid JSON whitespace
    headerJson = padded;
  }

  const total = PREAMBLE_BYTES + headerJson.length + count * 4 + count * dims;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, headerJson.length, true);
  out.set(headerJson, PREAMBLE_BYTES);

  const scalesOffset = PREAMBLE_BYTES + headerJson.length;
  const vectorsOffset = scalesOffset + count * 4;
  for (let row = 0; row < count; row++) {
    let maxAbs = 0;
    for (let d = 0; d < dims; d++) {
      const v = Math.abs(vectors[row * dims + d]);
      if (v > maxAbs) maxAbs = v;
    }
    const scale = maxAbs === 0 ? 1 : maxAbs / 127;
    view.setFloat32(scalesOffset + row * 4, scale, true);
    for (let d = 0; d < dims; d++) {
      const q = Math.max(-127, Math.min(127, Math.round(vectors[row * dims + d] / scale)));
      view.setInt8(vectorsOffset + row * dims + d, q);
    }
  }
  return out;
}

export function decodeIndexHeader(bytes: Uint8Array): IndexHeader {
  if (bytes.length < PREAMBLE_BYTES) throw new Error('decodeIndex: blob too small');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('decodeIndex: bad magic');
  const headerLen = view.getUint32(4, true);
  if (bytes.length < PREAMBLE_BYTES + headerLen) throw new Error('decodeIndex: truncated header');
  const json = new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + headerLen));
  const header = JSON.parse(json) as IndexHeader;
  if (header.version !== 1) throw new Error(`decodeIndex: unsupported version ${header.version}`);
  return header;
}

export function decodeIndex(bytes: Uint8Array): FaceIndex {
  const header = decodeIndexHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(4, true);
  const { count, dims } = header;
  const scalesOffset = PREAMBLE_BYTES + headerLen;
  const vectorsOffset = scalesOffset + count * 4;
  if (bytes.length < vectorsOffset + count * dims) throw new Error('decodeIndex: truncated body');

  const vectors = new Float32Array(count * dims);
  for (let row = 0; row < count; row++) {
    const scale = view.getFloat32(scalesOffset + row * 4, true);
    const base = row * dims;
    let sumSq = 0;
    for (let d = 0; d < dims; d++) {
      const v = view.getInt8(vectorsOffset + base + d) * scale;
      vectors[base + d] = v;
      sumSq += v * v;
    }
    // Renormalize in place to erase quantization scale error; ranking assumes unit rows.
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let d = 0; d < dims; d++) vectors[base + d] /= norm;
    }
  }
  return { header, vectors };
}

export function emptyIndex(modelId: string, dims: number = EMBEDDING_DIMS): FaceIndex {
  return {
    header: {
      version: 1,
      modelId,
      dims,
      count: 0,
      builtAt: 0,
      checkpoints: {},
      retries: [],
      entries: [],
    },
    vectors: new Float32Array(0),
  };
}

/** Returns a new index with rows appended; never mutates the input. */
export function appendToIndex(
  index: FaceIndex,
  entries: FaceEntry[],
  rows: Float32Array[],
): FaceIndex {
  if (entries.length !== rows.length) {
    throw new Error(`appendToIndex: ${entries.length} entries vs ${rows.length} rows`);
  }
  const { dims } = index.header;
  for (const row of rows) {
    if (row.length !== dims) throw new Error(`appendToIndex: row dims ${row.length} != ${dims}`);
  }
  const count = index.header.count + entries.length;
  const vectors = new Float32Array(count * index.header.dims);
  vectors.set(index.vectors, 0);
  rows.forEach((row, i) => vectors.set(row, (index.header.count + i) * dims));
  return {
    header: {
      ...index.header,
      count,
      entries: [...index.header.entries, ...entries],
    },
    vectors,
  };
}
