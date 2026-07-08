import path from 'node:path';
import * as ort from 'onnxruntime-web';
import { createOrtSessionProvider, type OrtApi } from '@pohdf/core';

// Single-threaded WASM: no SharedArrayBuffer requirements inside the lambda.
ort.env.wasm.numThreads = 1;
// The .wasm binaries ship via netlify.toml included_files; ORT_WASM_DIR
// overrides for local `netlify dev`.
ort.env.wasm.wasmPaths =
  process.env.ORT_WASM_DIR ??
  path.join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'node_modules/onnxruntime-web/dist/');

/** onnxruntime-web (WASM) adapter; the indexer uses the native node twin. */
// The cast narrows ort's richer feed/value types to the structural OrtApi view.
export const ortWebSessionProvider = createOrtSessionProvider(ort as unknown as OrtApi);
