import { gunzipSync } from 'node:zlib';
import { normalizeUrl } from './urls';
import type { Brand } from '@/lib/validation/schemas';

export interface HttpResponse {
  status: number;
  location: string | null;
  body: string;
}

/** One GET without following redirects. Injected so tests never touch the network. */
export type HttpGet = (url: string) => Promise<HttpResponse>;

export function createHttpGet(options: { userAgent: string; timeoutMs?: number; maxBytes?: number }): HttpGet {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 5_000_000;
  return async (url) => {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': options.userAgent, accept: 'text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 1 && buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer);
    return { status: res.status, location: res.headers.get('location'), body: buffer.subarray(0, maxBytes).toString('utf8') };
  };
}

export interface FollowResult {
  ok: boolean;
  /** Final URL after allowed redirects. */
  finalUrl: string;
  status: number;
  body: string;
  problem?: string;
}

/**
 * Follows up to `maxHops` redirects, but only to URLs that pass the brand host rules. A redirect to any other
 * host is reported, never followed.
 */
export async function getFollowing(get: HttpGet, url: string, brand: Brand, maxHops = 3): Promise<FollowResult> {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    let res: HttpResponse;
    try {
      res = await get(current);
    } catch (error) {
      return { ok: false, finalUrl: current, status: 0, body: '', problem: `fetch failed (${error instanceof Error ? error.name : 'error'})` };
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      let next: string;
      try {
        next = new URL(res.location, current).toString();
      } catch {
        return { ok: false, finalUrl: current, status: res.status, body: '', problem: 'invalid redirect target' };
      }
      const check = normalizeUrl(next, brand);
      if (!check.ok) return { ok: false, finalUrl: next, status: res.status, body: '', problem: `redirect not followed: ${check.reason}` };
      current = check.url;
      continue;
    }
    return { ok: res.status === 200, finalUrl: current, status: res.status, body: res.body, ...(res.status === 200 ? {} : { problem: `HTTP ${res.status}` }) };
  }
  return { ok: false, finalUrl: current, status: 0, body: '', problem: 'too many redirects' };
}
