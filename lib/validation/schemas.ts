import { z } from 'zod';

export const DEVICES = ['mobile', 'desktop'] as const;
export const BRANDS = ['DH', 'PV'] as const;

export const deviceSchema = z.enum(DEVICES);
export const brandSchema = z.enum(BRANDS);

const nullableNumber = z.number().finite().nullable();

export const repeatedOffenderSchema = z.object({
  resource: z.string(),
  urlCount: z.number().int().positive(),
});

export const aggregatedAuditSchema = z.object({
  auditId: z.string().min(1),
  title: z.string(),
  category: z.enum(['performance', 'accessibility']),
  affectedCount: z.number().int().nonnegative(),
  sampledCount: z.number().int().positive(),
  affectedShare: z.number().min(0).max(1),
  affectedUrls: z.array(z.string()),
  medianSavingsMs: nullableNumber,
  medianSavingsBytes: nullableNumber,
  repeatedOffenders: z.array(repeatedOffenderSchema),
});

export const templateAggregateSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  templateId: z.string().min(1),
  templateName: z.string(),
  brand: brandSchema,
  device: deviceSchema,
  trigger: z.enum(['scheduled', 'retest']),
  generatedAt: z.string(),
  urlCount: z.number().int().nonnegative(),
  urlsMeasured: z.number().int().nonnegative(),
  runsPerUrl: z.number().int().nonnegative(),
  scores: z.object({ performance: nullableNumber, accessibility: nullableNumber }),
  labMetrics: z.object({
    lcpMs: nullableNumber,
    cls: nullableNumber,
    tbtMs: nullableNumber,
    fcpMs: nullableNumber,
    speedIndexMs: nullableNumber,
  }),
  crux: z.object({
    scope: z.enum(['url', 'origin', 'none']),
    lcpMs: nullableNumber,
    cls: nullableNumber,
    inpMs: nullableNumber,
    urlCount: z.number().int().nonnegative(),
  }),
  sampleUrls: z.array(z.string()),
  representativeUrls: z.array(z.string()),
  audits: z.array(aggregatedAuditSchema),
});

export const templateRegistryEntrySchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  brand: z.string(),
  urlPattern: z.string(),
  sampleUrls: z.array(z.string()),
  active: z.boolean(),
  trafficWeight: z.number().positive().nullable(),
  notes: z.string().optional(),
  problems: z.array(z.string()).optional(),
});

export const RUN_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed'] as const;

export const runRecordSchema = z.object({
  runId: z.string(),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  trigger: z.enum(['scheduled', 'retest']),
  requestedBy: z.string().nullable(),
  brand: z.string(),
  templateId: z.string(),
  device: deviceSchema,
  status: z.enum(RUN_STATUSES),
  urlCount: z.number().int().nonnegative(),
  urlsDone: z.number().int().nonnegative(),
  urlsFailed: z.number().int().nonnegative(),
  summary: z
    .object({
      urlsMeasured: z.number().optional(),
      performance: nullableNumber.optional(),
      accessibility: nullableNumber.optional(),
      lcpMs: nullableNumber.optional(),
      failingAudits: z.number().optional(),
    })
    .nullable(),
  error: z.string().nullable(),
});

export const retestResultSchema = z.object({
  results: z.array(
    z.object({
      device: deviceSchema,
      enqueued: z.boolean(),
      runId: z.string().nullable().optional(),
      reason: z.string().nullable().optional(),
    }),
  ),
});

export type Device = z.infer<typeof deviceSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type AggregatedAudit = z.infer<typeof aggregatedAuditSchema>;
export type TemplateAggregate = z.infer<typeof templateAggregateSchema>;
export type TemplateRegistryEntry = z.infer<typeof templateRegistryEntrySchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type RetestResult = z.infer<typeof retestResultSchema>;
