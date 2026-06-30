import { describe, expect, it } from 'vitest';
import {
  appendToIndex,
  decodeIndex,
  decodeIndexHeader,
  emptyIndex,
  encodeIndex,
} from '../src/codec.js';
import type { FaceIndex } from '../src/types.js';
import { buildIndex, cosine, makeEntry, mixedVector, unitVector } from './helpers.js';

const DIMS = 8;

function sampleIndex(): FaceIndex {
  return buildIndex(
    // Odd-length name exercises the 4-byte header padding.
    [
      makeEntry({ requestId: '0xr1', name: 'Ada' }),
      makeEntry({ requestId: '0xr2', status: 'expired' }),
      makeEntry({ requestId: '0xr3', status: 'revoked', chain: 'mainnet' }),
    ],
    [
      unitVector(0, DIMS),
      mixedVector({ 1: 0.8, 2: 0.6 }, DIMS),
      mixedVector({ 0: -0.5, 3: 0.5, 7: 0.70710678 }, DIMS),
    ],
    {
      modelId: 'test-model@1',
      builtAt: 1_750_000_000,
      checkpoints: { gnosis: 123, mainnet: 456 },
      retries: [
        {
          chain: 'gnosis',
          requestId: '0xfail',
          humanityId: '0x' + '9'.repeat(40),
          createdAt: 1,
          evidenceUri: '/ipfs/QmEv',
          attempts: 2,
          lastError: 'boom',
        },
      ],
    },
  );
}

describe('encodeIndex / decodeIndex', () => {
  it('round-trips header and metadata exactly', () => {
    const decoded = decodeIndex(encodeIndex(sampleIndex()));
    expect(decoded.header).toEqual(sampleIndex().header);
  });

  it('round-trips vectors exactly as float32', () => {
    const original = sampleIndex();
    const decoded = decodeIndex(encodeIndex(original));
    for (let row = 0; row < 3; row++) {
      const a = original.vectors.subarray(row * DIMS, (row + 1) * DIMS);
      const b = decoded.vectors.subarray(row * DIMS, (row + 1) * DIMS);
      for (let d = 0; d < DIMS; d++) expect(b[d]).toBeCloseTo(a[d], 6);
      // Inputs are unit vectors, so a faithful round-trip is also unit length.
      expect(cosine(new Float32Array(b), new Float32Array(b))).toBeCloseTo(1, 6);
    }
  });

  it('round-trips an empty index', () => {
    const decoded = decodeIndex(encodeIndex(emptyIndex('m@1', DIMS)));
    expect(decoded.header.count).toBe(0);
    expect(decoded.vectors).toHaveLength(0);
  });

  it('header padding keeps body 4-byte aligned for any header length', () => {
    for (const name of ['a', 'ab', 'abc', 'abcd']) {
      const index = sampleIndex();
      index.header.entries[0].name = name;
      const decoded = decodeIndex(encodeIndex(index));
      expect(decoded.header.entries[0].name).toBe(name);
      expect(cosine(decoded.vectors.subarray(0, DIMS), unitVector(0, DIMS))).toBeGreaterThan(
        0.9995,
      );
    }
  });

  it('rejects bad magic, truncation, and unsupported versions', () => {
    const good = encodeIndex(sampleIndex());
    const badMagic = new Uint8Array(good);
    badMagic[0] = 0xff;
    expect(() => decodeIndex(badMagic)).toThrow(/bad magic/);
    expect(() => decodeIndex(good.subarray(0, 4))).toThrow(/too small/);
    expect(() => decodeIndex(good.subarray(0, good.length - 1))).toThrow(/truncated/);

    const v2 = sampleIndex();
    (v2.header as { version: number }).version = 2;
    expect(() => decodeIndexHeader(encodeIndex(v2))).toThrow(/unsupported version/);
  });

  it('rejects vectors/count mismatch', () => {
    const index = sampleIndex();
    index.header.count = 2;
    expect(() => encodeIndex(index)).toThrow(/vectors length/);
  });
});

describe('appendToIndex', () => {
  it('appends rows immutably', () => {
    const base = sampleIndex();
    const entry = makeEntry({ requestId: '0xr4' });
    const grown = appendToIndex(base, [entry], [unitVector(4, DIMS)]);
    expect(grown.header.count).toBe(4);
    expect(grown.header.entries).toHaveLength(4);
    expect(grown.vectors).toHaveLength(4 * DIMS);
    expect(grown.vectors[3 * DIMS + 4]).toBe(1);
    // input untouched
    expect(base.header.count).toBe(3);
    expect(base.header.entries).toHaveLength(3);
    expect(base.vectors).toHaveLength(3 * DIMS);
  });

  it('validates row dimensions and entry/row pairing', () => {
    const base = sampleIndex();
    expect(() => appendToIndex(base, [makeEntry()], [])).toThrow(/entries vs/);
    expect(() => appendToIndex(base, [makeEntry()], [unitVector(0, 4)])).toThrow(/row dims/);
  });
});
