import { describe, expect, it } from 'vitest';
import { ARCFACE_TEMPLATE } from '../src/constants.js';
import {
  applySimilarity,
  estimateSimilarity,
  invertSimilarity,
  type Similarity,
} from '../src/geometry.js';

describe('estimateSimilarity', () => {
  it('recovers a known scale+rotation+translation exactly', () => {
    const angle = 0.5;
    const scale = 2;
    const truth: Similarity = {
      a: scale * Math.cos(angle),
      b: scale * Math.sin(angle),
      tx: 5,
      ty: -3,
    };
    const src = ARCFACE_TEMPLATE;
    const dst = src.map((p) => applySimilarity(truth, p));
    const est = estimateSimilarity(src, dst);
    expect(est.a).toBeCloseTo(truth.a, 9);
    expect(est.b).toBeCloseTo(truth.b, 9);
    expect(est.tx).toBeCloseTo(truth.tx, 9);
    expect(est.ty).toBeCloseTo(truth.ty, 9);
  });

  it('finds a least-squares fit under noise that stays near the truth', () => {
    const truth: Similarity = { a: 1.1, b: 0.2, tx: 10, ty: 20 };
    const src = ARCFACE_TEMPLATE;
    const dst = src.map((p, i) => {
      const q = applySimilarity(truth, p);
      return { x: q.x + (i % 2 === 0 ? 0.3 : -0.3), y: q.y + (i % 2 === 0 ? -0.3 : 0.3) };
    });
    const est = estimateSimilarity(src, dst);
    expect(est.a).toBeCloseTo(truth.a, 1);
    expect(est.b).toBeCloseTo(truth.b, 1);
  });

  it('rejects degenerate input', () => {
    expect(() => estimateSimilarity([{ x: 1, y: 1 }], [{ x: 2, y: 2 }])).toThrow();
    const same = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ];
    expect(() => estimateSimilarity(same, same)).toThrow(/degenerate/);
  });
});

describe('invertSimilarity', () => {
  it('round-trips points through transform and inverse', () => {
    const t: Similarity = { a: 1.5, b: -0.7, tx: 12, ty: -4 };
    const inv = invertSimilarity(t);
    for (const p of ARCFACE_TEMPLATE) {
      const back = applySimilarity(inv, applySimilarity(t, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('rejects a zero-scale transform', () => {
    expect(() => invertSimilarity({ a: 0, b: 0, tx: 1, ty: 1 })).toThrow(/zero-scale/);
  });
});
