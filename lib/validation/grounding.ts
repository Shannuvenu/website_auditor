import type { LlmInput } from '@/lib/llm/prompt';
import { llmIssueSchema, llmOutputSchema, type LlmIssue } from '@/lib/llm/schema';

export interface RejectedIssue {
  index: number;
  title: string;
  reason: string;
}

export interface ValidationOutcome {
  issues: LlmIssue[];
  rejected: RejectedIssue[];
  /** Set when the whole response is unusable (not JSON, wrong top-level shape). */
  schemaError: string | null;
}

interface GroundingContext {
  urlsByAudit: Map<string, Set<string>>;
  sampleUrls: Set<string>;
  allowedNumbers: number[];
  auditIds: string[];
}

function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
}

export function buildGroundingContext(input: LlmInput): GroundingContext {
  const raw: number[] = [];
  collectNumbers({ ...input, sampleUrls: [], failingAudits: input.failingAudits.map((a) => ({ ...a, affectedUrls: [] })) }, raw);
  // Derived renderings of the same measurements: seconds, KiB, MiB, percent of a fraction.
  const allowed = new Set<number>();
  for (const v of raw) {
    allowed.add(v);
    allowed.add(v / 1000);
    allowed.add(v / 1024);
    allowed.add(v / 1048576);
    if (v > 0 && v <= 1) allowed.add(v * 100);
  }
  return {
    urlsByAudit: new Map(input.failingAudits.map((a) => [a.auditId, new Set(a.affectedUrls)])),
    sampleUrls: new Set(input.sampleUrls),
    allowedNumbers: [...allowed],
    auditIds: input.failingAudits.map((a) => a.auditId),
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Numbers a reader would see in prose. URLs, audit ids and spec names (WCAG, HTTP) are removed first. */
export function extractNumbers(text: string, auditIds: string[]): string[] {
  let t = text.replace(/https?:\/\/\S+/g, ' ');
  for (const id of [...auditIds].sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(escapeRegExp(id), 'g'), ' ');
  }
  t = t.replace(/\b(?:WCAG|HTTP|ES|CSS|HTML)\s?\/?\d[\d.]*/gi, ' ');
  t = t.replace(/(\d),(?=\d{3}\b)/g, '$1');
  return t.match(/(?<![A-Za-z0-9_./-])\d+(?:\.\d+)?/g) ?? [];
}

function decimals(numeric: string): number {
  const dot = numeric.indexOf('.');
  return dot === -1 ? 0 : numeric.length - dot - 1;
}

function numberIsGrounded(numeric: string, allowed: number[]): boolean {
  const d = decimals(numeric);
  const target = Number(numeric).toFixed(d);
  return allowed.some((a) => a.toFixed(d) === target);
}

const TEXT_FIELDS = ['issue', 'likely_cause', 'proposed_change', 'verify_step'] as const;

function checkIssue(item: LlmIssue, ctx: GroundingContext): string | null {
  for (const id of item.audit_ids) {
    if (!ctx.urlsByAudit.has(id)) return `audit_id "${id}" is not in the input`;
  }
  const cited = item.audit_ids.map((id) => ctx.urlsByAudit.get(id) as Set<string>);
  for (const url of item.affected_urls) {
    if (!ctx.sampleUrls.has(url)) return `URL "${url}" is not in the sample set`;
    if (!cited.some((urls) => urls.has(url))) return `URL "${url}" is not affected by any cited audit`;
  }
  for (const field of TEXT_FIELDS) {
    for (const n of extractNumbers(item[field], ctx.auditIds)) {
      if (!numberIsGrounded(n, ctx.allowedNumbers)) return `number "${n}" in ${field} is not supported by the input`;
    }
  }
  return null;
}

function parseJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

/** Parses and validates a model response. Anything not provably grounded in `input` is dropped. */
export function validateAnalysis(raw: string, input: LlmInput): ValidationOutcome {
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    return { issues: [], rejected: [], schemaError: 'Model output is not valid JSON' };
  }
  const top = llmOutputSchema.safeParse(parsed);
  if (!top.success) return { issues: [], rejected: [], schemaError: 'Model output must be {"issues": [...]}' };

  const ctx = buildGroundingContext(input);
  const issues: LlmIssue[] = [];
  const rejected: RejectedIssue[] = [];
  top.data.issues.forEach((item, index) => {
    const title = typeof (item as { issue?: unknown })?.issue === 'string' ? (item as { issue: string }).issue : `Item ${index + 1}`;
    const shape = llmIssueSchema.safeParse(item);
    if (!shape.success) {
      const first = shape.error.issues[0];
      rejected.push({ index, title, reason: `schema: ${first.path.join('.') || 'item'} ${first.message}` });
      return;
    }
    const problem = checkIssue(shape.data, ctx);
    if (problem) rejected.push({ index, title, reason: problem });
    else issues.push(shape.data);
  });
  return { issues, rejected, schemaError: null };
}
