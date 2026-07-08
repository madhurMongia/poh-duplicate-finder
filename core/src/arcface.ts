import { ARCFACE_CROP_SIZE } from './constants.js';
import { rgbaToChwFloat, type RgbaImage } from './image.js';

/** Recognition input normalization: (v - 127.5) / 127.5, RGB. */
export const ARCFACE_MEAN = 127.5;
export const ARCFACE_STD = 127.5;

export function preprocessAlignedFace(img: RgbaImage): Float32Array {
  if (img.width !== ARCFACE_CROP_SIZE || img.height !== ARCFACE_CROP_SIZE) {
    throw new Error(
      `ArcFace expects ${ARCFACE_CROP_SIZE}x${ARCFACE_CROP_SIZE}, got ${img.width}x${img.height}`,
    );
  }
  return rgbaToChwFloat(img, ARCFACE_MEAN, ARCFACE_STD);
}

export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return new Float32Array(v.length);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}
