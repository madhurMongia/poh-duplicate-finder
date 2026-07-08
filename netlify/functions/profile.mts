/**
 * Lightweight profile preview: resolves a pohId/address/profile-URL to
 * name + chain + registration photo via subgraph + IPFS JSON only.
 * No face index, no ONNX models — safe to call on every (debounced) keystroke.
 */
import {
  LookupError,
  parseProfileRef,
  resolveProfilePreview,
  type LookupErrorCode,
  type LookupErrorResponse,
} from '@pohdf/core';
import { getPreviewDeps, jsonResponse } from './lib/deps.mjs';

const STATUS_BY_CODE: Partial<Record<LookupErrorCode, number>> = {
  BAD_REQUEST: 400,
  PROFILE_NOT_FOUND: 404,
};

function errorBody(code: LookupErrorCode, message: string): LookupErrorResponse {
  return { ok: false, code, message };
}

export default async (req: Request): Promise<Response> => {
  const raw = new URL(req.url).searchParams.get('ref') ?? '';
  const ref = parseProfileRef(raw);
  if (!ref) {
    return jsonResponse(
      errorBody('BAD_REQUEST', "query param 'ref' must contain a pohId, address, or profile URL"),
      400,
    );
  }
  try {
    const profile = await resolveProfilePreview(getPreviewDeps(), ref);
    return jsonResponse({ ok: true, profile });
  } catch (err) {
    if (err instanceof LookupError) {
      return jsonResponse(errorBody(err.code, err.message), STATUS_BY_CODE[err.code] ?? 500);
    }
    console.error('profile: unexpected failure', err);
    return jsonResponse(errorBody('INTERNAL', 'unexpected error'), 500);
  }
};

export const config = { path: '/api/profile' };
