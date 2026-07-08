import { readFileSync } from 'node:fs';
import {
  JimpImageDecoder, letterbox, rgbaToChwFloat, decodeScrfdOutputs,
  SCRFD_500M_CONFIG, SCRFD_MEAN, SCRFD_STD,
} from '@pohdf/core';
import { nodeSessionProvider } from '../../indexer/src/nodeSession.ts';

const modelPath = process.argv[2];
const session = await nodeSessionProvider(readFileSync(modelPath));
const size = SCRFD_500M_CONFIG.inputSize;
for (const photo of process.argv.slice(3)) {
  const image = await new JimpImageDecoder().decode(new Uint8Array(readFileSync(photo)));
  const { image: boxed, scale } = letterbox(image, size);
  const input = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
  const out = await session.run({ [session.inputNames[0]]: { data: input, dims: [1, 3, size, size] } });
  const ordered = session.outputNames.map((n) => out[n]);
  const faces = decodeScrfdOutputs(ordered, { ...SCRFD_500M_CONFIG, scoreThreshold: 0.05 }, scale);
  console.log(`${modelPath} :: ${photo} -> faces=${faces.length} top=${faces[0]?.score.toFixed(3) ?? 'none'}`);
}
