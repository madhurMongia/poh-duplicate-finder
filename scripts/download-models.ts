/**
 * Download the insightface buffalo_s release zip and extract the two models
 * the pipeline needs into ./models. Idempotent: skips when both files exist.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RELEASE_URL =
  'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip';
const MODELS_DIR = process.env.MODELS_DIR ?? 'models';
const MODELS = ['det_500m.onnx', 'w600k_mbf.onnx'];

async function main(): Promise<void> {
  if (MODELS.every((m) => existsSync(path.join(MODELS_DIR, m)))) {
    console.log(`models already present in ${MODELS_DIR}/, skipping download`);
    return;
  }
  mkdirSync(MODELS_DIR, { recursive: true });

  console.log(`downloading ${RELEASE_URL} …`);
  const res = await fetch(RELEASE_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const zipPath = path.join(MODELS_DIR, 'buffalo_s.zip');
  writeFileSync(zipPath, new Uint8Array(await res.arrayBuffer()));

  // -j flattens paths; wildcards tolerate the zip nesting entries in a folder.
  execFileSync('unzip', ['-o', '-j', zipPath, ...MODELS.map((m) => `*${m}`), '-d', MODELS_DIR], {
    stdio: 'inherit',
  });
  rmSync(zipPath);

  for (const m of MODELS) {
    if (!existsSync(path.join(MODELS_DIR, m))) throw new Error(`missing ${m} after extraction`);
  }
  console.log(`models ready in ${MODELS_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
