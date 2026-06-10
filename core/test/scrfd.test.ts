import { describe, expect, it } from 'vitest';
import type { TensorLike } from '../src/onnx.js';
import { decodeScrfdOutputs, iou, nonMaxSuppression, type ScrfdConfig } from '../src/scrfd.js';

const CFG: ScrfdConfig = {
  inputSize: 32,
  strides: [8],
  anchorsPerCell: 2,
  scoreThreshold: 0.5,
  iouThreshold: 0.4,
};
// 32/8 = 4x4 cells * 2 anchors = 32 anchors for the single stride.
const TOTAL = 32;

function emptyOutputs(): TensorLike[] {
  return [
    { data: new Float32Array(TOTAL), dims: [TOTAL, 1] },
    { data: new Float32Array(TOTAL * 4), dims: [TOTAL, 4] },
    { data: new Float32Array(TOTAL * 10), dims: [TOTAL, 10] },
  ];
}

/** Anchor 0 of cell (row 1, col 2): index = (1*4 + 2) * 2 = 12, center (16, 8). */
const ANCHOR = 12;

function setAnchor(
  outputs: TensorLike[],
  index: number,
  score: number,
  dists: [number, number, number, number],
  kpsOffsets: number[],
): void {
  outputs[0].data[index] = score;
  outputs[1].data.set(dists, index * 4);
  outputs[2].data.set(kpsOffsets, index * 10);
}

describe('decodeScrfdOutputs', () => {
  it('decodes box and landmarks from anchor-relative distances', () => {
    const outputs = emptyOutputs();
    setAnchor(outputs, ANCHOR, 0.9, [1, 0.5, 1, 0.5], [0.5, -0.5, 1, 1, 0, 0, -1, 1, 2, 2]);
    const faces = decodeScrfdOutputs(outputs, CFG, 0.5);
    expect(faces).toHaveLength(1);
    const face = faces[0];
    expect(face.score).toBeCloseTo(0.9, 6);
    // center (16,8), dists * stride 8 = (8,4,8,4) -> box (8,4,24,12), / scale 0.5
    expect(face.box).toEqual({ x1: 16, y1: 8, x2: 48, y2: 24 });
    // first landmark: (16 + 0.5*8, 8 - 0.5*8) = (20, 4) / 0.5 = (40, 8)
    expect(face.landmarks[0]).toEqual({ x: 40, y: 8 });
    expect(face.landmarks[4]).toEqual({ x: 64, y: 48 });
  });

  it('drops anchors below the score threshold', () => {
    const outputs = emptyOutputs();
    setAnchor(outputs, ANCHOR, 0.3, [1, 1, 1, 1], new Array(10).fill(0));
    expect(decodeScrfdOutputs(outputs, CFG, 1)).toHaveLength(0);
  });

  it('suppresses overlapping detections, keeping the strongest', () => {
    const outputs = emptyOutputs();
    setAnchor(outputs, ANCHOR, 0.9, [1, 1, 1, 1], new Array(10).fill(0));
    // Anchor 13 shares the same cell center -> same box -> suppressed.
    setAnchor(outputs, ANCHOR + 1, 0.7, [1, 1, 1, 1], new Array(10).fill(0));
    // Cell (row 3, col 0) -> index 24, center (0, 24): disjoint box -> kept.
    setAnchor(outputs, 24, 0.6, [0.5, 0.5, 0.5, 0.5], new Array(10).fill(0));
    const faces = decodeScrfdOutputs(outputs, CFG, 1);
    expect(faces).toHaveLength(2);
    expect(faces[0].score).toBeCloseTo(0.9, 6);
    expect(faces[1].score).toBeCloseTo(0.6, 6);
  });

  it('validates output count', () => {
    expect(() => decodeScrfdOutputs(emptyOutputs().slice(0, 2), CFG, 1)).toThrow(/expected 3/);
  });
});

describe('iou / nonMaxSuppression', () => {
  it('computes IoU for identical and disjoint boxes', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(iou(a, a)).toBeCloseTo(1, 6);
    expect(iou(a, { x1: 20, y1: 20, x2: 30, y2: 30 })).toBe(0);
  });

  it('keeps order by score', () => {
    const box = { x1: 0, y1: 0, x2: 10, y2: 10 };
    const kept = nonMaxSuppression(
      [
        { box, score: 0.6, landmarks: [] },
        { box, score: 0.9, landmarks: [] },
      ],
      0.4,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].score).toBeCloseTo(0.9, 6);
  });
});
