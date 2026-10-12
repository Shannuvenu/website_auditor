import { describe, expect, it } from 'vitest';
import { loadAppsScript, plain } from '../scripts/appsScriptVm';

const gs = loadAppsScript();
const parse = (json: unknown, threshold?: number) => plain<any>((gs.PageSpeed_parse_ as (j: unknown, t?: number) => unknown)(json, threshold)); // eslint-disable-line @typescript-eslint/no-explicit-any
const cruxParse = gs.Crux_parse_ as (b: unknown) => unknown;

const psi = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.47, auditRefs: [{ id: 'largest-contentful-paint', group: 'metrics' }, { id: 'render-blocking-resources' }, { id: 'passed-audit' }, { id: 'info-audit' }] },
      accessibility: { score: 0.9, auditRefs: [{ id: 'color-contrast' }, { id: 'na-audit' }] },
    },
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', title: 'LCP', score: 0.1, scoreDisplayMode: 'numeric', numericValue: 5100 },
      'cumulative-layout-shift': { numericValue: 0.14 },
      'total-blocking-time': { numericValue: 320 },
      'render-blocking-resources': {
        id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', score: 0.2, scoreDisplayMode: 'metricSavings',
        details: { type: 'opportunity', overallSavingsMs: 640.4, items: [{ url: 'https://x/a.css?v=1', wastedMs: 300, wastedBytes: 2048 }, { url: 'https://x/b.css', wastedMs: 340, wastedBytes: 1024 }] },
      },
      'passed-audit': { id: 'passed-audit', title: 'ok', score: 1, scoreDisplayMode: 'binary' },
      'info-audit': { id: 'info-audit', title: 'info', score: null, scoreDisplayMode: 'informative' },
      'color-contrast': { id: 'color-contrast', title: 'Contrast', score: 0, scoreDisplayMode: 'binary', details: { type: 'table', items: [{ node: { snippet: '<p class="x">' } }] } },
      'na-audit': { id: 'na-audit', title: 'na', score: null, scoreDisplayMode: 'notApplicable' },
    },
  },
};

describe('PageSpeed parsing', () => {
  const out = parse(psi);

  it('extracts category scores and lab metrics', () => {
    expect(out).toMatchObject({ performance: 47, accessibility: 90, lcpMs: 5100, cls: 0.14, tbtMs: 320 });
  });

  it('keeps only failing, scored audits and skips metrics, passed, informative and n/a', () => {
    expect(out.audits.map((a: { id: string }) => a.id)).toEqual(['render-blocking-resources', 'color-contrast']);
  });

  it('extracts savings and offender rows', () => {
    const rb = out.audits[0];
    expect(rb.savingsMs).toBe(640);
    expect(rb.savingsBytes).toBe(3072);
    expect(rb.items).toHaveLength(2);
    expect(rb.items[0].resource).toBe('https://x/a.css?v=1');
    expect(out.audits[1].savingsMs).toBeNull();
  });

  it('honours the fail threshold', () => {
    expect(parse(psi, 0.1).audits.map((a: { id: string }) => a.id)).toEqual(['color-contrast']);
  });

  it('throws on unusable responses', () => {
    expect(() => parse({})).toThrow(/lighthouseResult/);
    expect(() => parse({ lighthouseResult: { runtimeError: { code: 'FAILED_DOCUMENT_REQUEST' } } })).toThrow(/runtime error/i);
  });
});

describe('CrUX parsing', () => {
  it('reads p75 values, including the string CLS value', () => {
    const body = { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 4300 } }, cumulative_layout_shift: { percentiles: { p75: '0.14' } }, interaction_to_next_paint: { percentiles: { p75: 240 } } } } };
    expect(plain(cruxParse(body))).toEqual({ lcpMs: 4300, cls: 0.14, inpMs: 240 });
  });

  it('returns null when there is no data', () => {
    expect(cruxParse({})).toBeNull();
    expect(cruxParse({ record: { metrics: {} } })).toBeNull();
  });
});
