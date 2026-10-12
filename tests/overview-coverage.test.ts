import { describe, expect, it } from 'vitest';
import { sortOverview, toUnmeasuredRow } from '@/lib/services/overview';
import type { TemplateRegistryEntry } from '@/lib/validation/schemas';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://www.deccanherald.com/business/story-${i + 1}`);

const template = (over: Partial<TemplateRegistryEntry> = {}): TemplateRegistryEntry => ({
  templateId: 'DH_BUSINESS',
  templateName: 'Business',
  brand: 'DH',
  urlPattern: '/business/*',
  sampleUrls: urls(5),
  active: true,
  trafficWeight: null,
  ...over,
});

describe('overview rows for registry templates without a measurement', () => {
  it('marks a valid template that has never run as not-measured, with no invented numbers', () => {
    const row = toUnmeasuredRow(template(), 'mobile');
    expect(row?.status).toBe('not-measured');
    expect(row?.problems).toEqual([]);
    expect(row?.performance).toBeNull();
    expect(row?.accessibility).toBeNull();
    expect(row?.lcpMs).toBeNull();
    expect(row?.runId).toBeNull();
    expect(row?.generatedAt).toBeNull();
    expect(row?.urlsMeasured).toBe(0);
    expect(row?.urlCount).toBe(5);
  });

  it('marks a template that fails registry validation as invalid and reports why', () => {
    const row = toUnmeasuredRow(template({ sampleUrls: urls(2) }), 'desktop');
    expect(row?.status).toBe('invalid');
    expect(row?.problems.join(' ')).toMatch(/5 to 10 sample URLs/);
    expect(row?.device).toBe('desktop');
  });

  it('flags a sample URL on the wrong brand host as invalid', () => {
    const row = toUnmeasuredRow(template({ sampleUrls: [...urls(4), 'https://www.prajavani.net/business/story-9'] }), 'mobile');
    expect(row?.status).toBe('invalid');
  });

  it('returns null for an unknown brand instead of guessing', () => {
    expect(toUnmeasuredRow(template({ brand: 'XX' }), 'mobile')).toBeNull();
  });

  it('sorts unmeasured rows after measured ones', () => {
    const measured = { ...toUnmeasuredRow(template({ templateId: 'DH_A', templateName: 'A' }), 'mobile')!, performance: 80, status: 'measured' as const };
    const missing = toUnmeasuredRow(template(), 'mobile')!;
    expect(sortOverview([missing, measured]).map((r) => r.templateId)).toEqual(['DH_A', 'DH_BUSINESS']);
  });
});