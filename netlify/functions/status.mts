import {
  decodeIndexHeader,
  DEFAULT_BLOB_STORE_NAME,
  DEFAULT_INDEX_BLOB_KEY,
  NetlifyBlobStore,
  type IndexStatusResponse,
} from '@pohdf/core';
import { jsonResponse } from './lib/deps.mjs';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return jsonResponse({ message: 'use GET' }, 405);
  const blobs = new NetlifyBlobStore({
    name: process.env.BLOB_STORE_NAME ?? DEFAULT_BLOB_STORE_NAME,
  });
  const blob = await blobs.get(process.env.INDEX_BLOB_KEY ?? DEFAULT_INDEX_BLOB_KEY);
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
