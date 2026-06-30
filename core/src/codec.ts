import { EMBEDDING_DIMS } from './constants.js';
import type { FaceEntry, FaceIndex, IndexHeader } from './types.js';

/** 'PDX2' — PoH Duplicate-finder indeX, binary format v2 (float32 vectors). */
const MAGIC = 0x32584450;
const PREAMBLE_BYTES = 8; // magic u32 + header length u32, both little-endian

/**
 * Binary layout (single self-contained blob, atomic to readers):
 *   u32 magic | u32 headerLen | headerJson (padded to 4 bytes) |
 *   f32 vectors[count * dims]   (little-endian, row-major)
 *
 * Vectors are stored as raw float32. The index is only ever read server-side
 * (the lookup function loads it once and caches it across warm invocations),
 * so int8 quantization's ~4x size saving isn't worth the extra machinery.
 * Embeddings are L2-normalized at embed time, so ranking's dot product is a
 * true cosine — the codec stays a dumb (de)serializer.
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

  const out = new Uint8Array(PREAMBLE_BYTES + headerJson.length + vectors.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, headerJson.length, true);
  out.set(headerJson, PREAMBLE_BYTES);

  const vectorsOffset = PREAMBLE_BYTES + headerJson.length;
  for (let i = 0; i < vectors.length; i++) {
    view.setFloat32(vectorsOffset + i * 4, vectors[i], true);
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
  const vectorsOffset = PREAMBLE_BYTES + headerLen;
  const floatCount = count * dims;
  // DataView reads (vs a Float32Array view) tolerate an unaligned offset and
  // pin little-endian, so the blob decodes identically on any host.
  if (bytes.length < vectorsOffset + floatCount * 4) throw new Error('decodeIndex: truncated body');

  const vectors = new Float32Array(floatCount);
  for (let i = 0; i < floatCount; i++) {
    vectors[i] = view.getFloat32(vectorsOffset + i * 4, true);
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
