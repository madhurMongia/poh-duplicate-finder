import { readFileSync } from 'node:fs';
import { Jimp } from 'jimp';
import { JimpImageDecoder, letterbox, SCRFD_500M_CONFIG } from '@pohdf/core';

const bytes = readFileSync('/tmp/probe-photo.bin');
const decoder = new JimpImageDecoder();
const image = await decoder.decode(new Uint8Array(bytes));
const { image: boxed, scale } = letterbox(image, SCRFD_500M_CONFIG.inputSize);
console.log('scale:', scale, 'boxed:', boxed.width, 'x', boxed.height);
// sample some pixels
const px = (x: number, y: number) => {
  const i = (y * boxed.width + x) * 4;
  return [boxed.data[i], boxed.data[i+1], boxed.data[i+2], boxed.data[i+3]];
};
console.log('px(0,0):', px(0,0), 'px(320,320):', px(320,320), 'px(639,0):', px(639,0), 'px(0,639):', px(0,639));
const jimg = Jimp.fromBitmap({ width: boxed.width, height: boxed.height, data: Buffer.from(boxed.data) });
await jimg.write('/tmp/probe-letterbox.png');
console.log('wrote /tmp/probe-letterbox.png');
