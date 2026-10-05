import { NextResponse } from 'next/server';
import { assertSafeUrl } from '@/lib/security/url';
import { runPsi } from '@/lib/pagespeed/client';
import { crawl, type CrawlFacts } from '@/lib/crawler/crawl';
import { renderPage, type RenderFacts } from '@/lib/crawler/render';
import { crawlerChecks, psiFindings } from '@/lib/audits/checks';
import { extraFindings } from '@/lib/audits/extra';
import { scoreAll } from '@/lib/scoring/score';
import { generateRecommendations, answerQuestion } from '@/lib/recommendations/engine';
import { cache } from '@/lib/cache/memory';

export const runtime = 'nodejs';
export const maxDuration = 300;
const hits = new Map<string, number[]>();

async function handle(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 5) return NextResponse.json({ error: 'Rate limit: max 5 audits per minute.' }, { status: 429 });
  hits.set(ip, [...recent, now]);

  let url: URL;
  let checkText = '';
  let question = '';
  try {
    const b = await req.json();
    url = await assertSafeUrl(String(b.url ?? ''));
    checkText = String(b.checkText ?? '').trim().slice(0, 120);
    question = String(b.question ?? '').trim().slice(0, 500);
  } catch (e: any) { return NextResponse.json({ error: e.message || 'Invalid request' }, { status: 400 }); }

  const ck = `audit:v3:${url.href}:${checkText}:${process.env.ENABLE_PLAYWRIGHT === 'true'}`;
  const cached = cache.get<any>(ck);
  if (question) {
    if (!cached) return NextResponse.json({ error: 'No cached report for this URL (only fully successful audits are kept for 30 minutes). Run the audit again.' }, { status: 404 });
    return NextResponse.json(await answerQuestion(question, cached));
  }
  if (cached) return NextResponse.json({ ...cached, cached: true });
  const t0 = Date.now(); console.log(`[audit] start ${url.href}`);
  let crawlErr: string | null = null;
  const [mobile, desktop, facts, render] = await Promise.all([
    runPsi(url.href, 'mobile'), runPsi(url.href, 'desktop'),
    crawl(url.href, checkText || undefined).catch((e: any) => { crawlErr = friendly(e); console.log(`[crawler] error ${e?.message}`); return null as CrawlFacts | null; }),
    renderPage(url.href, checkText || undefined).catch((e: any): RenderFacts => ({ ok: false, error: `Render failed: ${String(e?.message ?? e).split('\n')[0]}` })),
  ]);
  const findings = [...(facts ? crawlerChecks(facts) : []), ...extraFindings(facts, render), ...psiFindings(mobile, facts)];
  if (!facts) findings.push({ id: 'crawl-error', category: 'Performance', title: 'Website could not be fetched by crawler', status: 'ERROR', severity: 'critical', evidence: crawlErr ?? 'Unknown error', explanation: 'Crawler-based checks were skipped.', recommendation: '', source: 'crawler' });
  const summary = scoreAll(findings, mobile);
  const recommendations = await generateRecommendations(url.href, facts, mobile, desktop, findings, render);
  const result = { url: url.href, finalUrl: facts?.http.finalUrl ?? null, timestamp: new Date().toISOString(), pagespeed: { mobile, desktop }, crawler: facts ?? { error: crawlErr }, render, categories: summary.categories, issues: findings, recommendations, summary: { overall: summary.overall, severity: summary.severity, totalIssues: summary.totalIssues } };
  if (facts && mobile.ok && desktop.ok) cache.set(ck, result, 30 * 60_000);
  console.log(`[audit] done ${url.host} ${Date.now() - t0}ms psi=${mobile.ok}/${desktop.ok} crawler=${!!facts} render=${render.ok}`);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  try { return await handle(req); }
  catch (e: any) {
    console.log('[audit] fatal', e?.stack ?? e);
    return NextResponse.json({ error: `Server error: ${String(e?.message ?? e).split('\n')[0]}` }, { status: 500 });
  }
}

function friendly(e: any): string {
  const m = String(e?.message ?? e);
  if (e?.name === 'TimeoutError') return 'The website timed out (15s).';
  if (/redirect/i.test(m)) return m;
  if (/CERT|SSL|TLS/i.test(String(e?.cause?.code ?? m))) return 'SSL/TLS error while connecting.';
  return `Website unavailable: ${e?.cause?.code ?? m}`;
}
