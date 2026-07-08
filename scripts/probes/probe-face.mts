import { readFileSync, writeFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import {
  SubgraphClient, IpfsClient, fetchRegistrationPhoto,
  JimpImageDecoder, letterbox, rgbaToChwFloat, decodeScrfdOutputs,
  SCRFD_500M_CONFIG, SCRFD_MEAN, SCRFD_STD,
} from '@pohdf/core';
import { nodeSessionProvider } from '../../indexer/src/nodeSession.ts';

const profile = process.argv[2] ?? '0x81d541fd64186699803ce67504432d42ce2c19d4';
const chain = (process.argv[3] ?? 'mainnet') as 'mainnet' | 'gnosis';

const sg = new SubgraphClient({
  mainnet: process.env.MAINNET_SUBGRAPH_URL!,
  gnosis: process.env.GNOSIS_SUBGRAPH_URL!,
});
const resolved = await sg.resolveProfile(chain, profile);
if (!resolved) throw new Error('profile not resolved');
console.log('resolved:', resolved.humanityId, 'evidence:', resolved.evidenceUri);

const ipfs = new IpfsClient();
const { photoUri, bytes } = await fetchRegistrationPhoto(ipfs, resolved.evidenceUri);
console.log('photoUri:', photoUri, 'bytes:', bytes.length,
  'magic:', Buffer.from(bytes.slice(0, 12)).toString('hex'));
writeFileSync('/tmp/probe-photo.bin', bytes);

const decoder = new JimpImageDecoder();
const image = await decoder.decode(bytes);
console.log('decoded:', image.width, 'x', image.height, 'rgba len:', image.data.length);

const session = await nodeSessionProvider(readFileSync('models/det_500m.onnx'));
const { image: boxed, scale } = letterbox(image, SCRFD_500M_CONFIG.inputSize);
const detInput = rgbaToChwFloat(boxed, SCRFD_MEAN, SCRFD_STD);
const size = SCRFD_500M_CONFIG.inputSize;
const out = await session.run({ [session.inputNames[0]]: { data: detInput, dims: [1, 3, size, size] } });
console.log('outputNames:', session.outputNames);
const ordered = session.outputNames.map((n) => out[n]);
for (const t of [0.5, 0.3, 0.1, 0.02]) {
  const faces = decodeScrfdOutputs(ordered, { ...SCRFD_500M_CONFIG, scoreThreshold: t }, scale);
  console.log(`threshold ${t}: ${faces.length} faces`, faces.slice(0, 3).map((f) => f.score.toFixed(3)));
}
