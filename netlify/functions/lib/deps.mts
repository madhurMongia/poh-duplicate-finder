import {
  createCachedIndexLoader,
  DEFAULT_INDEX_BLOB_KEY,
  IpfsClient,
  MODEL_BLOB_KEYS,
  OnnxFacePipeline,
  resolveBlobStore,
  SubgraphClient,
  type BlobStore,
  type ChainId,
  type LookupDeps,
  type PreviewDeps,
} from '@pohdf/core';
import { ortWebSessionProvider } from './ortWebSession.mjs';

export function createBlobStore(): BlobStore {
  return resolveBlobStore(process.env);
}

export function indexBlobKey(): string {
  return process.env.INDEX_BLOB_KEY ?? DEFAULT_INDEX_BLOB_KEY;
}

function subgraphEndpoints(): Partial<Record<ChainId, string>> {
  const endpoints: Partial<Record<ChainId, string>> = {};
  if (process.env.MAINNET_SUBGRAPH_URL) endpoints.mainnet = process.env.MAINNET_SUBGRAPH_URL;
  if (process.env.GNOSIS_SUBGRAPH_URL) endpoints.gnosis = process.env.GNOSIS_SUBGRAPH_URL;
  return endpoints;
}

let cachedPreview: PreviewDeps | null = null;

/** Subgraph + IPFS only — no blobs, no ONNX models. Cheap enough for live previews. */
export function getPreviewDeps(): PreviewDeps {
  cachedPreview ??= { subgraph: new SubgraphClient(subgraphEndpoints()), ipfs: new IpfsClient() };
  return cachedPreview;
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
  const endpoints = subgraphEndpoints();
  const [detection, recognition] = await Promise.all([
    blobs.get(MODEL_BLOB_KEYS.detection),
    blobs.get(MODEL_BLOB_KEYS.recognition),
  ]);
  if (!detection || !recognition) {
    throw new Error('ONNX model blobs missing; run `npm run models:upload` before lookup');
  }

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
