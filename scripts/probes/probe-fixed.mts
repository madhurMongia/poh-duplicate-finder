import { readFileSync } from 'node:fs';
import { OnnxFacePipeline } from '@pohdf/core';
import { nodeSessionProvider } from '../../indexer/src/nodeSession.ts';

const pipeline = await OnnxFacePipeline.create(nodeSessionProvider, {
  detection: readFileSync('models/det_500m.onnx'),
  recognition: readFileSync('models/w600k_mbf.onnx'),
});
for (const photo of ['/tmp/probe-photo.bin', '/tmp/probe-photo2.bin']) {
  const res = await pipeline.embedFace(new Uint8Array(readFileSync(photo)));
  console.log(
    photo.split('/').pop(),
    res.ok
      ? `ok detScore=${res.detScore.toFixed(3)} faces=${res.faceCount} dims=${res.embedding.length} norm=${Math.hypot(...res.embedding).toFixed(4)}`
      : `FAIL ${res.code}: ${res.message}`,
  );
}
