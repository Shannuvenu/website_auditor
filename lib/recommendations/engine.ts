import { getProvider } from '@/lib/ai/provider';
import { CARDS } from '@/lib/scoring/score';
import type { CrawlFacts } from '@/lib/crawler/crawl';
import type { RenderFacts } from '@/lib/crawler/render';
import type { Finding, PsiResult } from '@/types/audit';
import type { Recommendations, TopIssue } from '@/types/recommendations';

const SYSTEM = `You are a website audit analyst. You receive VERIFIED evidence as JSON. Reason ONLY over that evidence.
Task: choose up to 5 of the most impactful issues from "candidates" (never from anywhere else). Rank by real impact on users, Core Web Vitals, security and indexability, using the evidence. If fewer than 5 genuine issues exist, return fewer. Do not pad.
For each issue give: "title" (short), "findingIds" (1-3 ids that appear in candidates), "whyItMatters" (1-2 sentences grounded in the evidence), "fixSteps" (2-4 specific, technically realistic steps; name exact files/URLs/scripts from the evidence when present).
Rules: never invent metrics, URLs, scripts or HTML elements; never recommend without evidence; do not predict score improvements or ranking gains; never label a script as an ad script or tracker unless its host or name in the evidence clearly says so.
The "render" block is from an unthrottled headless browser: its timings show ordering only and must not be compared with Lighthouse numbers. render.sessionLike is a URL-pattern heuristic, not proof.
"summary": at most 2 sentences stating measured facts only.
Return STRICT JSON only, no markdown, exactly this shape:
{"summary":string,"topIssues":[{"title":string,"findingIds":string[],"whyItMatters":string,"fixSteps":string[]}]}`;

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);

export async function generateRecommendations(url: string, crawl: CrawlFacts | null, mobile: PsiResult, desktop: PsiResult, findings: Finding[], render: RenderFacts | null = null): Promise<Recommendations> {
  const llm = getProvider();
  if (!llm) return { available: false, reason: 'No AI provider configured. Showing verified findings only.' };
  const cand = findings
    .filter((f) => CARDS.includes(f.category) && (f.status === 'FAIL' || f.status === 'WARNING') && ['critical', 'high', 'medium'].includes(f.severity))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 40);
  if (!cand.length) return { available: true, summary: 'No failing or warning checks were found in the reported categories.', topIssues: [] };
  const byId = new Map(cand.map((f) => [f.id, f]));
  const evidence = {
    url, crawler: crawl ? { ...crawl, http: { ...crawl.http, headers: undefined }, images: { ...crawl.images, sample: undefined } } : 'unavailable',
    render: render?.ok ? { words: render.words, checkTextFoundMs: render.checkTextFoundMs, totalRequests: render.totalRequests, adLikeHosts: render.adLikeHosts, gtmRequests: render.gtmRequests, sessionLike: render.sessionLike, thirdPartyHosts: render.thirdPartyHosts } : null,
    pagespeed: { mobile: mobile.ok ? { scores: mobile.scores, metrics: mobile.metrics, extra: mobile.extra } : { error: mobile.error }, desktop: desktop.ok ? { scores: desktop.scores } : { error: desktop.error } },
    candidates: cand.map(({ id, category, title, status, severity, evidence }) => ({ id, category, title, status, severity, evidence })),
  };
  let lastErr = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await llm.complete(SYSTEM, `VERIFIED EVIDENCE:\n${JSON.stringify(evidence)}`);
      const p = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
      const parsed = (Array.isArray(p.topIssues) ? p.topIssues : []).map((i: any) => {
        const ids = [...new Set(arr(i?.findingIds).filter((id) => byId.has(id)))].slice(0, 3);
        return {
          title: String(i?.title ?? '').slice(0, 160), findingIds: ids, whyItMatters: String(i?.whyItMatters ?? '').slice(0, 400), fixSteps: arr(i?.fixSteps).slice(0, 5),
          evidence: ids.map((id) => ({ id, title: byId.get(id)!.title, text: byId.get(id)!.evidence })), // evidence always comes from verified findings, never from the AI
        };
      }).filter((i: any) => i.title && i.findingIds.length > 0 && i.fixSteps.length > 0);
      const used = new Set<string>(); const out: TopIssue[] = [];
      for (const i of parsed) {
        if (i.findingIds.every((id: string) => used.has(id))) continue;
        i.findingIds.forEach((id: string) => used.add(id));
        out.push({ rank: out.length + 1, ...i });
        if (out.length === 5) break;
      }
      return { available: true, summary: String(p.summary ?? '').slice(0, 400), topIssues: out };
    } catch (e: any) { lastErr = String(e?.message ?? e); console.log('[ai] attempt', attempt + 1, 'failed', lastErr); }
  }
  return { available: false, reason: `AI analysis failed: ${lastErr}. Showing verified findings only.` };
}
