import { z } from 'zod';
import { callAppsScript } from '@/lib/apps-script/client';
import {
  retestResultSchema,
  runRecordSchema,
  templateAggregateSchema,
  templateRegistryEntrySchema,
} from '@/lib/validation/schemas';
import type { DataSource } from './source';

export const appsScriptSource: DataSource = {
  kind: 'apps-script',

  async listTemplates() {
    const data = await callAppsScript('templates', {}, z.object({ templates: z.array(templateRegistryEntrySchema) }), { cacheable: true });
    return data.templates;
  },

  async getLatestAggregates() {
    const data = await callAppsScript('aggregates', {}, z.object({ aggregates: z.array(templateAggregateSchema) }), { cacheable: true });
    return data.aggregates;
  },

  async getAggregateHistory(templateId, device, limit) {
    const data = await callAppsScript(
      'aggregate-history',
      { templateId, device, limit },
      z.object({ aggregates: z.array(templateAggregateSchema) }),
      { cacheable: true },
    );
    return data.aggregates;
  },

  async listRuns(filters) {
    const data = await callAppsScript(
      'runs',
      { limit: filters.limit ?? 100, brand: filters.brand, templateId: filters.templateId },
      z.object({ runs: z.array(runRecordSchema) }),
      { cacheable: true },
    );
    return data.runs;
  },

  async enqueueRetest(input) {
    return callAppsScript('retest', { templateId: input.templateId, device: input.device, requestedBy: input.requestedBy }, retestResultSchema);
  },
};
