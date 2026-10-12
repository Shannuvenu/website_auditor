import { getDataSource } from '@/lib/data';
import { rankAuditsByImpact } from '@/lib/priority';
import { validateTemplate } from '@/lib/templates/registry';
import { brandSchema } from '@/lib/validation/schemas';
import type { Brand, Device, TemplateAggregate, TemplateRegistryEntry } from '@/lib/validation/schemas';

export interface OverviewRow {
  templateId: string;
  templateName: string;
  brand: Brand;
  device: Device;
  /** 'measured' has a stored aggregate; 'not-measured' is a valid registry row with no run yet; 'invalid' can never run until the registry row is fixed. */
  status: 'measured' | 'not-measured' | 'invalid';
  /** Registry problems for an 'invalid' row; empty otherwise. */
  problems: string[];
  runId: string | null;
  generatedAt: string | null;
  urlsMeasured: number;
  urlCount: number;
  performance: number | null;
  accessibility: number | null;
  lcpMs: number | null;
  lcpSource: 'field' | 'lab' | null;
  /** Highest measured-impact failing Lighthouse audit (deterministic, computed in code). */
  topIssue: { auditId: string; title: string; affectedCount: number; sampledCount: number } | null;
}

export function trafficWeightFor(template: TemplateRegistryEntry | undefined | null): number {
  return template?.trafficWeight ?? 1;
}

export function toOverviewRow(aggregate: TemplateAggregate, template?: TemplateRegistryEntry): OverviewRow {
  const top = rankAuditsByImpact(aggregate.audits, aggregate.device, trafficWeightFor(template))[0]?.audit;
  const field = aggregate.crux.lcpMs;
  return {
    templateId: aggregate.templateId,
    templateName: aggregate.templateName,
    brand: aggregate.brand,
    device: aggregate.device,
    status: 'measured',
    problems: [],
    runId: aggregate.runId,
    generatedAt: aggregate.generatedAt,
    urlsMeasured: aggregate.urlsMeasured,
    urlCount: aggregate.urlCount,
    performance: aggregate.scores.performance,
    accessibility: aggregate.scores.accessibility,
    lcpMs: field ?? aggregate.labMetrics.lcpMs,
    lcpSource: field !== null ? 'field' : aggregate.labMetrics.lcpMs !== null ? 'lab' : null,
    topIssue: top
      ? { auditId: top.auditId, title: top.title, affectedCount: top.affectedCount, sampledCount: top.sampledCount }
      : null,
  };
}

/**
 * A registry template that has no stored aggregate for this device. It is shown so that a template that
 * was never measured is visible instead of silently missing. Returns null for an unknown brand.
 */
export function toUnmeasuredRow(template: TemplateRegistryEntry, device: Device): OverviewRow | null {
  const brand = brandSchema.safeParse(template.brand);
  if (!brand.success) return null;
  const problems = [...new Set([...(template.problems ?? []), ...validateTemplate(template)])];
  return {
    templateId: template.templateId,
    templateName: template.templateName,
    brand: brand.data,
    device,
    status: problems.length ? 'invalid' : 'not-measured',
    problems,
    runId: null,
    generatedAt: null,
    urlsMeasured: 0,
    urlCount: template.sampleUrls.length,
    performance: null,
    accessibility: null,
    lcpMs: null,
    lcpSource: null,
    topIssue: null,
  };
}

/** Lowest performance first (unmeasured last), so developers see where to start. */
export function sortOverview(rows: OverviewRow[]): OverviewRow[] {
  return [...rows].sort((a, b) => {
    if (a.performance === null && b.performance !== null) return 1;
    if (b.performance === null && a.performance !== null) return -1;
    return (a.performance ?? 0) - (b.performance ?? 0) || a.brand.localeCompare(b.brand) || a.templateName.localeCompare(b.templateName);
  });
}

export async function getOverview(filters: { brand?: Brand; device: Device }): Promise<OverviewRow[]> {
  const source = getDataSource();
  const [aggregates, templates] = await Promise.all([source.getLatestAggregates(), source.listTemplates()]);
  const byId = new Map(templates.map((t) => [t.templateId, t]));
  const forDevice = aggregates.filter((a) => a.device === filters.device);
  const measured = forDevice
    .filter((a) => !filters.brand || a.brand === filters.brand)
    .map((a) => toOverviewRow(a, byId.get(a.templateId)));
  const measuredIds = new Set(forDevice.map((a) => a.templateId));
  const unmeasured = templates
    .filter((t) => t.active && !measuredIds.has(t.templateId) && (!filters.brand || t.brand === filters.brand))
    .map((t) => toUnmeasuredRow(t, filters.device))
    .filter((row): row is OverviewRow => row !== null);
  return sortOverview([...measured, ...unmeasured]);
}