export interface Point {
  x: number;
  y: number;
}

/**
 * Non-reflective 2D similarity transform:
 *   x' = a*x - b*y + tx
 *   y' = b*x + a*y + ty
 * i.e. uniform scale * rotation + translation.
 */
export interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

export const IDENTITY_SIMILARITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };

export function applySimilarity(t: Similarity, p: Point): Point {
  return {
    x: t.a * p.x - t.b * p.y + t.tx,
    y: t.b * p.x + t.a * p.y + t.ty,
  };
}

/**
 * Least-squares estimate of the similarity transform mapping src[i] -> dst[i].
 * Closed-form Procrustes solution without reflection — the standard way to
 * align detected face landmarks to the ArcFace template.
 */
export function estimateSimilarity(src: Point[], dst: Point[]): Similarity {
  if (src.length !== dst.length || src.length < 2) {
    throw new Error(`estimateSimilarity needs >= 2 matching points, got ${src.length}/${dst.length}`);
  }
  const n = src.length;
  let msx = 0,
    msy = 0,
    mdx = 0,
    mdy = 0;
  for (let i = 0; i < n; i++) {
    msx += src[i].x;
    msy += src[i].y;
    mdx += dst[i].x;
    mdy += dst[i].y;
  }
  msx /= n;
  msy /= n;
  mdx /= n;
  mdy /= n;

  let numA = 0,
    numB = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    const xs = src[i].x - msx;
    const ys = src[i].y - msy;
    const xd = dst[i].x - mdx;
    const yd = dst[i].y - mdy;
    numA += xs * xd + ys * yd;
    numB += xs * yd - ys * xd;
    den += xs * xs + ys * ys;
  }
  if (den === 0) {
    throw new Error('estimateSimilarity: degenerate source points');
  }
  const a = numA / den;
  const b = numB / den;
  return {
    a,
    b,
    tx: mdx - (a * msx - b * msy),
    ty: mdy - (b * msx + a * msy),
  };
}

export function invertSimilarity(t: Similarity): Similarity {
  const s = t.a * t.a + t.b * t.b;
  if (s === 0) throw new Error('invertSimilarity: zero-scale transform');
  const ia = t.a / s;
  const ib = -t.b / s;
  return {
    a: ia,
    b: ib,
    tx: -(ia * t.tx - ib * t.ty),
    ty: -(ib * t.tx + ia * t.ty),
  };
}
