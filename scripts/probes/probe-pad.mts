import { readFileSync } from 'node:fs';
import {
  JimpImageDecoder, letterbox, rgbaToChwFloat, decodeScrfdOutputs,
  SCRFD_500M_CONFIG, SCRFD_MEAN, SCRFD_STD, type RgbaImage,
} from '@pohdf/core';
import { nodeSessionProvider } from '../../indexer/src/nodeSession.ts';

function pad(img: RgbaImage, factor: number): RgbaImage {
  const w = Math.round(img.width * factor), h = Math.round(img.height * factor);
  const ox = Math.floor((w - img.width) / 2), oy = Math.floor((h - img.height) / 2);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < img.height; y++)
    data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + oy) * w + ox) * 4);
  return { width: w, height: h, data };
}

const session = await nodeSessionProvider(readFileSync(process.argv[2]));
const size = SCRFD_500M_CONFIG.inputSize;
for (const photo of ['/tmp/probe-photo.bin', '/tmp/probe-photo2.bin']) {
  const image = await new JimpImageDecoder().decode(new Uint8Array(readFileSync(photo)));
  for (const f of [1, 1.5, 2, 3]) {
    const padded = pad(image, f);
    const { image: boxed, scale } = letterbox(padded, size);
    const input = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
    const out = await session.run({ [session.inputNames[0]]: { data: input, dims: [1, 3, size, size] } });
    const ordered = session.outputNames.map((n) => out[n]);
    const faces = decodeScrfdOutputs(ordered, { ...SCRFD_500M_CONFIG, scoreThreshold: 0.05 }, scale);
    console.log(`${photo.split('/').pop()} pad x${f}: top=${faces[0]?.score.toFixed(3) ?? 'none'} n=${faces.length}`);
  }
}
