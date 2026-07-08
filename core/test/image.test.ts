import { describe, expect, it } from 'vitest';
import { padToCanvas, type RgbaImage } from '../src/image.js';

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

function pixelAt(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

describe('padToCanvas', () => {
  it('centers the source on a factor-times-larger black canvas', () => {
    const src = solidImage(4, 2, [200, 100, 50]);
    const { image, offsetX, offsetY } = padToCanvas(src, 2);

    expect(image.width).toBe(8);
    expect(image.height).toBe(4);
    expect(offsetX).toBe(2);
    expect(offsetY).toBe(1);

    // Source pixels land at (offsetX, offsetY).
    expect(pixelAt(image, 2, 1)).toEqual([200, 100, 50]);
    expect(pixelAt(image, 5, 2)).toEqual([200, 100, 50]);
    // Padding stays black.
    expect(pixelAt(image, 0, 0)).toEqual([0, 0, 0]);
    expect(pixelAt(image, 7, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(image, 1, 1)).toEqual([0, 0, 0]);
  });

  it('rounds non-integer canvas sizes and keeps offsets consistent', () => {
    const src = solidImage(3, 3, [10, 20, 30]);
    const { image, offsetX, offsetY } = padToCanvas(src, 1.5);

    expect(image.width).toBe(5); // round(4.5)
    expect(image.height).toBe(5);
    expect(offsetX).toBe(1);
    expect(offsetY).toBe(1);
    expect(pixelAt(image, 1, 1)).toEqual([10, 20, 30]);
    expect(pixelAt(image, 3, 3)).toEqual([10, 20, 30]);
    expect(pixelAt(image, 4, 4)).toEqual([0, 0, 0]);
  });

  it('is an identity layout at factor 1', () => {
    const src = solidImage(2, 2, [1, 2, 3]);
    const { image, offsetX, offsetY } = padToCanvas(src, 1);
    expect(offsetX).toBe(0);
    expect(offsetY).toBe(0);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect(Array.from(image.data)).toEqual(Array.from(src.data));
  });
});
