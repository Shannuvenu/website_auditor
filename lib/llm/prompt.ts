import type { TemplateAggregate } from '@/lib/validation/schemas';
import { rankAuditsByImpact } from '@/lib/priority';
import { OUTPUT_SHAPE_DESCRIPTION } from './schema';

// Facts about the target stack (reused from the original recommendation engine).
// Move an item from `unknown` to `confirmed` ONLY after the DH/Prajavani team confirms it. Never guess.
const STACK = {
  confirmed: [
    'CMS: Quintype (Deccan Herald, Prajavani)',
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

const STACK_CONTEXT = `CONFIRMED:\n${STACK.confirmed.map((s) => `- ${s}`).join('\n')}\nUNKNOWN (never assert these; if a change depends on one, say so in likely_cause):\n${STACK.unknown.map((s) => `- ${s}`).join('\n')}`;

export const SYSTEM_PROMPT = `You are a senior web-performance engineer helping developers of a news site. You receive MEASURED evidence for ONE page template on ONE device, aggregated over several sample URLs, plus a fixed STACK CONTEXT. Reason ONLY over these two sources.

Task: group the failing audits into at most 6 issues. One issue = one underlying cause that may explain several audits. Developers fix templates, not single URLs. Do not merge unrelated problems. If fewer real issues exist, return fewer. Do not pad. Do not rank them; ranking is done by code.

Return STRICT JSON only, no markdown, exactly this shape:
${OUTPUT_SHAPE_DESCRIPTION}

Field rules:
- "issue": short title.
- "audit_ids": 1-8 ids copied EXACTLY from failingAudits[].auditId.
- "affected_urls": URLs copied EXACTLY from the affectedUrls of the audits you cite (a subset is fine).
- "likely_cause": a hypothesis grounded in the evidence (repeatedOffenders are the best clues). You only see rendered-page measurements, never source code, so phrase causes as likely, not certain. If the evidence does not support a cause, write exactly "unknown".
- "proposed_change": what a developer should change in the template or its assets.
- "effort": "S" = small change confined to one template; "M" = template plus asset or build change; "L" = cross-cutting change, or one that depends on a third party.
- "confidence": "High" only when the audit data and repeated offenders point at one cause directly; otherwise "Medium" or "Low".
- "verify_step": how to confirm the fix worked (normally: re-run the same sample URLs and compare the named audit).

Evidence discipline:
- Never invent audit ids, URLs, hosts, scripts, class names, metrics, savings, percentages or scores.
- Any number you write must appear in the evidence (counts, ms, bytes, percentages, scores, p75 values). Prefer counts like "8 of 10 sample URLs". Do not write other numbers. Never predict score or ranking gains.
- Only recommend changes the site owner controls. Third-party scripts (ads, analytics, widgets) cannot be rewritten by the site: recommend deferring, lazy-loading, conditional loading or raising it with the vendor. Ads, analytics and consent are revenue/compliance-critical: never recommend removing them.
- Never assert anything marked UNKNOWN in the stack context.
- crux values are real-user p75 data. If they disagree with lab data, say so in likely_cause only if it matters to the issue.
- Accessibility: you cannot see the page. Automated audits catch only a minority of problems, so never imply a template is accessible. Never invent alt text.

STACK CONTEXT:
${STACK_CONTEXT}
`;

export interface LlmInputAudit {
  auditId: string;
  title: string;
  category: 'performance' | 'accessibility';
  affectedCount: number;
  sampledCount: number;
  affectedSharePercent: number;
  affectedUrls: string[];
  medianSavingsMs: number | null;
  medianSavingsBytes: number | null;
  repeatedOffenders: { resource: string; urlCount: number }[];
}

export interface LlmInput {
  template: { id: string; name: string };
  brand: string;
  device: string;
  urlsMeasured: number;
  runsPerUrl: number;
  lighthouseScores: { performance: number | null; accessibility: number | null };
  labMetricsMedian: TemplateAggregate['labMetrics'];
  cruxP75: { scope: string; lcpMs: number | null; cls: number | null; inpMs: number | null };
  sampleUrls: string[];
  failingAudits: LlmInputAudit[];
}

/**
 * The only data the model sees. Audits are ordered by measured impact and the lowest-impact ones are
 * dropped until the JSON fits maxChars, so truncation is deterministic.
 */
export function buildLlmInput(aggregate: TemplateAggregate, maxChars: number): LlmInput {
  const ranked = rankAuditsByImpact(aggregate.audits, aggregate.device).map(({ audit }) => audit);
  const build = (audits: typeof ranked): LlmInput => ({
    template: { id: aggregate.templateId, name: aggregate.templateName },
    brand: aggregate.brand,
    device: aggregate.device,
    urlsMeasured: aggregate.urlsMeasured,
    runsPerUrl: aggregate.runsPerUrl,
    lighthouseScores: aggregate.scores,
    labMetricsMedian: aggregate.labMetrics,
    cruxP75: { scope: aggregate.crux.scope, lcpMs: aggregate.crux.lcpMs, cls: aggregate.crux.cls, inpMs: aggregate.crux.inpMs },
    sampleUrls: aggregate.sampleUrls,
    failingAudits: audits.map((a) => ({
      auditId: a.auditId,
      title: a.title,
      category: a.category,
      affectedCount: a.affectedCount,
      sampledCount: a.sampledCount,
      affectedSharePercent: Math.round(a.affectedShare * 100),
      affectedUrls: a.affectedUrls,
      medianSavingsMs: a.medianSavingsMs,
      medianSavingsBytes: a.medianSavingsBytes,
      repeatedOffenders: a.repeatedOffenders,
    })),
  });
  let kept = ranked;
  let input = build(kept);
  while (kept.length > 1 && JSON.stringify(input).length > maxChars) {
    kept = kept.slice(0, -1);
    input = build(kept);
  }
  return input;
}

export function buildUserPrompt(input: LlmInput): string {
  return `MEASURED EVIDENCE:\n${JSON.stringify(input)}`;
}
