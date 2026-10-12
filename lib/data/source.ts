import type { Device, RetestResult, RunRecord, TemplateAggregate, TemplateRegistryEntry } from '@/lib/validation/schemas';

export interface RunFilters {
  brand?: string;
  templateId?: string;
  limit?: number;
}

export interface DataSource {
  readonly kind: 'apps-script' | 'mock';
  listTemplates(): Promise<TemplateRegistryEntry[]>;
  /** Latest aggregate per template and device. */
  getLatestAggregates(): Promise<TemplateAggregate[]>;
  /** Newest first. */
  getAggregateHistory(templateId: string, device: Device, limit: number): Promise<TemplateAggregate[]>;
  listRuns(filters: RunFilters): Promise<RunRecord[]>;
  enqueueRetest(input: { templateId: string; device: Device | 'both'; requestedBy: string }): Promise<RetestResult>;
}
