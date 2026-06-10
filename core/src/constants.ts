import type { Point } from './geometry.js';
import type { ScoreBand } from './types.js';

export const PROFILE_BASE_URL = 'https://v2.proofofhumanity.id';

export const DEFAULT_INDEX_BLOB_KEY = 'index/v1';
export const DEFAULT_BLOB_STORE_NAME = 'poh-duplicate-finder';
export const MODEL_BLOB_KEYS = {
  detection: 'models/det_500m.onnx',
  recognition: 'models/w600k_mbf.onnx',
} as const;

export const MODEL_ID = 'scrfd_500m+w600k_mbf@1';
export const EMBEDDING_DIMS = 512;

/** Canonical 5-point ArcFace landmark template for a 112x112 crop. */
export const ARCFACE_TEMPLATE: Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

export const ARCFACE_CROP_SIZE = 112;

/**
 * Initial score bands for w600k_mbf cosine similarity; to be recalibrated
 * against known duplicate pairs (see design spec §10).
 */
export const SCORE_BANDS = {
  likelySame: 0.55,
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
