import { describe, expect, it } from 'vitest';
import { rankMatches } from '../src/ranking.js';
import type { FaceIndex } from '../src/types.js';
import { makeEntry, mixedVector, unitVector } from './helpers.js';

const DIMS = 4;

function indexOf(rows: Float32Array[], humanityIds: string[]): FaceIndex {
  const vectors = new Float32Array(rows.length * DIMS);
  rows.forEach((r, i) => vectors.set(r, i * DIMS));
  return {
    header: {
      version: 1,
      modelId: 'm',
      dims: DIMS,
      count: rows.length,
      builtAt: 0,
      checkpoints: {},
      retries: [],
      entries: humanityIds.map((humanityId, i) =>
        makeEntry({ humanityId, requestId: `0xr${i}` }),
      ),
    },
    vectors,
  };
}

const H1 = '0x' + 'a'.repeat(40);
const H2 = '0x' + 'b'.repeat(40);
const H3 = '0x' + 'c'.repeat(40);

describe('rankMatches', () => {
  it('orders matches by cosine similarity descending', () => {
    const index = indexOf(
      [unitVector(0, DIMS), unitVector(1, DIMS), mixedVector({ 0: 0.6, 1: 0.8 }, DIMS)],
      [H1, H2, H3],
    );
    const matches = rankMatches(unitVector(1, DIMS), index, {});
    expect(matches.map((m) => m.entry.humanityId)).toEqual([H2, H3, H1]);
    expect(matches[0].score).toBeCloseTo(1, 6);
    expect(matches[1].score).toBeCloseTo(0.8, 6);
    expect(matches[2].score).toBeCloseTo(0, 6);
  });

  it('respects topK', () => {
    const index = indexOf([unitVector(0, DIMS), unitVector(1, DIMS)], [H1, H2]);
    expect(rankMatches(unitVector(0, DIMS), index, { topK: 1 })).toHaveLength(1);
  });

  it('flags renewals by humanity id, case-insensitively', () => {
    const index = indexOf([unitVector(0, DIMS), unitVector(1, DIMS)], [H1, H2]);
    const matches = rankMatches(unitVector(0, DIMS), index, {
      queryHumanityId: H1.toUpperCase(),
    });
    expect(matches[0].entry.humanityId).toBe(H1);
    expect(matches[0].renewal).toBe(true);
    expect(matches[1].renewal).toBe(false);
  });

  it('rejects dimension mismatches', () => {
    const index = indexOf([unitVector(0, DIMS)], [H1]);
    expect(() => rankMatches(new Float32Array(8), index)).toThrow(/dims/);
  });
});
