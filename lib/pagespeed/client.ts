import { cache } from '@/lib/cache/memory';
import type { PsiResult, Metric } from '@/types/audit';

const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];
const LIMITS: Record<string, [number, number]> = { lcp: [2500, 4000], cls: [0.1, 0.25], fcp: [1800, 3000], inp: [200, 500], ttfb: [800, 1800], tbt: [200, 600], si: [3400, 5800] };
const rate = (k: string, v: number | null | undefined): Metric['rating'] =>
  v == null ? 'unavailable' : v <= LIMITS[k][0] ? 'good' : v <= LIMITS[k][1] ? 'needs-improvement' : 'poor';
const mk = (k: string, v: number | null | undefined, unit: 'ms' | 'cls'): Metric =>
  v == null ? { value: null, display: 'Data unavailable', rating: 'unavailable' } : { value: v, display: unit === 'cls' ? v.toFixed(3) : `${(v / 1000).toFixed(2)} s`, rating: rate(k, v) };

export async function runPsi(url: string, strategy: 'mobile' | 'desktop'): Promise<PsiResult> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return { ok: false, error: 'PAGESPEED_API_KEY is not configured on the server.' };
  const ck = `psi:${strategy}:${url}:${CATS.join(',')}`;
  const hit = cache.get<PsiResult>(ck); if (hit) return hit;
  const p = new URLSearchParams({ url, strategy, key }); CATS.forEach((c) => p.append('category', c));
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`, { signal: AbortSignal.timeout(100_000) });
    if (!res.ok) {
      const msg = res.status === 429 ? 'PageSpeed API quota exceeded. Try again later.' : res.status === 400 ? 'PageSpeed could not analyze this URL (unreachable or invalid).' : `PageSpeed API error (HTTP ${res.status}).`;
      console.log(`[psi] ${strategy} failed status=${res.status}`); return { ok: false, error: msg };
    }
    const j = await res.json(); const lh = j.lighthouseResult;
    if (!lh) return { ok: false, error: 'PageSpeed returned no Lighthouse result.' };
    if (lh.runtimeError) return { ok: false, error: `Lighthouse runtime error: ${lh.runtimeError.message ?? lh.runtimeError.code}` };
    const A = lh.audits ?? {}, field = j.loadingExperience?.metrics ?? {};
    const scores: Record<string, number | null> = {};
    const catOf: Record<string, string> = {};
    for (const [id, c] of Object.entries<any>(lh.categories ?? {})) { scores[id] = c.score == null ? null : Math.round(c.score * 100); (c.auditRefs ?? []).forEach((r: any) => { if (!catOf[r.id]) catOf[r.id] = id; }); }
    const inp = field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null;
    const ttfb = A['server-response-time']?.numericValue ?? field.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null;
    const metrics: Record<string, Metric> = {
      lcp: mk('lcp', A['largest-contentful-paint']?.numericValue, 'ms'), inp: mk('inp', inp, 'ms'), cls: mk('cls', A['cumulative-layout-shift']?.numericValue, 'cls'),
      fcp: mk('fcp', A['first-contentful-paint']?.numericValue, 'ms'), ttfb: mk('ttfb', ttfb, 'ms'), tbt: mk('tbt', A['total-blocking-time']?.numericValue, 'ms'), si: mk('si', A['speed-index']?.numericValue, 'ms'),
    };
    if (metrics.inp.value != null) metrics.inp.display = `${Math.round(metrics.inp.value)} ms`;

    const arr = (x: any): any[] => (Array.isArray(x) ? x : []);
    const audits = Object.values<any>(A).filter((a) => a && catOf[a.id]).map((a) => {
      const rows = arr(a.details?.items);
      return {
        id: a.id, title: String(a.title ?? ''), description: String(a.description ?? '').replace(/\s*\[Learn[\s\S]*$/, ''),
        score: a.score ?? null, mode: String(a.scoreDisplayMode ?? ''), displayValue: a.displayValue, numericValue: a.numericValue,
        itemCount: rows.length,
        items: rows.slice(0, 5).map((it: any) => {
          if (!it || typeof it !== 'object') return '';
          const name = it.url ?? it.source ?? it.node?.snippet ?? it.label ?? it.groupLabel ?? '';
          return [typeof name === 'string' ? name.slice(0, 120) : '', typeof it.wastedBytes === 'number' ? `${Math.round(it.wastedBytes / 1024)} KB wasted` : '', typeof it.wastedMs === 'number' ? `${Math.round(it.wastedMs)} ms wasted` : '', typeof it.totalBytes === 'number' ? `${Math.round(it.totalBytes / 1024)} KB total` : ''].filter(Boolean).join(' | ');
        }).filter(Boolean),
        category: catOf[a.id],
      };
    });

    const out: PsiResult = { ok: true, scores, metrics, audits, warnings: lh.runWarnings ?? [] };
    cache.set(ck, out); console.log(`[psi] ${strategy} ok`); return out;
  } catch (e: any) {
    const detail = `${e?.name}: ${e?.message}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;
    console.log(`[psi] ${strategy} error ${detail}`);
    return { ok: false, error: e?.name === 'TimeoutError' ? 'PageSpeed request timed out.' : `PageSpeed request failed — ${detail}` };
  }
}