/**
 * Upload the local ONNX models to the site's Netlify blob store, where the
 * lookup function loads them from. One-time setup step (and after model bumps).
 *
 * Requires: NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BLOB_STORE_NAME,
  MODEL_BLOB_KEYS,
  NetlifyBlobStore,
} from '../core/src/index.js';

const MODELS_DIR = process.env.MODELS_DIR ?? 'models';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

async function main(): Promise<void> {
  const blobs = new NetlifyBlobStore({
    name: process.env.BLOB_STORE_NAME ?? DEFAULT_BLOB_STORE_NAME,
    siteID: requireEnv('NETLIFY_SITE_ID'),
    token: requireEnv('NETLIFY_AUTH_TOKEN'),
  });

  for (const [kind, key] of Object.entries(MODEL_BLOB_KEYS)) {
    const file = path.join(MODELS_DIR, path.basename(key));
    const bytes = new Uint8Array(readFileSync(file));
    await blobs.set(key, bytes);
    console.log(`uploaded ${kind}: ${file} -> ${key} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
