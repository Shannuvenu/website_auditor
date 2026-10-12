import { beforeAll, describe, expect, it } from 'vitest';
import { generateMockFixtures } from '../scripts/mock-generator';
import fixturesJson from '@/lib/mock/fixtures.generated.json';
import { getDataSource } from '@/lib/data';
import { loadMockFixtures } from '@/lib/mock/fixtures';
import { analyzeTemplate } from '@/lib/services/analysis';
import { compareAggregates } from '@/lib/services/compare';
import { getTemplateDetail } from '@/lib/services/detail';
import { getOverview } from '@/lib/services/overview';
import { validateTemplate } from '@/lib/templates/registry';
import { templateAggregateSchema } from '@/lib/validation/schemas';

beforeAll(() => {
  process.env.DATA_SOURCE = 'mock';
  process.env.AI_PROVIDER = 'mock';
});

describe('mock dataset', () => {
  it('is in sync with the generator and the real Aggregation.gs (run npm run mock:generate after changing either)', () => {
    expect(generateMockFixtures()).toEqual(fixturesJson);
  });

  it('contains valid aggregates and a valid registry', () => {
    const { aggregates, templates } = loadMockFixtures();
    aggregates.forEach((a) => expect(templateAggregateSchema.safeParse(a).success).toBe(true));
    templates.forEach((t) => expect(validateTemplate(t)).toEqual([]));
  });
});

describe('end-to-end flow: registry -> aggregates -> overview -> detail -> analysis -> ranking -> history', () => {
  it('overview lists the latest aggregate per template, lowest performance first, with filters', async () => {
    const rows = await getOverview({ device: 'mobile' });
    expect(rows).toHaveLength(6);
    const perf = rows.map((r) => r.performance as number);
    expect([...perf].sort((a, b) => a - b)).toEqual(perf);
    expect(rows[0].topIssue?.title).toBeTruthy();
    expect((await getOverview({ device: 'mobile', brand: 'PV' })).every((r) => r.brand === 'PV')).toBe(true);
    expect((await getOverview({ device: 'desktop' })).every((r) => r.device === 'desktop')).toBe(true);
  });

  it('detail loads history and compares the latest run with the previous one', async () => {
    const detail = await getTemplateDetail('DH_ARTICLE', 'mobile');
    expect(detail?.aggregate.trigger).toBe('retest'); // latest is the post-fix re-test
    expect(detail?.history.length).toBe(4);
    expect(detail?.comparison?.sameSampleSet).toBe(true);
    const lcpImage = detail?.comparison?.audits.find((a) => a.auditId === 'prioritize-lcp-image');
    expect(['resolved', 'improved']).toContain(lcpImage?.change);
    expect(await getTemplateDetail('NOPE', 'mobile')).toBeNull();
  });

  it('analysis returns validated, ranked fixes with evidence', async () => {
    const result = await analyzeTemplate('DH_GALLERY', 'mobile');
    if (result?.status !== 'ok') throw new Error('expected ok');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.rejected).toEqual([]);
    const scores = result.issues.map((i) => i.priority.score ?? -1);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    result.issues.forEach((i) => expect(i.evidence.length).toBe(i.audit_ids.length));
  });

  it('re-test in demo mode queues a run that shows up in run history and is not measured', async () => {
    const source = getDataSource();
    const res = await source.enqueueRetest({ templateId: 'DH_SECTION', device: 'both', requestedBy: 'dev' });
    expect(res.results.map((r) => r.device)).toEqual(['mobile', 'desktop']);
    const runs = await source.listRuns({ templateId: 'DH_SECTION' });
    expect(runs[0]).toMatchObject({ status: 'queued', trigger: 'retest', requestedBy: 'dev' });
    await expect(source.enqueueRetest({ templateId: 'MISSING', device: 'mobile', requestedBy: 'dev' })).rejects.toThrow();
  });

  it('run history shows completed, partial and failed runs', async () => {
    const statuses = new Set((await getDataSource().listRuns({ limit: 500 })).map((r) => r.status));
    expect(statuses).toContain('completed');
    expect(statuses).toContain('partial');
    expect(statuses).toContain('failed');
  });
});

describe('comparison', () => {
  it('reports score deltas and per-audit changes without raising alerts', async () => {
    const [latest, previous] = await getDataSource().getAggregateHistory('DH_ARTICLE', 'mobile', 2);
    const cmp = compareAggregates(previous, latest);
    expect(cmp.performanceDelta).toBe((latest.scores.performance as number) - (previous.scores.performance as number));
    expect(cmp.afterRunId).toBe(latest.runId);
  });
});
