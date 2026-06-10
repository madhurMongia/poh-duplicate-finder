import type { IpfsClient } from './ipfs.js';

/** Evidence JSON submitted with a claim request (mirrors v2-web types/docs.ts). */
export interface EvidenceFile {
  name?: string;
  description?: string;
  fileURI?: string;
}

/** Registration JSON the evidence points at. */
export interface RegistrationFile {
  name?: string;
  photo?: string;
  video?: string;
  bio?: string;
}

export interface RegistrationPhoto {
  photoUri: string;
  bytes: Uint8Array;
}

export type IpfsJsonApi = Pick<IpfsClient, 'fetchJson' | 'fetchBytes'>;

/**
 * Resolve a claim request's registration evidence to the photo itself:
 * evidence JSON -> fileURI -> registration JSON -> photo. Tolerates evidence
 * that embeds the registration fields directly.
 */
export async function resolveRegistrationPhotoUri(
  ipfs: IpfsJsonApi,
  evidenceUri: string,
): Promise<string> {
  const evidence = await ipfs.fetchJson<EvidenceFile & RegistrationFile>(evidenceUri);
  if (evidence.photo) return evidence.photo;
  if (!evidence.fileURI) {
    throw new Error(`registration evidence ${evidenceUri} has no fileURI/photo`);
  }
  const registration = await ipfs.fetchJson<RegistrationFile>(evidence.fileURI);
  if (!registration.photo) {
    throw new Error(`registration file ${evidence.fileURI} has no photo`);
  }
  return registration.photo;
}

export async function fetchRegistrationPhoto(
  ipfs: IpfsJsonApi,
  evidenceUri: string,
): Promise<RegistrationPhoto> {
  const photoUri = await resolveRegistrationPhotoUri(ipfs, evidenceUri);
  return { photoUri, bytes: await ipfs.fetchBytes(photoUri) };
}
