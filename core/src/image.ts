import { Jimp } from 'jimp';
import type { Similarity } from './geometry.js';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
}

export interface ImageDecoder {
  decode(bytes: Uint8Array): Promise<RgbaImage>;
}

/** Pure-JS decoder (jpeg/png/bmp/tiff/gif). Swappable for sharp if webp/heic is ever needed. */
export class JimpImageDecoder implements ImageDecoder {
  async decode(bytes: Uint8Array): Promise<RgbaImage> {
    const img = await Jimp.fromBuffer(Buffer.from(bytes));
    return {
      width: img.bitmap.width,
      height: img.bitmap.height,
      data: new Uint8Array(img.bitmap.data),
    };
  }
}

/**
 * Warp src into a dw x dh image. `dstToSrc` maps destination pixel coordinates
 * to source coordinates (i.e. the inverse of the desired src->dst transform).
 * Bilinear sampling; out-of-bounds samples are black.
 */
export function warpAffineBilinear(
  src: RgbaImage,
  dstToSrc: Similarity,
  dw: number,
  dh: number,
): RgbaImage {
  const out = new Uint8Array(dw * dh * 4);
  const { width: sw, height: sh, data } = src;
  const { a, b, tx, ty } = dstToSrc;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = a * x - b * y + tx;
      const sy = b * x + a * y + ty;
      const di = (y * dw + x) * 4;
      out[di + 3] = 255;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 > sw - 1 || y0 > sh - 1) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const v00 = sample(data, sw, sh, x0, y0, c);
        const v10 = sample(data, sw, sh, x0 + 1, y0, c);
        const v01 = sample(data, sw, sh, x0, y0 + 1, c);
        const v11 = sample(data, sw, sh, x0 + 1, y0 + 1, c);
        const v = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
        out[di + c] = Math.round(v);
      }
    }
  }
  return { width: dw, height: dh, data: out };
}

function sample(data: Uint8Array, w: number, h: number, x: number, y: number, c: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return data[(y * w + x) * 4 + c];
}

export interface Letterboxed {
  image: RgbaImage;
  /** Multiply detector coordinates by 1/scale to map back to the original image. */
  scale: number;
}

/** Scale-to-fit into size x size, padding right/bottom with black. */
export function letterbox(src: RgbaImage, size: number): Letterboxed {
  const scale = Math.min(size / src.width, size / src.height);
  // dst -> src mapping is a pure scale by 1/scale.
  const image = warpAffineBilinear(src, { a: 1 / scale, b: 0, tx: 0, ty: 0 }, size, size);
  return { image, scale };
}

/** RGBA -> normalized float CHW tensor data: (value - mean) / std per RGB channel. */
export function rgbaToChwFloat(img: RgbaImage, mean: number, std: number): Float32Array {
  const { width, height, data } = img;
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (data[i * 4] - mean) / std;
    out[plane + i] = (data[i * 4 + 1] - mean) / std;
    out[2 * plane + i] = (data[i * 4 + 2] - mean) / std;
  }
  return out;
}
