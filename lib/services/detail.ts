import { getDataSource } from '@/lib/data';
import type { Device, TemplateAggregate, TemplateRegistryEntry } from '@/lib/validation/schemas';
import { compareAggregates, type Comparison } from './compare';

export interface HistoryPoint {
  runId: string;
  generatedAt: string;
  trigger: 'scheduled' | 'retest';
  performance: number | null;
  accessibility: number | null;
  lcpMs: number | null;
  urlsMeasured: number;
}

export interface TemplateDetailData {
  template: TemplateRegistryEntry | null;
  aggregate: TemplateAggregate;
  history: HistoryPoint[];
  /** Previous measurement vs. latest, for the "after a fix" check. null when there is only one run. */
  comparison: Comparison | null;
}

const toPoint = (a: TemplateAggregate): HistoryPoint => ({
  runId: a.runId,
  generatedAt: a.generatedAt,
  trigger: a.trigger,
  performance: a.scores.performance,
  accessibility: a.scores.accessibility,
  lcpMs: a.crux.lcpMs ?? a.labMetrics.lcpMs,
  urlsMeasured: a.urlsMeasured,
});

export async function getTemplateDetail(templateId: string, device: Device): Promise<TemplateDetailData | null> {
  const source = getDataSource();
  const [history, templates] = await Promise.all([source.getAggregateHistory(templateId, device, 10), source.listTemplates()]);
  if (!history.length) return null;
  const [latest, previous] = history;
  return {
    template: templates.find((t) => t.templateId === templateId) ?? null,
    aggregate: latest,
    history: history.map(toPoint),
    comparison: previous ? compareAggregates(previous, latest) : null,
  };
}
