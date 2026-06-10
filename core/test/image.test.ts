import { describe, expect, it } from 'vitest';
import { IDENTITY_SIMILARITY } from '../src/geometry.js';
import { letterbox, rgbaToChwFloat, warpAffineBilinear, type RgbaImage } from '../src/image.js';

function solidImage(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function gradientImage(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = (i * 7) % 256;
    data[i * 4 + 2] = (i * 13) % 256;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('warpAffineBilinear', () => {
  it('identity transform preserves pixels', () => {
    const src = gradientImage(4, 4);
    const out = warpAffineBilinear(src, IDENTITY_SIMILARITY, 4, 4);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('fills out-of-bounds samples with black', () => {
    const src = solidImage(2, 2, [200, 200, 200]);
    const out = warpAffineBilinear(src, { a: 1, b: 0, tx: 100, ty: 100 }, 2, 2);
    for (let i = 0; i < 4; i++) {
      expect(out.data[i * 4]).toBe(0);
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });
});

describe('letterbox', () => {
  it('scales to fit and pads the short side with black', () => {
    const src = solidImage(100, 50, [255, 255, 255]);
    const { image, scale } = letterbox(src, 64);
    expect(scale).toBeCloseTo(0.64, 9);
    expect(image.width).toBe(64);
    expect(image.height).toBe(64);
    const px = (x: number, y: number) => image.data[(y * 64 + x) * 4];
    expect(px(10, 10)).toBe(255); // inside the scaled content
    expect(px(10, 40)).toBe(0); // bottom padding
    expect(px(63, 63)).toBe(0);
  });
});

describe('rgbaToChwFloat', () => {
  it('normalizes per channel into CHW planes', () => {
    const img: RgbaImage = {
      width: 2,
      height: 1,
      data: new Uint8Array([255, 128, 0, 255, 10, 20, 30, 255]),
    };
    const t = rgbaToChwFloat(img, 127.5, 128);
    expect(t).toHaveLength(6);
    expect(t[0]).toBeCloseTo((255 - 127.5) / 128, 6); // R px0
    expect(t[1]).toBeCloseTo((10 - 127.5) / 128, 6); // R px1
    expect(t[2]).toBeCloseTo((128 - 127.5) / 128, 6); // G px0
    expect(t[3]).toBeCloseTo((20 - 127.5) / 128, 6); // G px1
    expect(t[4]).toBeCloseTo((0 - 127.5) / 128, 6); // B px0
    expect(t[5]).toBeCloseTo((30 - 127.5) / 128, 6); // B px1
  });
});
