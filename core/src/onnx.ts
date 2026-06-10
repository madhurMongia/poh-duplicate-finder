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
