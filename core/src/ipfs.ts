export type FetchFn = typeof fetch;

export const DEFAULT_IPFS_GATEWAYS = [
  'https://cdn.kleros.link',
  'https://ipfs.io',
  'https://cloudflare-ipfs.com',
];

export interface IpfsClientOptions {
  gateways?: string[];
  timeoutMs?: number;
  fetchFn?: FetchFn;
}

export class IpfsFetchError extends Error {
  constructor(
    readonly path: string,
    readonly attempts: string[],
  ) {
    super(`IPFS fetch failed for ${path}: ${attempts.join('; ')}`);
    this.name = 'IpfsFetchError';
  }
}

/** Normalize "ipfs://…", "Qm…" or "/ipfs/…" forms to a "/ipfs/…" path. */
export function normalizeIpfsPath(uri: string): string {
  let path = uri.trim();
  if (path.startsWith('ipfs://')) path = `/ipfs/${path.slice('ipfs://'.length)}`;
  if (!path.startsWith('/')) path = `/ipfs/${path}`;
  if (!path.startsWith('/ipfs/')) throw new Error(`unsupported IPFS uri: ${uri}`);
  return path;
}

export class IpfsClient {
  private readonly gateways: string[];
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;

  constructor(options: IpfsClientOptions = {}) {
    this.gateways = options.gateways ?? DEFAULT_IPFS_GATEWAYS;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  url(uri: string, gateway: string = this.gateways[0]): string {
    return `${gateway}${normalizeIpfsPath(uri)}`;
  }

  async fetchBytes(uri: string): Promise<Uint8Array> {
    const path = normalizeIpfsPath(uri);
    const attempts: string[] = [];
    for (const gateway of this.gateways) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchFn(`${gateway}${path}`, { signal: controller.signal });
        if (!res.ok) {
          attempts.push(`${gateway}: HTTP ${res.status}`);
          continue;
        }
        return new Uint8Array(await res.arrayBuffer());
      } catch (err) {
        attempts.push(`${gateway}: ${String(err)}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new IpfsFetchError(path, attempts);
  }

  async fetchJson<T>(uri: string): Promise<T> {
    const bytes = await this.fetchBytes(uri);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
}
