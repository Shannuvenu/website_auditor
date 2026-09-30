import { assertSafeUrl } from '@/lib/security/url';

export interface FetchResult { finalUrl: string; status: number; headers: Record<string, string>; body: string; chain: { url: string; status: number }[]; ms: number; truncated: boolean }

// Manual redirect following so every hop is SSRF-validated. Timeout, redirect and size limits enforced.
export async function safeFetch(url: string, opts: { method?: 'GET' | 'HEAD'; maxBytes?: number } = {}): Promise<FetchResult> {
  const method = opts.method ?? 'GET', maxBytes = opts.maxBytes ?? 3_000_000;
  const chain: { url: string; status: number }[] = [];
  const t0 = Date.now();
  let cur = url;
  for (let i = 0; i <= 8; i++) {
    const u = await assertSafeUrl(cur);
    const res = await fetch(u, { method, redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'WebsiteAuditBot/1.0', accept: 'text/html,*/*' } });
    chain.push({ url: cur, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).toString(); continue; }
    let body = '', truncated = false;
    if (method === 'GET' && res.body) {
      const reader = res.body.getReader(), dec = new TextDecoder(); let n = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; body += dec.decode(value, { stream: true }); if (n > maxBytes) { truncated = true; await reader.cancel(); break; } }
    }
    return { finalUrl: cur, status: res.status, headers: Object.fromEntries(res.headers), body, chain, ms: Date.now() - t0, truncated };
  }
  throw new Error('Too many redirects (possible redirect loop)');
}
