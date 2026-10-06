import { getProvider } from '@/lib/ai/provider';
import { CARDS } from '@/lib/scoring/score';
import type { CrawlFacts } from '@/lib/crawler/crawl';
import type { RenderFacts } from '@/lib/crawler/render';
import type { Finding, PsiResult } from '@/types/audit';
import type { Recommendations, TopIssue } from '@/types/recommendations';

// Facts about the target stack. Move an item from `unknown` to `confirmed` ONLY after the DH team confirms it. Never guess.
const STACK = {
  confirmed: [
    'CMS: Quintype (Deccan Herald, Prajavani)',
    'Templates: home, section, article, video',
    'Ads, analytics and consent are revenue/compliance-critical',
  ],
  unknown: [
    'where the tag manager container is loaded (head/body, sync/async)',
    'how ads are loaded',
    'consent setup',
    'CDN',
    'how fonts (including the Kannada webfont) are loaded',
    'how <head> markup is generated',
  ],
};
const STACK_CONTEXT = `CONFIRMED:\n${STACK.confirmed.map((s) => `- ${s}`).join('\n')}\nUNKNOWN (never assert these; if a fix depends on one, set fixLocation to "Not determinable from provided context"):\n${STACK.unknown.map((s) => `- ${s}`).join('\n')}`;

const SYSTEM = `You are a senior web-performance engineer reviewing a news website. You receive VERIFIED evidence as JSON and a fixed STACK CONTEXT. Reason ONLY over these two sources.

Task: group the "candidates" into up to 5 ROOT-CAUSE findings. One finding = one underlying cause that explains several failing audits (example: render-blocking resources + unused JavaScript + long main-thread tasks + high total blocking time can be ONE cause: scripts loaded synchronously, but only if the evidence shows it). Developers fix causes, not audits. Do not merge unrelated issues into one finding (for example security headers with performance). Rank by user impact, effort and business risk. If fewer than 5 real causes exist, return fewer. Do not pad.

For each finding return:
- "title": short
- "rootCause": 1-2 sentences, directly supported by the evidence
- "findingIds": 1-4 ids copied EXACTLY from candidates
- "whyItMatters": 1-2 sentences grounded in evidence
- "fix": one sentence, the proposed change
- "fixLocation": where in the STACK CONTEXT this fix lives; if the context does not say, write "Not determinable from provided context"
- "fixSteps": 2-4 specific steps; name exact files/URLs/scripts from the evidence
- "effort": "low" | "medium" | "high"
- "businessRisk": "low" | "medium" | "high"
- "riskNote": 1 sentence on what could break (ad revenue, analytics, consent compliance)

Evidence discipline:
- Copy numbers and units exactly as written in the evidence (KiB stays KiB; never convert units or restate a number in a different unit).
- Every class name, element, URL or host you mention must be copied from the evidence; never invent one.
- Never mention internal ids such as psi-... or render-... inside text fields.
- Never speculate: do not use "likely", "probably" or "may be". State only what the evidence shows. Ad-host requests seen in a headless run do not prove scripts are synchronous, in the head, or loaded by a tag manager. Do not claim a cause (for example "blocks the main thread") unless an audit in the cited findings shows it.
- If pagespeed.mobile contains an error, lab metrics are unavailable: make no mobile or Core Web Vitals claims.
- Never assert anything marked UNKNOWN in STACK CONTEXT.
- Only recommend fixes the site owner controls. "siteHost" is the audited site's own domain. Scripts from third-party vendors (ads, analytics, widgets, payments, social) cannot be minified, bundle-analysed or rewritten by the site: for those recommend deferring, lazy-loading, loading conditionally, or raising it with the vendor.
- Check each fix against the evidence before suggesting it (for example, do not suggest font-display: swap if the stylesheet URL already contains display=swap).

Rules: never invent metrics, URLs, scripts or HTML elements; never recommend without evidence; do not predict score or ranking gains; never label a script as an ad script or tracker unless its host or name in the evidence says so. Ads, analytics and consent are revenue/compliance-critical: recommend deferring, reordering or reducing them, never removing them. Do not output a confidence or affected field.
The "render" block is from an unthrottled headless browser: its timings show ordering only and must not be compared with Lighthouse numbers. render.sessionLike is a URL-pattern heuristic, not proof.
"pagespeed.mobile.extra.runs" shows run-to-run variance; if the range is wide, say results are noisy. "pagespeed.mobile.extra.field" is real-user (CrUX) data; if it disagrees with lab data, say so.
Accessibility: you cannot see the page. Never imply a page is accessible because a score is high (automated tools catch only a minority of issues). Never invent alt text for images you cannot see.
"summary": at most 2 sentences stating measured facts only.

STACK CONTEXT:
${STACK_CONTEXT}

Return STRICT JSON only, no markdown, exactly this shape:
{"summary":string,"topIssues":[{"title":string,"rootCause":string,"findingIds":string[],"whyItMatters":string,"fix":string,"fixLocation":string,"fixSteps":string[],"effort":string,"businessRisk":string,"riskNote":string}]}`;

const CHAT_SYSTEM = `You answer follow-up questions from a developer about ONE website audit report. Use ONLY the REPORT JSON provided; it is your only source of facts. Cite the finding ids you rely on. If the report does not contain the answer, set "answer" to exactly: The report does not contain that. Copy numbers and units exactly as written in the report (KiB stays KiB; never convert units). Never invent class names, URLs, hosts or elements. Never speculate about causes the evidence does not show. Never imply a page is accessible because a score is high (automated tools catch only a minority of accessibility issues). Keep the answer under 120 words.
Return STRICT JSON only, no markdown, exactly this shape: {"answer":string,"findingIds":string[]}`;

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
const isLv = (x: unknown): x is 'low' | 'medium' | 'high' => x === 'low' || x === 'medium' || x === 'high';
const isCandidate = (f: Finding) => CARDS.includes(f.category) && (f.status === 'FAIL' || f.status === 'WARNING') && ['critical', 'high', 'medium'].includes(f.severity);
const hostOf = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const norm = (s: string) => s.replace(/(\d),(?=\d{3})/g, '$1'); // "1,503 KiB" -> "1503 KiB"
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Input budget: free-tier models reject big prompts (Groq: HTTP 413, ~8000 tokens/min). Evidence is shrunk until it fits. ----
const MAX_IN = Math.max(4000, Number(process.env.AI_MAX_INPUT_CHARS) || 12000);
type Level = { c: number; e: number; a: number; cr: boolean }; // candidates, evidence chars, array items, include crawler
const LEVELS: Level[] = [{ c: 40, e: 500, a: 8, cr: true }, { c: 25, e: 300, a: 6, cr: true }, { c: 15, e: 200, a: 4, cr: true }, { c: 10, e: 140, a: 3, cr: false }];
const clip = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const trimArrays = (o: any, n: number): any => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, n) : v])) : o);
const friendlyErr = (e: any) => {
  const msg = String(e?.message ?? e);
  if (/413|too large/i.test(msg)) return "The report is too large for this model's per-request token limit. Lower AI_MAX_INPUT_CHARS or use a model/plan with a higher limit.";
  if (/429|rate limit/i.test(msg)) return 'Model rate limit reached (tokens per minute). Wait a minute and try again.';
  return msg.slice(0, 200);
};

// ---- Grounding checks: flag claims in LLM text that do not appear in the evidence ----
// numbers with units that are NOT in the evidence (catches "1.5 GiB" when evidence says "1,503 KiB")
export function ungroundedNumbers(text: string, ev: string): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(/(\d[\d,]*\.?\d*)\s?(GiB|MiB|KiB|GB|MB|KB|ms|s)\b/gi)) {
    const num = m[1].replace(/,/g, '');
    if (!new RegExp(`(^|[^\\d.])${esc(num)}\\d*\\s?${m[2]}\\b`, 'i').test(ev)) bad.push(`${m[1]} ${m[2]}`);
  }
  return bad;
}
// quoted class-like tokens (e.g. "oSeak") that are NOT in the evidence
export function ungroundedTokens(text: string, ev: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([A-Za-z0-9]{4,8})"/g)) if (/[a-z]/.test(m[1]) && /[A-Z]/.test(m[1]) && !ev.includes(m[1])) out.push(m[1]);
  return out;
}
// hostnames that are NOT in the evidence
export function ungroundedHosts(text: string, ev: string): string[] {
  const evl = ev.toLowerCase(), out: string[] = [];
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|in|co|tv|ai))\b/gi)) if (!evl.includes(m[1].toLowerCase())) out.push(m[1]);
  return out;
}
const checkClaims = (text: string, ev: string) => [...new Set([...ungroundedNumbers(text, ev), ...ungroundedTokens(text, ev), ...ungroundedHosts(text, ev)])];

export async function generateRecommendations(url: string, crawl: CrawlFacts | null, mobile: PsiResult, desktop: PsiResult, findings: Finding[], render: RenderFacts | null = null): Promise<Recommendations> {
  const llm = getProvider();
  if (!llm) return { available: false, reason: 'No AI provider configured. Showing verified findings only.' };
  const cand = findings.filter(isCandidate).sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 40);
  if (!cand.length) return { available: true, summary: 'No failing or warning checks were found in the reported categories.', topIssues: [] };
  // Build the evidence at the richest level that fits the model's input budget
  const makeEvidence = (L: Level) => ({
    url, siteHost: hostOf(url),
    crawler: crawl ? (L.cr ? { ...crawl, http: { ...crawl.http, headers: undefined }, images: { ...crawl.images, sample: undefined } } : 'omitted to fit the input limit') : 'unavailable',
    render: render?.ok ? { words: render.words, checkTextFoundMs: render.checkTextFoundMs, totalRequests: render.totalRequests, adLikeHosts: render.adLikeHosts, gtmRequests: render.gtmRequests, sessionLike: render.sessionLike, thirdPartyHosts: render.thirdPartyHosts } : null,
    pagespeed: { mobile: mobile.ok ? { scores: mobile.scores, metrics: mobile.metrics, extra: trimArrays(mobile.extra, L.a) } : { error: mobile.error }, desktop: desktop.ok ? { scores: desktop.scores } : { error: desktop.error } },
    candidates: cand.slice(0, L.c).map(({ id, category, title, status, severity, evidence }) => ({ id, category, title, status, severity, evidence: clip(evidence, L.e) })),
  });
  let level = LEVELS[0], evidence = makeEvidence(level), evJson = JSON.stringify(evidence);
  for (const L of LEVELS) { level = L; evidence = makeEvidence(L); evJson = JSON.stringify(evidence); if (evJson.length <= MAX_IN) break; }
  const ev = norm(evJson);
  const byId = new Map(cand.slice(0, level.c).map((f) => [f.id, f])); // the model may only cite candidates it was actually shown
  console.log(`[ai] evidence ${evJson.length} chars, ${byId.size} candidates (limit ${MAX_IN})`);
  let lastErr = 'unknown error';
  let best: { rec: Recommendations; bad: number } | null = null;
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await llm.complete(SYSTEM, `VERIFIED EVIDENCE:\n${evJson}${feedback}`);
      const p = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
      const rawIssues: any[] = Array.isArray(p.topIssues) ? p.topIssues : [];
      const parsed: any[] = [];
      for (const i of rawIssues) {
        const rawIds = arr(i?.findingIds);
        // HARD RULE: any cited audit id that is not in the input => reject the whole finding
        if (!rawIds.length || rawIds.some((id) => !byId.has(id))) { console.log('[ai] rejected (unknown audit id):', i?.title, rawIds); continue; }
        if (!isLv(i?.effort) || !isLv(i?.businessRisk)) { console.log('[ai] rejected (bad effort/risk value):', i?.title); continue; }
        const ids = [...new Set(rawIds)].slice(0, 4);
        const fails = ids.filter((id) => byId.get(id)!.status === 'FAIL').length;
        // Evidence strength is computed in code (how many audits back the finding), not self-reported by the LLM
        const confidence = ids.length >= 2 && fails >= 1 ? 'high' : ids.length >= 2 || fails >= 1 ? 'medium' : 'low';
        // "Affected" is computed in code from the cited findings' real data sources, never from the LLM
        const srcs = [...new Set(ids.map((id) => byId.get(id)!.source))].map((s) => (s === 'pagespeed' ? 'PageSpeed mobile lab data' : 'crawler / headless check'));
        const affected = `${srcs.join(' + ')} · ${url}`;
        const item = {
          title: String(i?.title ?? '').slice(0, 160), rootCause: String(i?.rootCause ?? '').slice(0, 400), findingIds: ids,
          affected, whyItMatters: String(i?.whyItMatters ?? '').slice(0, 400),
          fix: String(i?.fix ?? '').slice(0, 300), fixLocation: String(i?.fixLocation ?? '').slice(0, 200),
          fixSteps: arr(i?.fixSteps).slice(0, 5), effort: i.effort, businessRisk: i.businessRisk,
          riskNote: String(i?.riskNote ?? '').slice(0, 300), confidence,
          // evidence always comes from verified findings, never from the AI
          evidence: ids.map((id) => ({ id, title: byId.get(id)!.title, text: byId.get(id)!.evidence })),
        };
        const unverified = checkClaims([item.title, item.rootCause, item.whyItMatters, item.fix, item.riskNote, ...item.fixSteps].join(' '), ev);
        if (item.title && item.rootCause && item.fixSteps.length) parsed.push({ ...item, unverified });
      }
      const used = new Set<string>(); const out: TopIssue[] = [];
      for (const i of parsed) {
        if (i.findingIds.every((id: string) => used.has(id))) continue;
        i.findingIds.forEach((id: string) => used.add(id));
        out.push({ rank: out.length + 1, ...i });
        if (out.length === 5) break;
      }
      // If the LLM returned findings but ALL failed validation, retry / fall back instead of showing a misleading empty result
      if (rawIssues.length > 0 && out.length === 0) throw new Error('AI findings failed validation (unknown audit IDs or bad schema)');
      const sum = String(p.summary ?? '').slice(0, 400), sumBad = checkClaims(sum, ev);
      const rec: Recommendations = { available: true, summary: sumBad.length ? `${sum} (unverified: ${sumBad.join(', ')})` : sum, topIssues: out };
      const bad = [...out.flatMap((i) => i.unverified ?? []), ...sumBad];
      if (!best || bad.length < best.bad) best = { rec, bad: bad.length };
      if (!bad.length) return rec;
      // Self-repair: tell the model exactly which values are not in the evidence and retry once; keep whichever attempt has fewer
      console.log('[ai] unverified claims:', [...new Set(bad)]);
      feedback = `\n\nCORRECTION: your previous answer used values that are NOT in the evidence: ${[...new Set(bad)].join(', ')}. Rewrite the whole answer using only numbers, hosts and names that appear in the evidence, with units exactly as written.`;
    } catch (e: any) { lastErr = String(e?.message ?? e); console.log('[ai] attempt', attempt + 1, 'failed', lastErr); }
  }
  if (best) return best.rec;
  return { available: false, reason: `AI analysis failed: ${friendlyErr(lastErr)} Showing verified findings only.` };
}

export interface ChatAnswer { answer: string; findingIds: string[]; unverified: string[] }

// Grounded follow-up: answers ONLY from the cached audit report, cites finding ids, flags ungrounded numbers/hosts
export async function answerQuestion(question: string, d: any): Promise<ChatAnswer> {
  const llm = getProvider();
  if (!llm) return { answer: 'No AI provider configured.', findingIds: [], unverified: [] };
  const cand: Finding[] = (Array.isArray(d?.issues) ? d.issues : []).filter(isCandidate).sort((a: Finding, b: Finding) => RANK[a.severity] - RANK[b.severity]).slice(0, 40);
  const m = d?.pagespeed?.mobile, k = d?.pagespeed?.desktop, r = d?.render;
  const topIssues = (Array.isArray(d?.recommendations?.topIssues) ? d.recommendations.topIssues : []).map((t: TopIssue) => ({ rank: t.rank, title: clip(t.title, 120), rootCause: clip(t.rootCause, 220), findingIds: t.findingIds, fix: clip(t.fix, 160) }));
  const makeCtx = (L: Level) => ({
    url: d?.url, siteHost: hostOf(d?.url),
    pagespeed: { mobile: m?.ok ? { scores: m.scores, metrics: m.metrics, extra: trimArrays(m.extra, L.a) } : { error: m?.error }, desktop: k?.ok ? { scores: k.scores, metrics: k.metrics } : { error: k?.error } },
    render: r?.ok ? { totalRequests: r.totalRequests, adLikeHosts: r.adLikeHosts, gtmRequests: r.gtmRequests, thirdPartyHosts: r.thirdPartyHosts } : null,
    candidates: cand.slice(0, L.c).map(({ id, category, title, status, severity, evidence }) => ({ id, category, title, status, severity, evidence: clip(evidence, L.e) })),
    topIssues,
  });
  let level = LEVELS[0], ctx = makeCtx(level), ctxJson = JSON.stringify(ctx);
  for (const L of LEVELS) { level = L; ctx = makeCtx(L); ctxJson = JSON.stringify(ctx); if (ctxJson.length <= MAX_IN) break; }
  const ids = new Set(cand.slice(0, level.c).map((f) => f.id));
  console.log(`[ai] chat context ${ctxJson.length} chars (limit ${MAX_IN})`);
  try {
    const raw = await llm.complete(CHAT_SYSTEM, `REPORT:\n${ctxJson}\n\nQUESTION: ${question}`);
    const p = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim());
    const answer = String(p.answer ?? '').slice(0, 1200);
    return { answer, findingIds: [...new Set(arr(p.findingIds))].filter((id) => ids.has(id)), unverified: checkClaims(answer, norm(ctxJson)) };
  } catch (e: any) { return { answer: `Could not answer: ${friendlyErr(e)}`, findingIds: [], unverified: [] }; }
}