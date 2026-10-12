import { describe, expect, it } from 'vitest';
import { loadAppsScript } from '../scripts/appsScriptVm';
import vectors from './fixtures/pattern-vectors.json';
import { matchesPattern } from '@/lib/templates/pattern';
import { matchTemplate, validateSampleUrl, validateTemplate } from '@/lib/templates/registry';
import type { TemplateRegistryEntry } from '@/lib/validation/schemas';

const gs = loadAppsScript();
const gsMatch = gs.Templates_matchesPattern_ as (p: string, pattern: string) => boolean;

const tpl = (over: Partial<TemplateRegistryEntry> = {}): TemplateRegistryEntry => ({
  templateId: 'DH_ARTICLE',
  templateName: 'Article',
  brand: 'DH',
  urlPattern: '/article/*',
  sampleUrls: [1, 2, 3, 4, 5].map((i) => `https://www.deccanherald.com/article/s-${i}`),
  active: true,
  trafficWeight: null,
  ...over,
});

describe('URL pattern matching', () => {
  it.each(vectors)('TypeScript: $pattern vs $path', ({ pattern, path, match }) => {
    expect(matchesPattern(path, pattern)).toBe(match);
  });

  it.each(vectors)('Apps Script (must agree): $pattern vs $path', ({ pattern, path, match }) => {
    expect(gsMatch(path, pattern)).toBe(match);
  });

  it('rejects patterns that do not start with a slash', () => {
    expect(() => matchesPattern('/x', 'article/*')).toThrow();
  });
});

describe('template matching', () => {
  const templates = [
    tpl(),
    tpl({ templateId: 'DH_FEATURE', templateName: 'Feature', urlPattern: '/article/feature-*' }),
    tpl({ templateId: 'PV_ARTICLE', brand: 'PV', urlPattern: '/article/*' }),
    tpl({ templateId: 'DH_OLD', urlPattern: '/article/*', active: false }),
  ];

  it('picks the most specific pattern', () => {
    expect(matchTemplate('https://www.deccanherald.com/article/feature-x', templates)?.templateId).toBe('DH_FEATURE');
    expect(matchTemplate('https://www.deccanherald.com/article/other', templates)?.templateId).toBe('DH_ARTICLE');
  });

  it('is scoped by brand host', () => {
    expect(matchTemplate('https://www.prajavani.net/article/x', templates)?.templateId).toBe('PV_ARTICLE');
  });

  it('ignores inactive templates, unknown hosts and invalid URLs', () => {
    expect(matchTemplate('https://example.com/article/x', templates)).toBeNull();
    expect(matchTemplate('not a url', templates)).toBeNull();
    expect(matchTemplate('https://www.deccanherald.com/video/x', templates)).toBeNull();
  });
});

describe('sample URL and registry validation (SSRF guard)', () => {
  it('accepts brand-host https URLs', () => {
    expect(validateSampleUrl('https://www.deccanherald.com/article/x', 'DH').ok).toBe(true);
  });

  it.each([
    ['http://www.deccanherald.com/article/x', 'DH'],
    ['https://evil.example.com/article/x', 'DH'],
    ['https://www.prajavani.net/article/x', 'DH'],
    ['https://user:pw@www.deccanherald.com/article/x', 'DH'],
    ['https://www.deccanherald.com:8443/article/x', 'DH'],
    ['https://127.0.0.1/article/x', 'DH'],
    ['https://localhost/article/x', 'DH'],
    ['https://169.254.169.254/latest/meta-data', 'DH'],
    ['javascript:alert(1)', 'DH'],
    ['https://www.deccanherald.com/x', 'ZZ'],
  ])('rejects %s for %s', (url, brand) => {
    expect(validateSampleUrl(url, brand).ok).toBe(false);
  });

  it('flags registry problems', () => {
    expect(validateTemplate(tpl())).toEqual([]);
    expect(validateTemplate(tpl({ sampleUrls: tpl().sampleUrls.slice(0, 2) }))[0]).toMatch(/needs 5 to 10/);
    expect(validateTemplate(tpl({ sampleUrls: [...tpl().sampleUrls.slice(0, 4), 'https://www.deccanherald.com/video/x'] })).join()).toMatch(/does not match pattern/);
    expect(validateTemplate(tpl({ templateId: 'dh article' })).join()).toMatch(/UPPER_SNAKE_CASE/);
  });

  it('Apps Script validation agrees on host and pattern problems', () => {
    const validate = gs.Templates_validate_ as (t: unknown, hosts: unknown) => string[];
    const hosts = { DH: ['www.deccanherald.com'] };
    const base = { ...tpl() };
    expect(validate(base, hosts)).toHaveLength(0);
    expect(validate({ ...base, sampleUrls: [...base.sampleUrls.slice(0, 4), 'https://evil.example.com/article/x'] }, hosts).join()).toMatch(/host not allowed/);
  });
});
