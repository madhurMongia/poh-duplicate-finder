import { writeFileSync } from 'node:fs';
import { SubgraphClient, IpfsClient, fetchRegistrationPhoto } from '@pohdf/core';

const profile = process.argv[2];
const out = process.argv[3];
const sg = new SubgraphClient({
  mainnet: process.env.MAINNET_SUBGRAPH_URL!,
  gnosis: process.env.GNOSIS_SUBGRAPH_URL!,
});
const resolved = await sg.resolveProfile('mainnet', profile.toLowerCase());
if (!resolved) throw new Error('not resolved');
const { photoUri, bytes } = await fetchRegistrationPhoto(new IpfsClient(), resolved.evidenceUri);
writeFileSync(out, bytes);
console.log('saved', out, photoUri, bytes.length);
