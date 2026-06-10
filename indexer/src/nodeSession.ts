import * as ort from 'onnxruntime-node';
import type { InferenceSessionLike, SessionProvider, TensorLike } from '@pohdf/core';

/** onnxruntime-node adapter; the Netlify function uses the WASM twin of this. */
export const nodeSessionProvider: SessionProvider = async (
  modelBytes: Uint8Array,
): Promise<InferenceSessionLike> => {
  const session = await ort.InferenceSession.create(Buffer.from(modelBytes));
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
      const ortFeeds: Record<string, ort.Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        ortFeeds[name] = new ort.Tensor('float32', tensor.data, tensor.dims);
      }
      const results = await session.run(ortFeeds);
      const out: Record<string, TensorLike> = {};
      for (const [name, tensor] of Object.entries(results)) {
        out[name] = { data: tensor.data as Float32Array, dims: tensor.dims as number[] };
      }
      return out;
    },
  };
};
