import { l2Normalize, preprocessAlignedFace } from './arcface.js';
import { ARCFACE_CROP_SIZE, ARCFACE_TEMPLATE, MODEL_ID } from './constants.js';
import { estimateSimilarity, invertSimilarity } from './geometry.js';
import {
  JimpImageDecoder,
  letterbox,
  rgbaToChwFloat,
  warpAffineBilinear,
  type ImageDecoder,
} from './image.js';
import type { InferenceSessionLike, SessionProvider } from './onnx.js';
import {
  decodeScrfdOutputs,
  SCRFD_500M_CONFIG,
  SCRFD_MEAN,
  SCRFD_STD,
  type ScrfdConfig,
} from './scrfd.js';

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
    let image;
    try {
      image = await this.decoder.decode(imageBytes);
    } catch (err) {
      return { ok: false, code: 'DECODE_FAILED', message: `image decode failed: ${String(err)}` };
    }

    const { image: boxed, scale } = letterbox(image, this.scrfdConfig.inputSize);
    const detInput = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
    const size = this.scrfdConfig.inputSize;
    const detOut = await this.detection.run({
      [this.detection.inputNames[0]]: { data: detInput, dims: [1, 3, size, size] },
    });
    const ordered = this.detection.outputNames.map((name) => detOut[name]);
    const faces = decodeScrfdOutputs(ordered, this.scrfdConfig, scale);
    if (faces.length === 0) {
      return { ok: false, code: 'NO_FACE', message: 'no face detected in photo' };
    }
    const best = faces.reduce((a, b) => (b.score > a.score ? b : a));

    const toTemplate = estimateSimilarity(best.landmarks, ARCFACE_TEMPLATE);
    const crop = warpAffineBilinear(
      image,
      invertSimilarity(toTemplate),
      ARCFACE_CROP_SIZE,
      ARCFACE_CROP_SIZE,
    );
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
}
