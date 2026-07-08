import { readFileSync } from 'node:fs';
import {
  JimpImageDecoder, letterbox, rgbaToChwFloat,
  SCRFD_500M_CONFIG, SCRFD_MEAN, SCRFD_STD,
} from '@pohdf/core';
import { nodeSessionProvider } from '../../indexer/src/nodeSession.ts';

const bytes = new Uint8Array(readFileSync('/tmp/probe-photo.bin'));
const image = await new JimpImageDecoder().decode(bytes);
const session = await nodeSessionProvider(readFileSync('models/det_500m.onnx'));
const size = SCRFD_500M_CONFIG.inputSize;
const { image: boxed } = letterbox(image, size);
const input = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
const out = await session.run({ [session.inputNames[0]]: { data: input, dims: [1, 3, size, size] } });
console.log('input name:', session.inputNames[0]);
for (const name of session.outputNames) {
  const t = out[name];
  const d = t.data as Float32Array;
  let min = Infinity, max = -Infinity, neg = 0;
  for (const v of d) { if (v < min) min = v; if (v > max) max = v; if (v < 0) neg++; }
  console.log(`out ${name}: len=${d.length} dims=${JSON.stringify(t.dims)} min=${min.toFixed(3)} max=${max.toFixed(3)} neg=${neg}`);
}
