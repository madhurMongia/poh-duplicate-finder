import { l2Normalize, preprocessAlignedFace } from './arcface.js';
import { ARCFACE_CROP_SIZE, ARCFACE_TEMPLATE, EMBEDDING_DIMS, MODEL_ID } from './constants.js';
import { estimateSimilarity, invertSimilarity } from './geometry.js';
import {
  JimpImageDecoder,
  letterbox,
  padToCanvas,
  rgbaToChwFloat,
  warpAffineBilinear,
  type ImageDecoder,
  type RgbaImage,
} from './image.js';
import type { InferenceSessionLike, SessionProvider } from './onnx.js';
import {
  decodeScrfdOutputs,
  SCRFD_500M_CONFIG,
  SCRFD_MEAN,
  SCRFD_STD,
  type DetectedFace,
  type ScrfdConfig,
} from './scrfd.js';

/**
 * "Zoom out" retry ladder for detection. SCRFD is trained on scenes where
 * faces are small relative to the frame; PoH registration photos are tight
 * head crops (face ~85% of frame) which the detector scores far below the
 * confidence threshold (~0.3 vs ~0.87 once padded). Retry on progressively
 * larger black canvases until a face clears the threshold.
 */
const DETECT_PAD_FACTORS = [1, 1.5, 2.25];

export interface EmbedSuccess {
  ok: true;
  /** L2-normalized 512-d embedding. */
  embedding: Float32Array;
  faceCount: number;
  detScore: number;
}

export interface EmbedFailure {
  ok: false;
  code: 'NO_FACE' | 'DECODE_FAILED';
  message: string;
}

export type EmbedResult = EmbedSuccess | EmbedFailure;

export interface FacePipeline {
  readonly modelId: string;
  readonly embeddingDims: number;
  embedFace(imageBytes: Uint8Array): Promise<EmbedResult>;
}

export interface PipelineModels {
  detection: Uint8Array;
  recognition: Uint8Array;
}

/**
 * detect (SCRFD) -> align (similarity to ArcFace template) -> embed (w600k_mbf).
 * When multiple faces are detected, the highest-scoring one is used and
 * faceCount reports the total so callers can warn.
 */
export class OnnxFacePipeline implements FacePipeline {
  readonly embeddingDims = EMBEDDING_DIMS;

  constructor(
    private readonly detection: InferenceSessionLike,
    private readonly recognition: InferenceSessionLike,
    private readonly decoder: ImageDecoder = new JimpImageDecoder(),
    private readonly scrfdConfig: ScrfdConfig = SCRFD_500M_CONFIG,
    readonly modelId: string = MODEL_ID,
  ) {}

  static async create(
    provider: SessionProvider,
    models: PipelineModels,
    decoder: ImageDecoder = new JimpImageDecoder(),
  ): Promise<OnnxFacePipeline> {
    const [detection, recognition] = await Promise.all([
      provider(models.detection),
      provider(models.recognition),
    ]);
    return new OnnxFacePipeline(detection, recognition, decoder);
  }

  async embedFace(imageBytes: Uint8Array): Promise<EmbedResult> {
    // 1. Decode the photo to raw RGBA.
    let image;
    try {
      image = await this.decoder.decode(imageBytes);
    } catch (err) {
      return { ok: false, code: 'DECODE_FAILED', message: `image decode failed: ${String(err)}` };
    }

    // 2. Detect: letterbox to the detector's square input and decode anchors,
    // zooming out via DETECT_PAD_FACTORS when nothing clears the threshold.
    let faces: DetectedFace[] = [];
    for (const factor of DETECT_PAD_FACTORS) {
      const {
        image: canvas,
        offsetX,
        offsetY,
      } = factor === 1 ? { image, offsetX: 0, offsetY: 0 } : padToCanvas(image, factor);
      const detected = await this.detect(canvas);
      if (detected.length > 0) {
        // Map canvas coordinates back onto the original image for alignment.
        faces = detected.map((face) => shiftFace(face, -offsetX, -offsetY));
        break;
      }
    }
    if (faces.length === 0) {
      return { ok: false, code: 'NO_FACE', message: 'no face detected in photo' };
    }
    const best = faces.reduce((a, b) => (b.score > a.score ? b : a));

    // 3. Align: fit landmarks -> template, then warp the *original* image
    // (not the letterboxed one) into the canonical 112x112 ArcFace crop.
    const toTemplate = estimateSimilarity(best.landmarks, ARCFACE_TEMPLATE);
    const crop = warpAffineBilinear(
      image,
      invertSimilarity(toTemplate),
      ARCFACE_CROP_SIZE,
      ARCFACE_CROP_SIZE,
    );
    // 4. Embed: run the recognition net and L2-normalize so that comparing
    // two faces reduces to a dot product (cosine similarity).
    const recInput = preprocessAlignedFace(crop);
    const recOut = await this.recognition.run({
      [this.recognition.inputNames[0]]: {
        data: recInput,
        dims: [1, 3, ARCFACE_CROP_SIZE, ARCFACE_CROP_SIZE],
      },
    });
    const raw = recOut[this.recognition.outputNames[0]];
    return {
      ok: true,
      embedding: l2Normalize(raw.data),
      faceCount: faces.length,
      detScore: best.score,
    };
  }

  /** Letterbox to the detector's square input, run SCRFD, decode anchors. */
  private async detect(canvas: RgbaImage): Promise<DetectedFace[]> {
    const size = this.scrfdConfig.inputSize;
    const { image: boxed, scale } = letterbox(canvas, size);
    const detInput = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
    const detOut = await this.detection.run({
      [this.detection.inputNames[0]]: { data: detInput, dims: [1, 3, size, size] },
    });
    const ordered = this.detection.outputNames.map((name) => detOut[name]);
    return decodeScrfdOutputs(ordered, this.scrfdConfig, scale);
  }
}

/** Translate a detection (box + landmarks) by (dx, dy). */
function shiftFace(face: DetectedFace, dx: number, dy: number): DetectedFace {
  return {
    score: face.score,
    box: {
      x1: face.box.x1 + dx,
      y1: face.box.y1 + dy,
      x2: face.box.x2 + dx,
      y2: face.box.y2 + dy,
    },
    landmarks: face.landmarks.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}
