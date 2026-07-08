import {
  LookupError,
  parseProfileRef,
  performLookup,
  type LookupErrorCode,
  type LookupErrorResponse,
  type LookupInput,
} from '@pohdf/core';
import { getLookupDeps, jsonResponse } from './lib/deps.mjs';

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);

const STATUS_BY_CODE: Record<LookupErrorCode, number> = {
  BAD_REQUEST: 400,
  NO_FACE: 422,
  DECODE_FAILED: 422,
  PROFILE_NOT_FOUND: 404,
  PHOTO_FETCH_FAILED: 502,
  INDEX_UNAVAILABLE: 503,
  INTERNAL: 500,
};

async function parseLookupInput(req: Request): Promise<LookupInput> {
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File)) {
      throw new LookupError('BAD_REQUEST', "multipart field 'photo' is required");
    }
    if (!ACCEPTED_PHOTO_TYPES.has(photo.type)) {
      throw new LookupError('BAD_REQUEST', 'photo must be a JPEG or PNG');
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      throw new LookupError('BAD_REQUEST', 'photo must be 6 MB or smaller');
    }
    return { kind: 'photo', bytes: new Uint8Array(await photo.arrayBuffer()) };
  }

  const body = (await req.json().catch(() => {
    throw new LookupError('BAD_REQUEST', 'body must be multipart/form-data or JSON');
  })) as { profile?: unknown };
  const ref = typeof body.profile === 'string' ? parseProfileRef(body.profile) : null;
  if (!ref) {
    throw new LookupError(
      'BAD_REQUEST',
      "JSON body must include 'profile': a pohId, address, or profile URL",
    );
  }
  return { kind: 'profile', ref };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(errorBody('BAD_REQUEST', 'use POST'), 405);
  }
  try {
    const input = await parseLookupInput(req);
    const deps = await getLookupDeps();
    return jsonResponse(await performLookup(deps, input));
  } catch (err) {
    if (err instanceof LookupError) {
      return jsonResponse(errorBody(err.code, err.message), STATUS_BY_CODE[err.code]);
    }
    console.error('lookup: unexpected failure', err);
    return jsonResponse(errorBody('INTERNAL', 'unexpected error'), 500);
  }
};

function errorBody(code: LookupErrorCode, message: string): LookupErrorResponse {
  return { ok: false, code, message };
}

export const config = { path: '/api/lookup' };
