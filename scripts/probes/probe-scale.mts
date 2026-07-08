import { readFileSync } from 'node:fs';
import {
  JimpImageDecoder, letterbox, rgbaToChwFloat, decodeScrfdOutputs, warpAffineBilinear,
  SCRFD_500M_CONFIG, SCRFD_MEAN, SCRFD_STD, type RgbaImage,
} from '@pohdf/core';
import { nodeSessionProvider } from '../../indexer/src/nodeSession.ts';

const bytes = new Uint8Array(readFileSync('/tmp/probe-photo.bin'));
const image = await new JimpImageDecoder().decode(bytes);
const session = await nodeSessionProvider(readFileSync('models/det_500m.onnx'));
const size = SCRFD_500M_CONFIG.inputSize;

async function detect(img: RgbaImage, swap = false, label = '') {
  const { image: boxed, scale } = letterbox(img, size);
  const data = boxed.data;
  if (swap) for (let i = 0; i < data.length; i += 4) { const t = data[i]; data[i] = data[i+2]; data[i+2] = t; }
  const input = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
  const out = await session.run({ [session.inputNames[0]]: { data: input, dims: [1, 3, size, size] } });
  const ordered = session.outputNames.map((n) => out[n]);
  const faces = decodeScrfdOutputs(ordered, { ...SCRFD_500M_CONFIG, scoreThreshold: 0.05 }, scale);
  console.log(label, '-> faces:', faces.length, 'top:', faces[0]?.score.toFixed(3) ?? 'none',
    faces[0] ? `box w=${(faces[0].box.x2 - faces[0].box.x1).toFixed(0)}` : '');
}

// downscale original by factor f into a smaller image (no padding tricks; just shrink)
function shrink(img: RgbaImage, f: number): RgbaImage {
  const w = Math.round(img.width * f), h = Math.round(img.height * f);
  return warpAffineBilinear(img, { a: 1 / f, b: 0, tx: 0, ty: 0 }, w, h);
}

await detect(image, false, 'full 720px, RGB ');
await detect(image, true,  'full 720px, BGR ');
for (const f of [0.5, 0.35, 0.25]) await detect(shrink(image, f), false, `shrunk x${f}, RGB`);
