import { getProvider } from '@/lib/ai/provider';
import { CARDS } from '@/lib/scoring/score';
import type { CrawlFacts } from '@/lib/crawler/crawl';
import type { Finding, PsiResult } from '@/types/audit';
import type { Recommendations } from '@/types/recommendations';

const SYSTEM = `You are a website audit analyst. You receive VERIFIED evidence as JSON. Reason ONLY over that evidence.
Rules: never invent metrics, URLs or HTML elements; never claim images exist if image count is 0; never call an INCOMPLETE audit failed; never recommend without evidence; distinguish measured facts from recommendations; if evidence is insufficient say "Insufficient evidence."; do not recommend fixes for NOT_APPLICABLE items; do not predict score improvements or ranking gains; give technically realistic, specific remediation steps, naming the exact flagged files/URLs from the evidence when present.
Every item in highestImpactFixes MUST list "findingIds": the ids of the findings (from the provided list) that justify it. Use only ids that appear in the input.
Return STRICT JSON only, no markdown, with this shape:
{"summary":string,"biggestIssues":string[],"highestImpactFixes":[{"title":string,"findingIds":string[],"steps":string[],"evidence":string}],"categoryAnalysis":[{"category":string,"analysis":string}],"priorities":{"shortTerm":string[],"mediumTerm":string[],"ongoing":string[]}}`;

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);

export async function generateRecommendations(url: string, crawl: CrawlFacts | null, mobile: PsiResult, desktop: PsiResult, findings: Finding[]): Promise<Recommendations> {
  const llm = getProvider();
  if (!llm) return { available: false, reason: 'No AI provider configured. Showing verified findings only.' };
  const sent = findings.filter((f) => CARDS.includes(f.category) && ['FAIL', 'WARNING', 'INCOMPLETE', 'ERROR', 'NOT_APPLICABLE'].includes(f.status))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 70);
  const valid = new Set(sent.map((f) => f.id));
  const evidence = {
    url, crawler: crawl ? { ...crawl, http: { ...crawl.http, headers: undefined }, images: { ...crawl.images, sample: undefined } } : 'unavailable',
    pagespeed: { mobile: mobile.ok ? { scores: mobile.scores, metrics: mobile.metrics } : { error: mobile.error }, desktop: desktop.ok ? { scores: desktop.scores } : { error: desktop.error } },
    findings: sent.map(({ id, category, title, status, severity, evidence }) => ({ id, category, title, status, severity, evidence })),
  };
  try {
    const raw = await llm.complete(SYSTEM, `VERIFIED EVIDENCE:\n${JSON.stringify(evidence)}`);
    const p = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
    // Validation: drop any fix that is not backed by real finding IDs; drop unknown categories.
    const fixes = (Array.isArray(p.highestImpactFixes) ? p.highestImpactFixes : [])
      .map((f: any) => ({ title: String(f?.title ?? ''), evidence: String(f?.evidence ?? ''), steps: arr(f?.steps), findingIds: arr(f?.findingIds).filter((id) => valid.has(id)) }))
      .filter((f: any) => f.title && f.findingIds.length > 0 && f.steps.length > 0);
    const cats = (Array.isArray(p.categoryAnalysis) ? p.categoryAnalysis : []).filter((c: any) => CARDS.includes(c?.category) && typeof c?.analysis === 'string');
    const pr = p.priorities ?? {};
    return { available: true, summary: String(p.summary ?? ''), biggestIssues: arr(p.biggestIssues), highestImpactFixes: fixes, categoryAnalysis: cats, priorities: { shortTerm: arr(pr.shortTerm), mediumTerm: arr(pr.mediumTerm), ongoing: arr(pr.ongoing) } };
  } catch (e: any) { console.log('[ai] failed', e?.message); return { available: false, reason: `AI analysis failed: ${e?.message ?? 'unknown error'}. Showing verified findings only.` }; }
}