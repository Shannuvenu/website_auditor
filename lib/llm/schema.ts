import { z } from 'zod';

const capitalise = (v: unknown) =>
  typeof v === 'string' && v.length > 0 ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v;

/** One issue exactly as the PRD defines it. Unknown keys are rejected. */
export const llmIssueSchema = z
  .object({
    issue: z.string().trim().min(3).max(160),
    audit_ids: z.array(z.string().trim().min(1)).min(1).max(8),
    affected_urls: z.array(z.string().trim().min(1)).min(1).max(10),
    likely_cause: z.string().trim().min(1).max(400),
    proposed_change: z.string().trim().min(3).max(500),
    effort: z.enum(['S', 'M', 'L']),
    confidence: z.preprocess(capitalise, z.enum(['High', 'Medium', 'Low'])),
    verify_step: z.string().trim().min(3).max(300),
  })
  .strict();

export const llmOutputSchema = z.object({ issues: z.array(z.unknown()).max(20) });

export type LlmIssue = z.infer<typeof llmIssueSchema>;

/** JSON shape described to the model in the system prompt. */
export const OUTPUT_SHAPE_DESCRIPTION = `{"issues":[{"issue":string,"audit_ids":string[],"affected_urls":string[],"likely_cause":string,"proposed_change":string,"effort":"S"|"M"|"L","confidence":"High"|"Medium"|"Low","verify_step":string}]}`;
