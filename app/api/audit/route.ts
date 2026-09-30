import { NextResponse } from 'next/server';
import { assertSafeUrl } from '@/lib/security/url';
import { runPsi } from '@/lib/pagespeed/client';
import { crawl, type CrawlFacts } from '@/lib/crawler/crawl';
import { crawlerChecks, psiFindings } from '@/lib/audits/checks';
import { scoreAll } from '@/lib/scoring/score';
import { generateRecommendations } from '@/lib/recommendations/engine';
import { cache } from '@/lib/cache/memory';

export const runtime = 'nodejs';
export const maxDuration = 300;
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) return NextResponse.json({ error: 'Rate limit: max 5 audits per minute.' }, { status: 429 });
  hits.set(ip, [...recent, now]);

  let url: URL;
  try { const b = await req.json(); url = await assertSafeUrl(String(b.url ?? '')); }
  catch (e: any) { return NextResponse.json({ error: e.message || 'Invalid request' }, { status: 400 }); }

  const cached = cache.get<any>(`audit:${url.href}`); if (cached) return NextResponse.json({ ...cached, cached: true });
  const t0 = Date.now(); console.log(`[audit] start ${url.href}`);
  let crawlErr: string | null = null;
  const [mobile, desktop, facts] = await Promise.all([
    runPsi(url.href, 'mobile'), runPsi(url.href, 'desktop'),
    crawl(url.href).catch((e: any) => { crawlErr = friendly(e); console.log(`[crawler] error ${e?.message}`); return null as CrawlFacts | null; }),
  ]);
  const findings = [...(facts ? crawlerChecks(facts) : []), ...psiFindings(mobile, facts)];
  if (!facts) findings.push({ id: 'crawl-error', category: 'Technical SEO', title: 'Website could not be fetched by crawler', status: 'ERROR', severity: 'critical', evidence: crawlErr ?? 'Unknown error', explanation: 'Crawler-based checks were skipped.', recommendation: '', source: 'crawler' });
  const summary = scoreAll(findings, mobile);
  const recommendations = await generateRecommendations(url.href, facts, mobile, desktop, findings);
  const result = { url: url.href, finalUrl: facts?.http.finalUrl ?? null, timestamp: new Date().toISOString(), pagespeed: { mobile, desktop }, crawler: facts ?? { error: crawlErr }, categories: summary.categories, issues: findings, recommendations, summary: { overall: summary.overall, severity: summary.severity, totalIssues: summary.totalIssues } };
  if (facts && mobile.ok && desktop.ok) cache.set(`audit:${url.href}`, result, 30 * 60_000);
  console.log(`[audit] done ${url.host} ${Date.now() - t0}ms psi=${mobile.ok}/${desktop.ok} crawler=${!!facts}`);
  return NextResponse.json(result);
}

function friendly(e: any): string {
  const m = String(e?.message ?? e);
  if (e?.name === 'TimeoutError') return 'The website timed out (15s).';
  if (/redirect/i.test(m)) return m;
  if (/CERT|SSL|TLS/i.test(String(e?.cause?.code ?? m))) return 'SSL/TLS error while connecting.';
  return `Website unavailable: ${e?.cause?.code ?? m}`;
}
