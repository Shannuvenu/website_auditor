import type { Device, RunRecord } from '@/lib/validation/schemas';
import { loadMockFixtures } from '@/lib/mock/fixtures';
import type { DataSource } from './source';

// In-memory only: retests queued in mock mode are remembered until the server restarts.
const queuedRetests: RunRecord[] = [];

/** Serves the synthetic demo data. Nothing here talks to Google or the network. */
export const mockSource: DataSource = {
  kind: 'mock',

  async listTemplates() {
    return loadMockFixtures().templates;
  },

  async getLatestAggregates() {
    const { aggregates } = loadMockFixtures();
    const latest = new Map<string, (typeof aggregates)[number]>();
    for (const a of aggregates) {
      const key = `${a.templateId}|${a.device}`;
      const current = latest.get(key);
      if (!current || a.generatedAt > current.generatedAt) latest.set(key, a);
    }
    return [...latest.values()];
  },

  async getAggregateHistory(templateId, device, limit) {
    return loadMockFixtures()
      .aggregates.filter((a) => a.templateId === templateId && a.device === device)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .slice(0, limit);
  },

  async listRuns(filters) {
    return [...queuedRetests, ...loadMockFixtures().runs]
      .filter((r) => (!filters.brand || r.brand === filters.brand) && (!filters.templateId || r.templateId === filters.templateId))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, filters.limit ?? 100);
  },

  async enqueueRetest({ templateId, device, requestedBy }) {
    const template = loadMockFixtures().templates.find((t) => t.templateId === templateId && t.active);
    if (!template) throw new Error('Template not found');
    const devices: Device[] = device === 'both' ? ['mobile', 'desktop'] : [device];
    const results = devices.map((d) => {
      const runId = `mock-retest-${Date.now().toString(36)}-${d}`;
      queuedRetests.push({
        runId,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        trigger: 'retest',
        requestedBy,
        brand: template.brand,
        templateId,
        device: d,
        status: 'queued',
        urlCount: template.sampleUrls.length,
        urlsDone: 0,
        urlsFailed: 0,
        summary: null,
        error: 'Demo mode: no measurement is collected. Connect Apps Script to run real re-tests.',
      });
      return { device: d, enqueued: true, runId, reason: null };
    });
    return { results };
  },
};
