import type { ScoreBand } from './types.js';

export const PROFILE_BASE_URL = 'https://v2.proofofhumanity.id';

export const DEFAULT_INDEX_BLOB_KEY = 'index/v1';
export const DEFAULT_BLOB_STORE_NAME = 'poh-duplicate-finder';

export const MODEL_ID = 'human_blazeface+faceres@1';
export const EMBEDDING_DIMS = 1024;

/**
 * Initial score bands for Human FaceRes similarity; the likely-same threshold
 * came from the local LFW comparison run before removing the benchmark harness.
 */
export const SCORE_BANDS = {
  likelySame: 0.46,
  review: 0.4,
} as const;

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_BANDS.likelySame) return 'likely-same';
  if (score >= SCORE_BANDS.review) return 'review';
  return 'different';
}

export function buildProfileUrl(humanityId: string): string {
  return `${PROFILE_BASE_URL}/${humanityId}`;
}
