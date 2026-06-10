import path from 'node:path';
import * as ort from 'onnxruntime-web';
import type { InferenceSessionLike, SessionProvider, TensorLike } from '@pohdf/core';

// Single-threaded WASM: no SharedArrayBuffer requirements inside the lambda.
ort.env.wasm.numThreads = 1;
// The .wasm binaries ship via netlify.toml included_files; ORT_WASM_DIR
// overrides for local `netlify dev`.
ort.env.wasm.wasmPaths =
  process.env.ORT_WASM_DIR ??
  path.join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'node_modules/onnxruntime-web/dist/');

/** onnxruntime-web (WASM) adapter; the indexer uses the native node twin. */
export const ortWebSessionProvider: SessionProvider = async (
  modelBytes: Uint8Array,
): Promise<InferenceSessionLike> => {
  const session = await ort.InferenceSession.create(modelBytes);
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
