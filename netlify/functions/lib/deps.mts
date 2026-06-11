import {
  createCachedIndexLoader,
  DEFAULT_BLOB_STORE_NAME,
  DEFAULT_INDEX_BLOB_KEY,
  IpfsClient,
  MODEL_BLOB_KEYS,
  NetlifyBlobStore,
  OnnxFacePipeline,
  SubgraphClient,
  type ChainId,
  type LookupDeps,
} from '@pohdf/core';
import { ortWebSessionProvider } from './ortWebSession.mjs';

export function createBlobStore(): NetlifyBlobStore {
  return new NetlifyBlobStore({ name: process.env.BLOB_STORE_NAME ?? DEFAULT_BLOB_STORE_NAME });
}

export function indexBlobKey(): string {
  return process.env.INDEX_BLOB_KEY ?? DEFAULT_INDEX_BLOB_KEY;
}

let cached: Promise<LookupDeps> | null = null;

/** Module-scope cache: models, sessions, and the index loader survive across warm invocations. */
export function getLookupDeps(): Promise<LookupDeps> {
  cached ??= build().catch((err) => {
    cached = null; // allow the next invocation to retry a failed cold start
    throw err;
  });
  return cached;
}

async function build(): Promise<LookupDeps> {
  const blobs = createBlobStore();
  const [detection, recognition] = await Promise.all([
    blobs.get(MODEL_BLOB_KEYS.detection),
    blobs.get(MODEL_BLOB_KEYS.recognition),
  ]);
  if (!detection || !recognition) {
    throw new Error('ONNX models missing from blob store; run `npm run models:upload`');
  }
  const endpoints: Partial<Record<ChainId, string>> = {};
  if (process.env.MAINNET_SUBGRAPH_URL) endpoints.mainnet = process.env.MAINNET_SUBGRAPH_URL;
  if (process.env.GNOSIS_SUBGRAPH_URL) endpoints.gnosis = process.env.GNOSIS_SUBGRAPH_URL;

  return {
    loadIndex: createCachedIndexLoader(blobs, { key: indexBlobKey() }),
    subgraph: new SubgraphClient(endpoints),
    ipfs: new IpfsClient(),
    pipeline: await OnnxFacePipeline.create(ortWebSessionProvider, { detection, recognition }),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
