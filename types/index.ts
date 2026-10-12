export type {
  AggregatedAudit,
  Brand,
  Device,
  RetestResult,
  RunRecord,
  TemplateAggregate,
  TemplateRegistryEntry,
} from '@/lib/validation/schemas';

export type Effort = 'S' | 'M' | 'L';
export type Confidence = 'High' | 'Medium' | 'Low';
export type Role = 'ADMIN' | 'DEVELOPER';
