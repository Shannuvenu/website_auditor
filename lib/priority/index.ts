import type { AggregatedAudit, Device } from '@/lib/validation/schemas';
import type { Effort } from '@/types';

/** Effort divisors from the PRD: S = 1, M = 2, L = 4. */
export const EFFORT_DIVISOR: Record<Effort, number> = { S: 1, M: 2, L: 4 };

/**
 * Lighthouse's default simulated throttling, used only to put byte savings on the same ms scale:
 * mobile = slow 4G (1,638.4 Kbps), desktop = 10,240 Kbps.
 */
const THROUGHPUT_KBPS: Record<Device, number> = { mobile: 1638.4, desktop: 10240 };

export function bytesToMs(bytes: number, device: Device): number {
  const bytesPerSecond = (THROUGHPUT_KBPS[device] * 1000) / 8;
  return (bytes / bytesPerSecond) * 1000;
}

/**
 * Median savings for an audit on a common ms scale. Time savings win; byte-only savings are converted
 * with the throttling above. null when the audit reports no measurable savings (for example layout
 * shifts and most accessibility audits).
 */
export function savingsMsFor(audit: AggregatedAudit, device: Device): number | null {
  if (audit.medianSavingsMs !== null && audit.medianSavingsMs > 0) return audit.medianSavingsMs;
  if (audit.medianSavingsBytes !== null && audit.medianSavingsBytes > 0) {
    return bytesToMs(audit.medianSavingsBytes, device);
  }
  return null;
}

export interface PriorityInput {
  savingsMs: number | null;
  share: number;
  trafficWeight: number;
  effort: Effort;
}

export interface PriorityResult {
  /** (median savings x share of URLs x traffic weight) / effort. null when savings are unmeasured. */
  score: number | null;
  savingsMs: number | null;
  share: number;
  trafficWeight: number;
  effortDivisor: number;
  basis: 'measured-savings' | 'unquantified';
}

export function computePriority(input: PriorityInput): PriorityResult {
  const effortDivisor = EFFORT_DIVISOR[input.effort];
  const quantified = input.savingsMs !== null && input.savingsMs > 0;
  return {
    score: quantified ? (input.savingsMs! * input.share * input.trafficWeight) / effortDivisor : null,
    savingsMs: input.savingsMs,
    share: input.share,
    trafficWeight: input.trafficWeight,
    effortDivisor,
    basis: quantified ? 'measured-savings' : 'unquantified',
  };
}

/** Quantified items first (highest score), then unquantified by share / effort. Stable on ties. */
export function compareByPriority(
  a: { priority: PriorityResult; tieBreak: string },
  b: { priority: PriorityResult; tieBreak: string },
): number {
  if (a.priority.score !== null && b.priority.score !== null) {
    return b.priority.score - a.priority.score || a.tieBreak.localeCompare(b.tieBreak);
  }
  if (a.priority.score !== null) return -1;
  if (b.priority.score !== null) return 1;
  const ra = a.priority.share * a.priority.trafficWeight / a.priority.effortDivisor;
  const rb = b.priority.share * b.priority.trafficWeight / b.priority.effortDivisor;
  return rb - ra || a.tieBreak.localeCompare(b.tieBreak);
}

/**
 * Pre-LLM view used by the overview "top issue": ranks Lighthouse audits by measured impact
 * (effort is unknown at this stage, so it is treated as equal for every audit).
 */
export function rankAuditsByImpact(audits: AggregatedAudit[], device: Device, trafficWeight = 1) {
  return audits
    .map((audit) => ({
      audit,
      priority: computePriority({
        savingsMs: savingsMsFor(audit, device),
        share: audit.affectedShare,
        trafficWeight,
        effort: 'S',
      }),
      tieBreak: audit.auditId,
    }))
    .sort(compareByPriority);
}

/**
 * Priority for an LLM-proposed issue. Evidence comes only from the cited audits: the largest median
 * savings and the largest share of URLs among them (max, not sum, so overlapping audits are not double counted).
 */
export function priorityForIssue(
  citedAudits: AggregatedAudit[],
  effort: Effort,
  device: Device,
  trafficWeight = 1,
): PriorityResult {
  const savings = citedAudits.map((a) => savingsMsFor(a, device)).filter((v): v is number => v !== null);
  return computePriority({
    savingsMs: savings.length ? Math.max(...savings) : null,
    share: citedAudits.length ? Math.max(...citedAudits.map((a) => a.affectedShare)) : 0,
    trafficWeight,
    effort,
  });
}
