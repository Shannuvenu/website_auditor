import { describe, expect, it } from 'vitest';
import { analyzeAggregate, rankIssues } from '@/lib/llm/analyze';
import { buildLlmInput, type LlmInput } from '@/lib/llm/prompt';
import type { LlmProvider } from '@/lib/llm/provider';
import { extractNumbers, validateAnalysis } from '@/lib/validation/grounding';
import type { TemplateAggregate } from '@/lib/validation/schemas';

const urls = Array.from({ length: 10 }, (_, i) => `https://www.deccanherald.com/article/s-${i + 1}`);

const aggregate: TemplateAggregate = {
  schemaVersion: 1, runId: 'run-1', templateId: 'DH_ARTICLE', templateName: 'Article', brand: 'DH', device: 'mobile', trigger: 'scheduled',
  generatedAt: '2026-10-06T00:00:00.000Z', urlCount: 10, urlsMeasured: 10, runsPerUrl: 3,
  scores: { performance: 47, accessibility: 90 },
  labMetrics: { lcpMs: 5100, cls: 0.14, tbtMs: 320, fcpMs: 2100, speedIndexMs: 4800 },
  crux: { scope: 'url', lcpMs: 4300, cls: 0.14, inpMs: 240, urlCount: 4 },
  sampleUrls: urls, representativeUrls: urls.slice(0, 3),
  audits: [
    { auditId: 'prioritize-lcp-image', title: 'Preload LCP image', category: 'performance', affectedCount: 8, sampledCount: 10, affectedShare: 0.8, affectedUrls: urls.slice(0, 8), medianSavingsMs: 1100, medianSavingsBytes: null, repeatedOffenders: [{ resource: 'https://www.deccanherald.com/media/hero.jpg', urlCount: 8 }] },
    { auditId: 'render-blocking-resources', title: 'Eliminate render-blocking resources', category: 'performance', affectedCount: 10, sampledCount: 10, affectedShare: 1, affectedUrls: urls, medianSavingsMs: 600, medianSavingsBytes: null, repeatedOffenders: [] },
    { auditId: 'unsized-images', title: 'Images lack width and height', category: 'performance', affectedCount: 6, sampledCount: 10, affectedShare: 0.6, affectedUrls: urls.slice(0, 6), medianSavingsMs: null, medianSavingsBytes: null, repeatedOffenders: [] },
  ],
};
const input: LlmInput = buildLlmInput(aggregate, 100000);

const good = {
  issue: 'Preload the hero image',
  audit_ids: ['prioritize-lcp-image'],
  affected_urls: urls.slice(0, 3),
  likely_cause: 'The hero image is likely discovered late by the browser (8 of 10 sample URLs).',
  proposed_change: 'Add a preload for the hero image and remove lazy-loading on it.',
  effort: 'M',
  confidence: 'High',
  verify_step: 'Re-run the same sample URLs and compare the prioritize-lcp-image audit.',
};
const run = (...issues: unknown[]) => validateAnalysis(JSON.stringify({ issues }), input);

describe('LLM output schema validation', () => {
  it('accepts a well-formed, grounded issue', () => {
    const out = run(good);
    expect(out.issues).toHaveLength(1);
    expect(out.rejected).toEqual([]);
  });

  it('normalises confidence case and strips code fences', () => {
    const out = validateAnalysis('```json\n' + JSON.stringify({ issues: [{ ...good, confidence: 'high' }] }) + '\n```', input);
    expect(out.issues[0].confidence).toBe('High');
  });

  it('rejects unusable top-level output', () => {
    expect(validateAnalysis('not json', input).schemaError).toBeTruthy();
    expect(validateAnalysis('{"foo":1}', input).schemaError).toBeTruthy();
    expect(validateAnalysis('[]', input).schemaError).toBeTruthy();
  });

  it.each([
    ['effort outside S/M/L', { effort: 'XL' }],
    ['confidence outside High/Medium/Low', { confidence: 'certain' }],
    ['missing verify_step', { verify_step: undefined }],
    ['empty audit_ids', { audit_ids: [] }],
    ['extra keys', { priority: 999 }],
  ])('drops an issue with %s', (_name, patch) => {
    const out = run({ ...good, ...patch });
    expect(out.issues).toHaveLength(0);
    expect(out.rejected[0].reason).toMatch(/schema/);
  });
});

describe('grounding: invalid audits, URLs and numbers are dropped', () => {
  it('rejects an invented audit id', () => {
    const out = run({ ...good, audit_ids: ['prioritize-lcp-image', 'made-up-audit'] });
    expect(out.issues).toHaveLength(0);
    expect(out.rejected[0].reason).toMatch(/made-up-audit/);
  });

  it('rejects a URL outside the sample set', () => {
    const out = run({ ...good, affected_urls: ['https://www.deccanherald.com/article/other'] });
    expect(out.rejected[0].reason).toMatch(/not in the sample set/);
  });

  it('rejects an in-sample URL that the cited audit did not flag', () => {
    const out = run({ ...good, affected_urls: [urls[9]] });
    expect(out.rejected[0].reason).toMatch(/not affected by any cited audit/);
  });

  it('rejects invented numbers but allows numbers present in the input', () => {
    expect(run({ ...good, likely_cause: 'Costs 2300 ms of LCP.' }).rejected[0].reason).toMatch(/2300/);
    expect(run({ ...good, likely_cause: 'About 1100 ms median savings, 80% of URLs, 4.3 s p75 LCP, 1.1 s.' }).issues).toHaveLength(1);
  });

  it('keeps valid issues when others in the same response are invalid', () => {
    const out = run(good, { ...good, issue: 'Bad', audit_ids: ['nope'] });
    expect(out.issues).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
  });

  it('ignores numbers inside URLs and audit ids', () => {
    expect(extractNumbers('See https://x.com/a1234 and audit uses-h2 with 8 of 10', ['uses-h2'])).toEqual(['8', '10']);
  });
});

describe('analysis pipeline', () => {
  const provider = (output: unknown): LlmProvider => ({ name: 'test', model: `m-${Math.random()}`, complete: async () => (typeof output === 'string' ? output : JSON.stringify(output)) });

  it('ranks validated issues by code-computed priority and attaches evidence', async () => {
    const out = await analyzeAggregate(aggregate, {
      provider: provider({
        issues: [
          { ...good, issue: 'Fix sizes', audit_ids: ['unsized-images'], affected_urls: [urls[0]], effort: 'S', likely_cause: 'unknown', proposed_change: 'Set width and height on images.' },
          good,
          { ...good, issue: 'Render blocking', audit_ids: ['render-blocking-resources'], affected_urls: urls.slice(0, 2), likely_cause: 'unknown', effort: 'L', proposed_change: 'Defer render-blocking stylesheets.' },
        ],
      }),
    });
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.issues.map((i) => i.issue)).toEqual(['Preload the hero image', 'Render blocking', 'Fix sizes']);
    expect(out.issues[0].priority.score).toBeCloseTo((1100 * 0.8) / 2);
    expect(out.issues[2].priority.basis).toBe('unquantified');
    expect(out.issues[0].evidence[0].auditId).toBe('prioritize-lcp-image');
  });

  it('retries once on malformed JSON, then reports failure', async () => {
    let calls = 0;
    const flaky: LlmProvider = { name: 'flaky', model: 'x', complete: async () => (++calls === 1 ? 'oops' : JSON.stringify({ issues: [good] })) };
    expect((await analyzeAggregate(aggregate, { provider: flaky })).status).toBe('ok');
    const broken = await analyzeAggregate(aggregate, { provider: { name: 'b', model: 'x', complete: async () => 'nope' } });
    expect(broken.status).toBe('failed');
  });

  it('reports provider errors without leaking details', async () => {
    const failing: LlmProvider = { name: 'f', model: 'x', complete: async () => { throw new Error('HTTP 429 slow down'); } };
    const out = await analyzeAggregate(aggregate, { provider: failing });
    expect(out).toMatchObject({ status: 'failed' });
  });

  it('is unavailable without a provider', async () => {
    expect((await analyzeAggregate(aggregate, { provider: null })).status).toBe('unavailable');
  });

  it('rankIssues drops cited audits that are not in the aggregate evidence', () => {
    expect(rankIssues([good as never], aggregate, 1)[0].evidence).toHaveLength(1);
  });
});
