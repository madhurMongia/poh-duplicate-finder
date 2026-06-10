import { describe, expect, it } from 'vitest';
import { ARCFACE_TEMPLATE } from '../src/constants.js';
import type { ImageDecoder, RgbaImage } from '../src/image.js';
import type { InferenceSessionLike, TensorLike } from '../src/onnx.js';
import { OnnxFacePipeline } from '../src/pipeline.js';
import { SCRFD_500M_CONFIG } from '../src/scrfd.js';

const SIZE = SCRFD_500M_CONFIG.inputSize; // 640
const IMG = 112;
const SCALE = SIZE / IMG;

function gradientImage(): RgbaImage {
  const data = new Uint8Array(IMG * IMG * 4);
  for (let i = 0; i < IMG * IMG; i++) {
    data[i * 4] = i % 251;
    data[i * 4 + 1] = (i * 3) % 251;
    data[i * 4 + 2] = (i * 5) % 251;
    data[i * 4 + 3] = 255;
  }
  return { width: IMG, height: IMG, data };
}

class FakeDecoder implements ImageDecoder {
  constructor(private readonly image: RgbaImage | null) {}
  async decode(): Promise<RgbaImage> {
    if (!this.image) throw new Error('corrupt image');
    return this.image;
  }
}

class FakeSession implements InferenceSessionLike {
  lastFeeds: Record<string, TensorLike> | null = null;
  constructor(
    readonly inputNames: string[],
    readonly outputNames: string[],
    private readonly respond: () => Record<string, TensorLike>,
  ) {}
  async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
    this.lastFeeds = feeds;
    return this.respond();
  }
}

const DET_OUTPUTS = ['s8', 's16', 's32', 'b8', 'b16', 'b32', 'k8', 'k16', 'k32'];

/**
 * Detector fake placing one 0.99-score face at stride-8 anchor 0 (center 0,0)
 * whose landmarks decode exactly to the ArcFace template in original image
 * coordinates — so alignment is the identity and the recognition crop must
 * reproduce the original pixels.
 */
function detSession(score = 0.99): FakeSession {
  return new FakeSession(['det_in'], DET_OUTPUTS, () => {
    const counts = SCRFD_500M_CONFIG.strides.map((s) => (SIZE / s) ** 2 * 2);
    const out: Record<string, TensorLike> = {};
    SCRFD_500M_CONFIG.strides.forEach((_, i) => {
      out[`s${SCRFD_500M_CONFIG.strides[i]}`] = {
        data: new Float32Array(counts[i]),
        dims: [counts[i], 1],
      };
      out[`b${SCRFD_500M_CONFIG.strides[i]}`] = {
        data: new Float32Array(counts[i] * 4),
        dims: [counts[i], 4],
      };
      out[`k${SCRFD_500M_CONFIG.strides[i]}`] = {
        data: new Float32Array(counts[i] * 10),
        dims: [counts[i], 10],
      };
    });
    if (score > 0) {
      out.s8.data[0] = score;
      out.b8.data.set([-2, -2, 26, 26], 0); // any plausible box around the face
      ARCFACE_TEMPLATE.forEach((p, k) => {
        out.k8.data[k * 2] = (p.x * SCALE) / 8;
        out.k8.data[k * 2 + 1] = (p.y * SCALE) / 8;
      });
    }
    return out;
  });
}

function recSession(): FakeSession {
  return new FakeSession(['rec_in'], ['embedding'], () => ({
    embedding: { data: new Float32Array(512).fill(2), dims: [1, 512] },
  }));
}

describe('OnnxFacePipeline.embedFace', () => {
  it('detects, aligns, and returns a normalized embedding', async () => {
    const det = detSession();
    const rec = recSession();
    const pipeline = new OnnxFacePipeline(det, rec, new FakeDecoder(gradientImage()));
    const result = await pipeline.embedFace(new Uint8Array([0]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.faceCount).toBe(1);
    expect(result.detScore).toBeCloseTo(0.99, 6);
    expect(result.embedding).toHaveLength(512);
    for (const v of result.embedding) expect(v).toBeCloseTo(1 / Math.sqrt(512), 6);

    // Detector got a 640x640 normalized CHW tensor.
    const detFeed = det.lastFeeds!.det_in;
    expect(detFeed.dims).toEqual([1, 3, SIZE, SIZE]);

    // Landmarks == template means identity alignment: the recognition input
    // must reproduce the original image, ArcFace-normalized.
    const recFeed = rec.lastFeeds!.rec_in;
    expect(recFeed.dims).toEqual([1, 3, IMG, IMG]);
    const img = gradientImage();
    for (const p of [0, 1, IMG + 5, IMG * IMG - 1]) {
      expect(recFeed.data[p]).toBeCloseTo((img.data[p * 4] - 127.5) / 127.5, 1);
    }
  });

  it('returns NO_FACE when nothing clears the detector threshold', async () => {
    const pipeline = new OnnxFacePipeline(
      detSession(0),
      recSession(),
      new FakeDecoder(gradientImage()),
    );
    const result = await pipeline.embedFace(new Uint8Array([0]));
    expect(result).toMatchObject({ ok: false, code: 'NO_FACE' });
  });

  it('returns DECODE_FAILED for undecodable bytes', async () => {
    const pipeline = new OnnxFacePipeline(detSession(), recSession(), new FakeDecoder(null));
    const result = await pipeline.embedFace(new Uint8Array([0]));
    expect(result).toMatchObject({ ok: false, code: 'DECODE_FAILED' });
  });
});
