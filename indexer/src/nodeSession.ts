import * as ort from 'onnxruntime-node';
import { createOrtSessionProvider, type OrtApi } from '@pohdf/core';

/** onnxruntime-node adapter; the Netlify function uses the WASM twin of this. */
// The cast narrows ort's richer feed/value types to the structural OrtApi view.
export const nodeSessionProvider = createOrtSessionProvider(ort as unknown as OrtApi);
