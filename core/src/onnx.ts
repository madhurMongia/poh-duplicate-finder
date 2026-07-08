/**
 * Minimal structural ONNX runtime abstraction. Core never imports an ONNX
 * runtime directly; the indexer injects onnxruntime-node and the Netlify
 * function injects onnxruntime-web (WASM). Both must load the *same* model
 * bytes — embeddings from different models are incompatible.
 */
export interface TensorLike {
  data: Float32Array;
  dims: number[];
}

export interface InferenceSessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
}

export type SessionProvider = (modelBytes: Uint8Array) => Promise<InferenceSessionLike>;

/**
 * Structural view of an ONNX runtime module — the shape onnxruntime-node and
 * onnxruntime-web share. Adapters cast their module to this once.
 */
export interface OrtApi {
  InferenceSession: {
    create(model: Uint8Array): Promise<{
      inputNames: readonly string[];
      outputNames: readonly string[];
      run(
        feeds: Record<string, unknown>,
      ): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
    }>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}

/** Wrap an ONNX runtime module (node or web) as a SessionProvider. */
export function createOrtSessionProvider(ort: OrtApi): SessionProvider {
  return async (modelBytes: Uint8Array): Promise<InferenceSessionLike> => {
    const session = await ort.InferenceSession.create(modelBytes);
    return {
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
        const ortFeeds: Record<string, unknown> = {};
        for (const [name, tensor] of Object.entries(feeds)) {
          ortFeeds[name] = new ort.Tensor('float32', tensor.data, tensor.dims);
        }
        const results = await session.run(ortFeeds);
        const out: Record<string, TensorLike> = {};
        for (const [name, tensor] of Object.entries(results)) {
          out[name] = { data: tensor.data as Float32Array, dims: [...tensor.dims] };
        }
        return out;
      },
    };
  };
}
