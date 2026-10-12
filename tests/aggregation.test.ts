import { describe, expect, it } from 'vitest';
import { loadAppsScript, plain } from '../scripts/appsScriptVm';
import type { TemplateAggregate } from '@/lib/validation/schemas';

const gs = loadAppsScript();
const median = gs.Aggregation_median_ as (v: unknown[]) => number | null;
const aggregate = gs.Aggregation_aggregate_ as (input: unknown) => unknown;

interface RowSpec { url: string; run: number; perf: number; audits?: unknown[]; crux?: [string, number | null] }

const audit = (id: string, savingsMs: number | null, resource = '', savingsBytes: number | null = null) => ({
  id, title: id.toUpperCase(), category: 'performance', score: 0, savingsMs, savingsBytes,
  items: resource ? [{ resource, wastedMs: null, wastedBytes: null }] : [],
});

const row = (s: RowSpec) => ({
  runId: 'r1', templateId: 'T', brand: 'DH', device: 'mobile', url: s.url, runIndex: s.run, status: 'ok',
  performance: s.perf, accessibility: 90, lcpMs: 3000, cls: 0.1, tbtMs: 200, fcpMs: 1500, speedIndexMs: 3000,
  cruxScope: s.crux?.[0] ?? 'none', cruxLcpMs: s.crux?.[1] ?? null, cruxCls: null, cruxInpMs: null, audits: s.audits ?? [],
});

const run = (rows: unknown[], planned = ['u1', 'u2', 'u3', 'u4']) =>
  plain<TemplateAggregate>(aggregate({
    template: { templateId: 'T', templateName: 'T', brand: 'DH' }, device: 'mobile', runId: 'r1', trigger: 'scheduled',
    generatedAt: '2026-10-06T00:00:00.000Z', plannedUrls: planned, rows, maxAudits: 40,
  }));

describe('median', () => {
  it('handles odd, even, empty and null input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([null, undefined, 5])).toBe(5);
  });
});

describe('template aggregation', () => {
  const rows = [
    ...['u1', 'u2', 'u3', 'u4'].flatMap((u, i) => [
      row({ url: u, run: 1, perf: 40 + i * 10, audits: i < 3 ? [audit('hero', 1000 + i * 100, '/hero.jpg'), audit('css', 300, '/main.css?v=' + i)] : [audit('css', 500, '/main.css')] }),
      row({ url: u, run: 2, perf: 40 + i * 10, audits: i < 3 ? [audit('hero', 1000 + i * 100, '/hero.jpg'), audit('css', 300, '/main.css?v=' + i)] : [audit('css', 500, '/main.css')] }),
      row({ url: u, run: 3, perf: 40 + i * 10, audits: i < 3 ? [audit('hero', 1000 + i * 100, '/hero.jpg'), audit('css', 300, '/main.css?v=' + i)] : [audit('css', 500, '/main.css')] }),
    ]),
  ];
  const agg = run(rows);

  it('takes the median performance across URLs', () => {
    expect(agg.scores.performance).toBe(55); // URL scores 40, 50, 60, 70
    expect(agg.urlsMeasured).toBe(4);
    expect(agg.runsPerUrl).toBe(3);
  });

  it('computes affected URL count and percentage', () => {
    const hero = agg.audits.find((a) => a.auditId === 'hero')!;
    expect(hero.affectedCount).toBe(3);
    expect(hero.sampledCount).toBe(4);
    expect(hero.affectedShare).toBe(0.75);
    expect(agg.audits.find((a) => a.auditId === 'css')!.affectedShare).toBe(1);
  });

  it('computes median savings over the affected URLs only', () => {
    expect(agg.audits.find((a) => a.auditId === 'hero')!.medianSavingsMs).toBe(1100); // 1000, 1100, 1200
    expect(agg.audits.find((a) => a.auditId === 'css')!.medianSavingsMs).toBe(300); // 300, 300, 300, 500
  });

  it('finds repeated offenders, ignoring query strings', () => {
    const css = agg.audits.find((a) => a.auditId === 'css')!;
    expect(css.repeatedOffenders).toEqual([{ resource: '/main.css', urlCount: 4 }]);
  });

  it('sorts audits by affected count, then savings, deterministically', () => {
    expect(agg.audits.map((a) => a.auditId)).toEqual(['css', 'hero']);
    expect(run(rows)).toEqual(agg);
  });

  it('lists representative URLs nearest the median', () => {
    expect(agg.representativeUrls).toHaveLength(3);
    expect(agg.representativeUrls).toContain('u2');
  });
});

describe('median run selection and data quality', () => {
  it('uses the median-performance run of each URL and ignores errored runs', () => {
    const rows = [
      row({ url: 'u1', run: 1, perf: 30, audits: [audit('a', 100)] }),
      row({ url: 'u1', run: 2, perf: 50, audits: [audit('b', 100)] }),
      row({ url: 'u1', run: 3, perf: 90 }),
      { ...row({ url: 'u1', run: 4, perf: 1 }), status: 'error' },
    ];
    const agg = run(rows, ['u1']);
    expect(agg.scores.performance).toBe(50);
    expect(agg.audits.map((a) => a.auditId)).toEqual(['b']);
  });

  it('keeps the last row when a (url, run) pair was written twice', () => {
    const agg = run([row({ url: 'u1', run: 1, perf: 10 }), row({ url: 'u1', run: 1, perf: 80 })], ['u1']);
    expect(agg.scores.performance).toBe(80);
  });

  it('measures share against URLs that produced data, not planned URLs', () => {
    const agg = run([row({ url: 'u1', run: 1, perf: 50, audits: [audit('a', 100)] }), row({ url: 'u2', run: 1, perf: 50 })], ['u1', 'u2', 'u3', 'u4']);
    expect(agg.urlCount).toBe(4);
    expect(agg.urlsMeasured).toBe(2);
    expect(agg.audits[0].affectedShare).toBe(0.5);
  });

  it('returns an empty aggregate when nothing was measured', () => {
    const agg = run([], ['u1']);
    expect(agg.urlsMeasured).toBe(0);
    expect(agg.scores.performance).toBeNull();
    expect(agg.audits).toEqual([]);
  });

  it('prefers URL-level CrUX and falls back to origin-level', () => {
    const withUrl = run([row({ url: 'u1', run: 1, perf: 50, crux: ['url', 4000] }), row({ url: 'u2', run: 1, perf: 50, crux: ['origin', 9000] })]);
    expect(withUrl.crux).toMatchObject({ scope: 'url', lcpMs: 4000, urlCount: 1 });
    const originOnly = run([row({ url: 'u1', run: 1, perf: 50, crux: ['origin', 3000] })]);
    expect(originOnly.crux.scope).toBe('origin');
    expect(run([row({ url: 'u1', run: 1, perf: 50 })]).crux.scope).toBe('none');
  });

  it('shrinks the aggregate JSON to fit a sheet cell', () => {
    const many = Array.from({ length: 30 }, (_, i) => audit(`audit-${i}`, i + 1, `/r${i}.js`));
    const big = run([row({ url: 'u1', run: 1, perf: 50, audits: many })], ['u1']);
    const fit = plain<TemplateAggregate>((gs.Aggregation_fitToCell_ as (a: unknown, n: number) => unknown)(big, 3000));
    expect(JSON.stringify(fit).length).toBeLessThanOrEqual(3000);
    expect(fit.audits.length).toBeLessThan(big.audits.length);
  });
});
