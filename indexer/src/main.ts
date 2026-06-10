import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_BLOB_STORE_NAME,
  DEFAULT_INDEX_BLOB_KEY,
  IpfsClient,
  NetlifyBlobStore,
  OnnxFacePipeline,
  runIndexer,
  SubgraphClient,
  type ChainId,
} from '@pohdf/core';
import { nodeSessionProvider } from './nodeSession.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function subgraphEndpoints(): Partial<Record<ChainId, string>> {
  const endpoints: Partial<Record<ChainId, string>> = {};
  if (process.env.MAINNET_SUBGRAPH_URL) endpoints.mainnet = process.env.MAINNET_SUBGRAPH_URL;
  if (process.env.GNOSIS_SUBGRAPH_URL) endpoints.gnosis = process.env.GNOSIS_SUBGRAPH_URL;
  if (Object.keys(endpoints).length === 0) {
    throw new Error('set MAINNET_SUBGRAPH_URL and/or GNOSIS_SUBGRAPH_URL');
  }
  return endpoints;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'update';
  if (mode !== 'update' && mode !== 'bootstrap') {
    throw new Error(`unknown mode '${mode}'; expected 'update' or 'bootstrap'`);
  }

  const modelsDir = process.env.MODELS_DIR ?? 'models';
  const [detection, recognition] = await Promise.all([
    readFile(path.join(modelsDir, 'det_500m.onnx')),
    readFile(path.join(modelsDir, 'w600k_mbf.onnx')),
  ]);

  const pipeline = await OnnxFacePipeline.create(nodeSessionProvider, {
    detection: new Uint8Array(detection),
    recognition: new Uint8Array(recognition),
  });

  const summary = await runIndexer(
    {
      blobs: new NetlifyBlobStore({
        name: process.env.BLOB_STORE_NAME ?? DEFAULT_BLOB_STORE_NAME,
        siteID: requireEnv('NETLIFY_SITE_ID'),
        token: requireEnv('NETLIFY_AUTH_TOKEN'),
      }),
      subgraph: new SubgraphClient(subgraphEndpoints()),
      ipfs: new IpfsClient({ timeoutMs: 15_000 }),
      pipeline,
      log: {
        info: (message) => console.log(`[indexer] ${message}`),
        warn: (message) => console.warn(`[indexer] WARN ${message}`),
      },
    },
    {
      blobKey: process.env.INDEX_BLOB_KEY ?? DEFAULT_INDEX_BLOB_KEY,
      bootstrap: mode === 'bootstrap',
    },
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[indexer] run failed:', err);
  process.exitCode = 1;
});
