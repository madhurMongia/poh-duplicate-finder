import type { FaceEntry, FaceIndex } from './types.js';

export interface RankedMatch {
  entry: FaceEntry;
  /** Cosine similarity in [-1, 1]; vectors are unit-normalized. */
  score: number;
  /** Same humanity as the query — a renewal, not a duplicate. */
  renewal: boolean;
}

export interface RankOptions {
  topK?: number;
  queryHumanityId?: string;
}

/**
 * Brute-force cosine ranking. At registry scale (~10^4 rows) this is a few
 * million multiply-adds — no approximate-NN structure is warranted.
 */
export function rankMatches(
  query: Float32Array,
  index: FaceIndex,
  options: RankOptions = {},
): RankedMatch[] {
  const { topK = 20, queryHumanityId } = options;
  const { count, dims, entries } = index.header;
  if (query.length !== dims) {
    throw new Error(`rankMatches: query dims ${query.length} != index dims ${dims}`);
  }
  const normalizedQueryId = queryHumanityId?.toLowerCase();

  const scores = new Float32Array(count);
  const { vectors } = index;
  for (let row = 0; row < count; row++) {
    let dot = 0;
    const base = row * dims;
    for (let d = 0; d < dims; d++) dot += query[d] * vectors[base + d];
    scores[row] = dot;
  }

  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
  return order.slice(0, topK).map((row) => {
    const entry = entries[row];
    return {
      entry,
      score: scores[row],
      renewal: normalizedQueryId !== undefined && entry.humanityId.toLowerCase() === normalizedQueryId,
    };
  });
}
