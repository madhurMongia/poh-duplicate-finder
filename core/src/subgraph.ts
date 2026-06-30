import type { FetchFn } from './ipfs.js';
import type { ChainId, EntryStatus } from './types.js';

export interface RawClaimRequest {
  requestId: string;
  humanityId: string;
  creationTime: number;
  name?: string;
  /** URI of the first (registration) evidence, or null when not yet submitted. */
  evidenceUri: string | null;
}

export interface RawRequestStatus {
  requestId: string;
  statusId: string;
  winnerPartyId: string | null;
  requestExpirationTime: number | null;
  humanityHasRegistration: boolean;
  registrationExpirationTime: number | null;
}

export interface ResolvedProfile {
  humanityId: string;
  chain: ChainId;
  name?: string;
  evidenceUri: string | null;
}

export interface SubgraphApi {
  chains(): ChainId[];
  fetchClaimRequestsSince(chain: ChainId, sinceCreationTime: number): Promise<RawClaimRequest[]>;
  fetchStatusSnapshot(chain: ChainId): Promise<RawRequestStatus[]>;
  resolveProfile(chain: ChainId, ref: string): Promise<ResolvedProfile | null>;
}

export class SubgraphError extends Error {
  constructor(
    readonly chain: ChainId,
    message: string,
  ) {
    super(`subgraph(${chain}): ${message}`);
    this.name = 'SubgraphError';
  }
}

const CLAIM_REQUEST_FIELDS = `
  id
  index
  creationTime
  humanity { id }
  claimer { name }
  status { id }
  evidenceGroup { evidence(first: 1, orderBy: creationTime, orderDirection: asc) { uri } }
`;

interface GqlClaimRequest {
  id: string;
  index: string;
  creationTime: string;
  humanity: { id: string };
  claimer: { name: string | null } | null;
  status: { id: string };
  evidenceGroup: { evidence: { uri: string }[] };
}

interface GqlStatusRequest {
  id: string;
  status: { id: string };
  winnerParty: { id: string } | null;
  expirationTime: string | null;
  humanity: { id: string; registration: { expirationTime: string } | null };
}

export class SubgraphClient implements SubgraphApi {
  constructor(
    private readonly endpoints: Partial<Record<ChainId, string>>,
    private readonly fetchFn: FetchFn = fetch,
    private readonly pageSize = 1000,
  ) {}

  chains(): ChainId[] {
    return Object.keys(this.endpoints) as ChainId[];
  }

  private async query<T>(
    chain: ChainId,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const endpoint = this.endpoints[chain];
    if (!endpoint) throw new SubgraphError(chain, 'no endpoint configured');
    const res = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new SubgraphError(chain, `HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) {
      throw new SubgraphError(chain, body.errors.map((e) => e.message).join('; '));
    }
    if (!body.data) throw new SubgraphError(chain, 'empty response');
    return body.data;
  }

  /**
   * All claim (non-revocation) requests created after the checkpoint, oldest
   * first. Pagination advances a creationTime cursor; callers dedupe by
   * requestId, which also covers requests sharing a boundary timestamp.
   */
  async fetchClaimRequestsSince(
    chain: ChainId,
    sinceCreationTime: number,
  ): Promise<RawClaimRequest[]> {
    const out: RawClaimRequest[] = [];
    const seen = new Set<string>();
    let cursor = sinceCreationTime;
    for (;;) {
      const data = await this.query<{ requests: GqlClaimRequest[] }>(
        chain,
        `query ($since: BigInt!, $first: Int!) {
          requests(
            where: { revocation: false, creationTime_gt: $since }
            orderBy: creationTime
            orderDirection: asc
            first: $first
          ) { ${CLAIM_REQUEST_FIELDS} }
        }`,
        { since: String(cursor), first: this.pageSize },
      );
      const page = data.requests;
      for (const req of page) {
        if (isLegacyMainnetRequest(chain, req)) continue;
        if (seen.has(req.id)) continue;
        seen.add(req.id);
        const evidence = await this.resolveRequestEvidence(chain, req);
        out.push({
          requestId: req.id,
          humanityId: req.humanity.id.toLowerCase(),
          creationTime: Number(req.creationTime),
          name: req.claimer?.name ?? evidence.name ?? undefined,
          evidenceUri: evidence.uri,
        });
      }
      if (page.length < this.pageSize) return out;
      cursor = Number(page[page.length - 1].creationTime);
    }
  }

  /** Status fields for every claim request on the chain; paginated by id. */
  async fetchStatusSnapshot(chain: ChainId): Promise<RawRequestStatus[]> {
    const out: RawRequestStatus[] = [];
    let cursor = '';
    for (;;) {
      const data = await this.query<{ requests: GqlStatusRequest[] }>(
        chain,
        `query ($cursor: Bytes!, $first: Int!) {
          requests(
            where: { revocation: false, id_gt: $cursor }
            orderBy: id
            orderDirection: asc
            first: $first
          ) {
            id
            status { id }
            winnerParty { id }
            expirationTime
            humanity { id registration { expirationTime } }
          }
        }`,
        { cursor: cursor || '0x00', first: this.pageSize },
      );
      const page = data.requests;
      for (const req of page) {
        out.push({
          requestId: req.id,
          statusId: req.status.id,
          winnerPartyId: req.winnerParty?.id ?? null,
          requestExpirationTime: req.expirationTime ? Number(req.expirationTime) : null,
          humanityHasRegistration: req.humanity.registration !== null,
          registrationExpirationTime: req.humanity.registration
            ? Number(req.humanity.registration.expirationTime)
            : null,
        });
      }
      if (page.length < this.pageSize) return out;
      cursor = page[page.length - 1].id;
    }
  }

  /** Resolve a humanity id or claimer address to its latest claim request evidence. */
  async resolveProfile(chain: ChainId, ref: string): Promise<ResolvedProfile | null> {
    const id = ref.toLowerCase();
    const byHumanity = await this.resolveHumanity(chain, id);
    if (byHumanity) return byHumanity;

    const data = await this.query<{
      claimer: {
        registration: { humanity: { id: string } } | null;
        currentRequest: { humanity: { id: string } } | null;
      } | null;
    }>(
      chain,
      `query ($id: ID!) {
        claimer(id: $id) {
          registration { humanity { id } }
          currentRequest { humanity { id } }
        }
      }`,
      { id },
    );
    const humanityId =
      data.claimer?.registration?.humanity.id ?? data.claimer?.currentRequest?.humanity.id;
    return humanityId ? this.resolveHumanity(chain, humanityId.toLowerCase()) : null;
  }

  private async resolveHumanity(chain: ChainId, id: string): Promise<ResolvedProfile | null> {
    const data = await this.query<{
      humanity: {
        id: string;
        claimerName: string | null;
        requests: GqlClaimRequest[];
      } | null;
    }>(
      chain,
      `query ($id: ID!) {
        humanity(id: $id) {
          id
          claimerName
          requests(
            where: { revocation: false }
            orderBy: creationTime
            orderDirection: desc
            first: 5
          ) { ${CLAIM_REQUEST_FIELDS} }
        }
      }`,
      { id },
    );
    const latest = data.humanity?.requests.find((req) => !isLegacyMainnetRequest(chain, req));
    if (!data.humanity || !latest) return null;
    const evidence = await this.resolveRequestEvidence(chain, latest);
    return {
      humanityId: data.humanity.id.toLowerCase(),
      chain,
      name: data.humanity.claimerName ?? latest.claimer?.name ?? evidence.name ?? undefined,
      evidenceUri: evidence.uri,
    };
  }

  private async resolveRequestEvidence(
    chain: ChainId,
    req: GqlClaimRequest,
  ): Promise<{ uri: string | null; name?: string }> {
    const direct = req.evidenceGroup.evidence[0]?.uri ?? null;
    if (direct || !isTransferArtifactRequest(req)) return { uri: direct };

    const source = await this.resolveTransferSourceRequest(chain, req);
    return {
      uri: source?.evidenceGroup.evidence[0]?.uri ?? null,
      name: source?.claimer?.name ?? undefined,
    };
  }

  private async resolveTransferSourceRequest(
    chain: ChainId,
    req: GqlClaimRequest,
  ): Promise<GqlClaimRequest | null> {
    const foreign = foreignChain(chain);
    if (!this.endpoints[foreign]) return null;

    const data = await this.query<{
      humanity: { requests: GqlClaimRequest[] } | null;
    }>(
      foreign,
      `query ($id: ID!) {
        humanity(id: $id) {
          requests(
            where: { revocation: false }
            orderBy: creationTime
            orderDirection: asc
          ) { ${CLAIM_REQUEST_FIELDS} }
        }
      }`,
      { id: req.humanity.id },
    );

    const withEvidence =
      data.humanity?.requests.filter((request) => request.evidenceGroup.evidence[0]?.uri) ?? [];
    const transferred = withEvidence.filter(
      (request) => request.status.id === 'transferred' || request.status.id === 'transferring',
    );
    if (transferred.length > 0) {
      const transferNumber = Math.max(0, -100 - Number(req.index));
      return transferred[Math.min(transferNumber, transferred.length - 1)] ?? null;
    }
    return withEvidence.at(-1) ?? null;
  }
}

function isLegacyMainnetRequest(chain: ChainId, req: GqlClaimRequest): boolean {
  const index = Number(req.index);
  return chain === 'mainnet' && index < 0 && !isTransferArtifactRequest(req);
}

function isTransferArtifactRequest(req: GqlClaimRequest): boolean {
  return Number(req.index) <= -100;
}

function foreignChain(chain: ChainId): ChainId {
  return chain === 'gnosis' ? 'mainnet' : 'gnosis';
}

/**
 * Map raw subgraph status fields to an index entry status.
 * Heuristic by design (documented in the spec): an accepted request whose
 * humanity no longer has a live registration is "expired" once past its own
 * expiration time, otherwise "revoked".
 */
export function deriveStatus(raw: RawRequestStatus, now: number): EntryStatus {
  switch (raw.statusId) {
    case 'withdrawn':
      return 'withdrawn';
    case 'vouching':
    case 'resolving':
    case 'disputed':
      return 'pending';
    case 'resolved': {
      if (raw.winnerPartyId === 'challenger') return 'rejected';
      if (raw.humanityHasRegistration) {
        return (raw.registrationExpirationTime ?? 0) > now ? 'registered' : 'expired';
      }
      if (raw.requestExpirationTime !== null && raw.requestExpirationTime < now) return 'expired';
      return 'revoked';
    }
    default:
      return 'unknown';
  }
}
