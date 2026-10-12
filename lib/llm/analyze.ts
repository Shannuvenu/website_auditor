import { cache } from '@/lib/cache/memory';
import { getMaxLlmInputChars } from '@/lib/config/env';
import { compareByPriority, priorityForIssue, type PriorityResult } from '@/lib/priority';
import { validateAnalysis, type RejectedIssue } from '@/lib/validation/grounding';
import type { AggregatedAudit, TemplateAggregate } from '@/lib/validation/schemas';
import type { LlmIssue } from './schema';
import { buildLlmInput, buildUserPrompt, SYSTEM_PROMPT, type LlmInput } from './prompt';
import { getProvider, type LlmProvider } from './provider';

export interface RankedIssue extends LlmIssue {
  rank: number;
  priority: PriorityResult;
  /** Measured facts for the cited audits, attached by code (not by the model). */
  evidence: AggregatedAudit[];
}

export type AnalysisResult =
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string }
  | {
      status: 'ok';
      provider: string;
      model: string;
      runId: string;
      generatedAt: string;
      issues: RankedIssue[];
      rejected: RejectedIssue[];
    };

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/413|too large/i.test(message)) {
    return "The evidence is too large for this model's per-request limit. Lower AI_MAX_INPUT_CHARS or use a model with a higher limit.";
  }
  if (/429|rate limit/i.test(message)) return 'Model rate limit reached. Wait a minute and try again.';
  return `LLM request failed: ${message.slice(0, 160)}`;
}

/** Ranks validated issues with the code-computed priority score. */
export function rankIssues(
  issues: LlmIssue[],
  aggregate: TemplateAggregate,
  trafficWeight: number,
): RankedIssue[] {
  const byId = new Map(aggregate.audits.map((a) => [a.auditId, a]));
  return issues
    .map((issue) => {
      const evidence = issue.audit_ids.map((id) => byId.get(id)).filter((a): a is AggregatedAudit => a !== undefined);
      return {
        issue,
        evidence,
        priority: priorityForIssue(evidence, issue.effort, aggregate.device, trafficWeight),
        tieBreak: issue.issue,
      };
    })
    .sort(compareByPriority)
    .map(({ issue, evidence, priority }, i) => ({ ...issue, rank: i + 1, priority, evidence }));
}

export async function analyzeAggregate(
  aggregate: TemplateAggregate,
  options: { trafficWeight?: number; provider?: LlmProvider | null } = {},
): Promise<AnalysisResult> {
  const provider = options.provider === undefined ? getProvider() : options.provider;
  if (!provider) return { status: 'unavailable', reason: 'No LLM provider is configured. Measured evidence is shown without suggested fixes.' };
  if (!aggregate.audits.length) {
    return { status: 'ok', provider: provider.name, model: provider.model, runId: aggregate.runId, generatedAt: new Date().toISOString(), issues: [], rejected: [] };
  }

  const cacheKey = `analysis:${aggregate.runId}:${aggregate.templateId}:${aggregate.device}:${provider.name}:${provider.model}`;
  const hit = cache.get<AnalysisResult>(cacheKey);
  if (hit) return hit;

  const input: LlmInput = buildLlmInput(aggregate, getMaxLlmInputChars());
  let lastReason = 'The model returned an unusable response.';
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await provider.complete(SYSTEM_PROMPT, buildUserPrompt(input));
    } catch (error) {
      console.error(`[llm] ${provider.name} request failed: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown'}`);
      return { status: 'failed', reason: friendlyError(error) };
    }
    const outcome = validateAnalysis(raw, input);
    if (outcome.schemaError) {
      lastReason = outcome.schemaError;
      continue; // one retry for a malformed response
    }
    const result: AnalysisResult = {
      status: 'ok',
      provider: provider.name,
      model: provider.model,
      runId: aggregate.runId,
      generatedAt: new Date().toISOString(),
      issues: rankIssues(outcome.issues, aggregate, options.trafficWeight ?? 1),
      rejected: outcome.rejected,
    };
    console.log(`[llm] ${aggregate.templateId}/${aggregate.device}: ${outcome.issues.length} accepted, ${outcome.rejected.length} rejected`);
    cache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  }
  return { status: 'failed', reason: lastReason };
}

