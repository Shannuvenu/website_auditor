import type { TemplateAggregate } from '@/lib/validation/schemas';

export type AuditChange = 'resolved' | 'improved' | 'unchanged' | 'worse' | 'new';

export interface AuditDelta {
  auditId: string;
  title: string;
  beforeAffected: number | null;
  afterAffected: number | null;
  beforeSampled: number;
  afterSampled: number;
  change: AuditChange;
}

export interface Comparison {
  beforeRunId: string;
  afterRunId: string;
  beforeAt: string;
  afterAt: string;
  sameSampleSet: boolean;
  performanceDelta: number | null;
  accessibilityDelta: number | null;
  labLcpDeltaMs: number | null;
  cruxLcpDeltaMs: number | null;
  audits: AuditDelta[];
}

const delta = (after: number | null, before: number | null) => (after === null || before === null ? null : after - before);

/**
 * Measured before/after view for the retest use case. Pure arithmetic over two stored aggregates:
 * it reports what changed and never raises alerts.
 */
export function compareAggregates(before: TemplateAggregate, after: TemplateAggregate): Comparison {
  const beforeById = new Map(before.audits.map((a) => [a.auditId, a]));
  const afterById = new Map(after.audits.map((a) => [a.auditId, a]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];

  const audits = ids.map((auditId): AuditDelta => {
    const b = beforeById.get(auditId);
    const a = afterById.get(auditId);
    const bShare = b?.affectedShare ?? 0;
    const aShare = a?.affectedShare ?? 0;
    let change: AuditChange;
    if (!a) change = 'resolved';
    else if (!b) change = 'new';
    else if (aShare < bShare - 1e-6) change = 'improved';
    else if (aShare > bShare + 1e-6) change = 'worse';
    else change = 'unchanged';
    return {
      auditId,
      title: (a ?? b)!.title,
      beforeAffected: b?.affectedCount ?? null,
      afterAffected: a?.affectedCount ?? null,
      beforeSampled: before.urlsMeasured,
      afterSampled: after.urlsMeasured,
      change,
    };
  });
  const order: Record<AuditChange, number> = { resolved: 0, improved: 1, worse: 2, new: 3, unchanged: 4 };
  audits.sort((x, y) => order[x.change] - order[y.change] || x.auditId.localeCompare(y.auditId));

  const sameSampleSet = before.sampleUrls.length === after.sampleUrls.length && before.sampleUrls.every((u) => after.sampleUrls.includes(u));
  return {
    beforeRunId: before.runId,
    afterRunId: after.runId,
    beforeAt: before.generatedAt,
    afterAt: after.generatedAt,
    sameSampleSet,
    performanceDelta: delta(after.scores.performance, before.scores.performance),
    accessibilityDelta: delta(after.scores.accessibility, before.scores.accessibility),
    labLcpDeltaMs: delta(after.labMetrics.lcpMs, before.labMetrics.lcpMs),
    cruxLcpDeltaMs: delta(after.crux.lcpMs, before.crux.lcpMs),
    audits,
  };
}
