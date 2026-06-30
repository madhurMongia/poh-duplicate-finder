import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Jimp } from 'jimp';
import { EMBEDDING_DIMS, MODEL_ID } from './constants.js';

export interface EmbedSuccess {
  ok: true;
  /** Normalized face descriptor from Human FaceRes. */
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

interface HumanTensor {
  dispose(): void;
}

interface HumanLike {
  tf: {
    ready(): Promise<void>;
    tensor3d(data: Int32Array, shape: [number, number, number], dtype: 'int32'): HumanTensor;
  };
  load(): Promise<void>;
  detect(
    input: HumanTensor,
  ): Promise<{ face: { boxScore?: number; score?: number; embedding?: number[] }[] }>;
}

interface HumanModule {
  Human: new (config: Record<string, unknown>) => HumanLike;
}

const require = createRequire(import.meta.url);

/**
 * Face pipeline backed by @vladmandic/human's default BlazeFace detector and
 * FaceRes descriptor. Both the indexer and lookup function instantiate this,
 * so index and query embeddings stay in the same vector space.
 */
export class HumanFacePipeline implements FacePipeline {
  readonly modelId = MODEL_ID;
  readonly embeddingDims = EMBEDDING_DIMS;

  private constructor(private readonly human: HumanLike) {}

  static async create(): Promise<HumanFacePipeline> {
    const humanMain = require.resolve('@vladmandic/human');
    const humanDist = path.dirname(humanMain);
    const humanRoot = path.dirname(humanDist);
    const tfWasmFile = require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm');

    const mod = (await import(
      pathToFileURL(path.join(humanDist, 'human.node-wasm.js')).href
    )) as HumanModule;
    const human = new mod.Human({
      backend: 'wasm',
      debug: false,
      modelBasePath: pathToFileURL(path.join(humanRoot, 'models') + path.sep).href,
      wasmPath: pathToFileURL(path.dirname(tfWasmFile) + path.sep).href,
      cacheModels: false,
      body: { enabled: false },
      hand: { enabled: false },
      gesture: { enabled: false },
      object: { enabled: false },
      segmentation: { enabled: false },
      face: {
        enabled: true,
        detector: { enabled: true, maxDetected: 1 },
        description: { enabled: true },
        mesh: { enabled: false },
        iris: { enabled: false },
        emotion: { enabled: false },
      },
    });

    await withFileFetch(async () => {
      await human.tf.ready();
      await human.load();
    });

    return new HumanFacePipeline(human);
  }

  async embedFace(imageBytes: Uint8Array): Promise<EmbedResult> {
    let image;
    try {
      image = await Jimp.fromBuffer(Buffer.from(imageBytes));
    } catch (err) {
      return { ok: false, code: 'DECODE_FAILED', message: `image decode failed: ${String(err)}` };
    }

    const { width, height, data } = image.bitmap;
    const rgb = new Int32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = data[i * 4];
      rgb[i * 3 + 1] = data[i * 4 + 1];
      rgb[i * 3 + 2] = data[i * 4 + 2];
    }

    const tensor = this.human.tf.tensor3d(rgb, [height, width, 3], 'int32');
    try {
      const result = await this.human.detect(tensor);
      const best = result.face[0];
      if (!best?.embedding) {
        return { ok: false, code: 'NO_FACE', message: 'no face detected in photo' };
      }
      if (best.embedding.length !== this.embeddingDims) {
        throw new Error(
          `Human embedding dims ${best.embedding.length} != expected ${this.embeddingDims}; update MODEL_ID and rebuild`,
        );
      }
      return {
        ok: true,
        // L2-normalize so ranking's dot product is a true cosine similarity,
        // identically for index rows and query photos.
        embedding: l2Normalize(new Float32Array(best.embedding)),
        faceCount: result.face.length,
        detScore: best.boxScore ?? best.score ?? 0,
      };
    } finally {
      tensor.dispose();
    }
  }
}

/** Scale a vector to unit length; a zero vector is returned unchanged. */
function l2Normalize(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

async function withFileFetch<T>(fn: () => Promise<T>): Promise<T> {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('file://')) {
      return new Response(await readFile(fileURLToPath(url)), { status: 200 });
    }
    return nativeFetch(input, init);
  };

  try {
    return await fn();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}
