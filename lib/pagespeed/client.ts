import { cache } from '@/lib/cache/memory';
import type { PsiResult, Metric } from '@/types/audit';

const CATS = ['performance', 'accessibility', 'best-practices'];
const LIMITS: Record<string, [number, number]> = { lcp: [2500, 4000], cls: [0.1, 0.25], fcp: [1800, 3000], inp: [200, 500], ttfb: [800, 1800], tbt: [200, 600], si: [3400, 5800] };
const rate = (k: string, v: number | null | undefined): Metric['rating'] =>
  v == null ? 'unavailable' : v <= LIMITS[k][0] ? 'good' : v <= LIMITS[k][1] ? 'needs-improvement' : 'poor';
const mk = (k: string, v: number | null | undefined, unit: 'ms' | 'cls'): Metric =>
  v == null ? { value: null, display: 'Data unavailable', rating: 'unavailable' } : { value: v, display: unit === 'cls' ? v.toFixed(3) : `${(v / 1000).toFixed(2)} s`, rating: rate(k, v) };

const RUNS = Math.max(1, Math.min(5, Number(process.env.PSI_RUNS) || 3));

async function runPsiOnce(url: string, strategy: 'mobile' | 'desktop', run: number): Promise<PsiResult> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return { ok: false, error: 'PAGESPEED_API_KEY is not configured on the server.' };
  const ck = `psi:${strategy}:${url}:${CATS.join(',')}:v2:r${run}`;
  const hit = cache.get<PsiResult>(ck); if (hit) return hit;
  const p = new URLSearchParams({ url, strategy, key }); CATS.forEach((c) => p.append('category', c));
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`, { signal: AbortSignal.timeout(170_000) });
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

    // Exact culprits: concrete evidence for the AI (LCP element, heavy scripts, third parties, images, fonts, render-blocking)
    const det = (id: string): any[] => arr(A[id]?.details?.items);
    const short = (u: unknown) => String(u ?? '').slice(0, 140);
    const extra = {
      lcpElement: det('largest-contentful-paint-element').flatMap((t: any) => arr(t?.items)).filter((i: any) => i?.node).slice(0, 1).map((i: any) => ({ snippet: short(i.node.snippet), selector: short(i.node.selector) })),
      thirdParty: det('third-party-summary').slice(0, 12).map((i: any) => ({ entity: typeof i.entity === 'string' ? i.entity : i.entity?.text, blockingMs: Math.round(i.blockingTime ?? 0), transferKB: Math.round((i.transferSize ?? 0) / 1024) })),
      scripts: det('bootup-time').slice(0, 8).map((i: any) => ({ url: short(i.url), scriptingMs: Math.round(i.scripting ?? 0), totalMs: Math.round(i.total ?? 0) })),
      heavyRequests: det('network-requests').filter((i: any) => typeof i.transferSize === 'number').sort((a: any, b: any) => b.transferSize - a.transferSize).slice(0, 10).map((i: any) => ({ url: short(i.url), kb: Math.round(i.transferSize / 1024), type: i.resourceType })),
      imageIssues: ['uses-responsive-images', 'modern-image-formats', 'offscreen-images', 'uses-optimized-images'].flatMap((id) => det(id).slice(0, 6).map((i: any) => ({ audit: id, url: short(i.url), wastedKB: Math.round((i.wastedBytes ?? 0) / 1024) }))),
      fonts: det('font-display').slice(0, 6).map((i: any) => ({ url: short(i.url), wastedMs: Math.round(i.wastedMs ?? 0) })),
      renderBlocking: det('render-blocking-resources').slice(0, 8).map((i: any) => ({ url: short(i.url), wastedMs: Math.round(i.wastedMs ?? 0) })),
      unusedJs: det('unused-javascript').slice(0, 8).map((i: any) => ({ url: short(i.url), wastedKB: Math.round((i.wastedBytes ?? 0) / 1024) })),
      longTasks: det('long-tasks').slice(0, 8).map((i: any) => ({ url: short(i.url), durationMs: Math.round(i.duration ?? 0) })),
      layoutShifts: det('layout-shift-elements').slice(0, 5).map((i: any) => ({ snippet: short(i.node?.snippet), score: Number((i.score ?? 0).toFixed(3)) })),
      // Real-user (CrUX) data from the same PSI response. CLS percentile comes back multiplied by 100.
      field: {
        category: j.loadingExperience?.overall_category ?? null,
        originFallback: j.loadingExperience?.origin_fallback ?? false,
        lcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
        inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
      },
    };

    const out: PsiResult = { ok: true, scores, metrics, audits, extra, warnings: lh.runWarnings ?? [] };
    cache.set(ck, out); console.log(`[psi] ${strategy} run ${run} ok`); return out;
  } catch (e: any) {
    const detail = `${e?.name}: ${e?.message}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;
    console.log(`[psi] ${strategy} error ${detail}`);
    return { ok: false, error: e?.name === 'TimeoutError' ? 'PageSpeed request timed out.' : `PageSpeed request failed — ${detail}` };
  }
}

// Runs PSI RUNS times and returns the median run (by performance score) plus run-to-run variance info.
export async function runPsi(url: string, strategy: 'mobile' | 'desktop'): Promise<PsiResult> {
  const ck = `psi-med:${strategy}:${url}:${RUNS}:v1`;
  const hit = cache.get<PsiResult>(ck); if (hit) return hit;
  const all = await Promise.all(Array.from({ length: RUNS }, (_, i) => runPsiOnce(url, strategy, i)));
  const good = all.filter((r) => r.ok).sort((a, b) => (a.scores?.performance ?? 0) - (b.scores?.performance ?? 0));
  if (!good.length) return all[0];
  const med = good[Math.floor((good.length - 1) / 2)];
  const lcps = good.map((r) => r.metrics?.lcp.value).filter((v): v is number => v != null);
  const out: PsiResult = {
    ...med,
    extra: {
      ...med.extra,
      runs: {
        requested: RUNS, succeeded: good.length, perfScores: good.map((r) => r.scores?.performance ?? null),
        lcpMsMin: lcps.length ? Math.min(...lcps) : null, lcpMsMax: lcps.length ? Math.max(...lcps) : null,
      },
    },
  };
  console.log(`[psi] ${strategy} median of ${good.length}:`, out.extra!.runs);
  if (good.length === RUNS) cache.set(ck, out);
  return out;
}