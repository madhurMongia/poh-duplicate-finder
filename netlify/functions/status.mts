import { decodeIndexHeader, type IndexStatusResponse } from '@pohdf/core';
import { createBlobStore, indexBlobKey, jsonResponse } from './lib/deps.mjs';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return jsonResponse({ message: 'use GET' }, 405);
  const blob = await createBlobStore().get(indexBlobKey());
  if (!blob) return jsonResponse({ message: 'index not built yet' }, 503);

  const header = decodeIndexHeader(blob);
  const body: IndexStatusResponse = {
    modelId: header.modelId,
    count: header.count,
    builtAt: header.builtAt,
    checkpoints: header.checkpoints,
    pendingRetries: header.retries.length,
  };
  return jsonResponse(body);
};

export const config = { path: '/api/status' };
