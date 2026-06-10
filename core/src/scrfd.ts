import type { Point } from './geometry.js';
import type { TensorLike } from './onnx.js';

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectedFace {
  box: BoundingBox;
  score: number;
  /** 5 landmarks: left eye, right eye, nose, left mouth, right mouth. */
  landmarks: Point[];
}

export interface ScrfdConfig {
  inputSize: number;
  strides: number[];
  anchorsPerCell: number;
  scoreThreshold: number;
  iouThreshold: number;
}

export const SCRFD_500M_CONFIG: ScrfdConfig = {
  inputSize: 640,
  strides: [8, 16, 32],
  anchorsPerCell: 2,
  scoreThreshold: 0.5,
  iouThreshold: 0.4,
};

/** Detector input normalization: (v - 127.5) / 128, RGB. */
export const SCRFD_MEAN = 127.5;
export const SCRFD_STD = 128;

/**
 * Decode raw SCRFD outputs. `outputs` must be ordered as the model emits them:
 * scores for each stride, then bbox distances for each stride, then keypoint
 * offsets for each stride. Distances are in stride units (insightface
 * convention). `scale` is the letterbox scale; results are mapped back to
 * original image coordinates.
 */
export function decodeScrfdOutputs(
  outputs: TensorLike[],
  cfg: ScrfdConfig,
  scale: number,
): DetectedFace[] {
  const nStrides = cfg.strides.length;
  if (outputs.length !== nStrides * 3) {
    throw new Error(`SCRFD: expected ${nStrides * 3} outputs, got ${outputs.length}`);
  }
  const faces: DetectedFace[] = [];
  for (let s = 0; s < nStrides; s++) {
    const stride = cfg.strides[s];
    const scores = outputs[s].data;
    const bboxes = outputs[nStrides + s].data;
    const kps = outputs[2 * nStrides + s].data;
    const cells = Math.floor(cfg.inputSize / stride);
    const total = cells * cells * cfg.anchorsPerCell;
    if (scores.length < total) {
      throw new Error(`SCRFD: stride ${stride} expected ${total} anchors, got ${scores.length}`);
    }
    for (let i = 0; i < total; i++) {
      const score = scores[i];
      if (score < cfg.scoreThreshold) continue;
      const cell = Math.floor(i / cfg.anchorsPerCell);
      const cx = (cell % cells) * stride;
      const cy = Math.floor(cell / cells) * stride;
      const box: BoundingBox = {
        x1: (cx - bboxes[i * 4] * stride) / scale,
        y1: (cy - bboxes[i * 4 + 1] * stride) / scale,
        x2: (cx + bboxes[i * 4 + 2] * stride) / scale,
        y2: (cy + bboxes[i * 4 + 3] * stride) / scale,
      };
      const landmarks: Point[] = [];
      for (let k = 0; k < 5; k++) {
        landmarks.push({
          x: (cx + kps[i * 10 + k * 2] * stride) / scale,
          y: (cy + kps[i * 10 + k * 2 + 1] * stride) / scale,
        });
      }
      faces.push({ box, score, landmarks });
    }
  }
  return nonMaxSuppression(faces, cfg.iouThreshold);
}

export function nonMaxSuppression(faces: DetectedFace[], iouThreshold: number): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const face of sorted) {
    if (kept.every((k) => iou(k.box, face.box) < iouThreshold)) kept.push(face);
  }
  return kept;
}

export function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}
