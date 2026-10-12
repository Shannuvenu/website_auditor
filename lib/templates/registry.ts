import type { TemplateRegistryEntry } from '@/lib/validation/schemas';
import { brandSchema } from '@/lib/validation/schemas';
import { BRAND_HOSTS } from './brands';
import { matchesPattern, specificity } from './pattern';

export const MIN_SAMPLES = 5;
export const MAX_SAMPLES = 10;

/**
 * Documented exception: a page family that legitimately has one page (a home page) may carry the marker
 * "single-url-ok" in its notes and then needs only one sample URL instead of five.
 */
export function minSamplesFor(t: Pick<TemplateRegistryEntry, 'notes'>): number {
  return /single-url-ok/i.test(t.notes ?? '') ? 1 : MIN_SAMPLES;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Validates a sample or lookup URL without any network access: https only, no credentials,
 * host must be one of the brand's allowed hosts.
 */
export function validateSampleUrl(raw: string, brand: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https URLs are allowed' };
  if (url.username || url.password) return { ok: false, reason: 'URLs with credentials are not allowed' };
  if (url.port) return { ok: false, reason: 'Custom ports are not allowed' };
  const parsedBrand = brandSchema.safeParse(brand);
  if (!parsedBrand.success) return { ok: false, reason: `Unknown brand "${brand}"` };
  if (!BRAND_HOSTS[parsedBrand.data].includes(url.hostname.toLowerCase())) {
    return { ok: false, reason: `Host ${url.hostname} is not allowed for ${brand}` };
  }
  return { ok: true, url };
}

/** Problems with a registry row; empty array means valid. */
export function validateTemplate(t: TemplateRegistryEntry): string[] {
  const problems: string[] = [];
  if (!/^[A-Z0-9_]+$/.test(t.templateId)) problems.push('template_id must be UPPER_SNAKE_CASE');
  if (!t.templateName.trim()) problems.push('template_name is empty');
  if (!brandSchema.safeParse(t.brand).success) problems.push(`Unknown brand "${t.brand}"`);
  let patternOk = true;
  try {
    matchesPattern('/', t.urlPattern);
  } catch (err) {
    patternOk = false;
    problems.push(`url_pattern: ${(err as Error).message}`);
  }
  const minSamples = minSamplesFor(t);
  if (t.sampleUrls.length < minSamples || t.sampleUrls.length > MAX_SAMPLES) {
    problems.push(`needs ${minSamples} to ${MAX_SAMPLES} sample URLs (has ${t.sampleUrls.length})`);
  }
  for (const raw of t.sampleUrls) {
    const check = validateSampleUrl(raw, t.brand);
    if (!check.ok) {
      problems.push(`${raw}: ${check.reason}`);
      continue;
    }
    if (patternOk && !matchesPattern(check.url.pathname, t.urlPattern)) {
      problems.push(`${raw}: does not match pattern ${t.urlPattern}`);
    }
  }
  return problems;
}

/**
 * Finds the template a URL belongs to: same brand host, active, most specific matching pattern.
 * Pure string logic: the URL is never fetched.
 */
export function matchTemplate(rawUrl: string, templates: TemplateRegistryEntry[]): TemplateRegistryEntry | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const candidates = templates.filter((t) => {
    if (!t.active) return false;
    const parsed = brandSchema.safeParse(t.brand);
    if (!parsed.success || !BRAND_HOSTS[parsed.data].includes(host)) return false;
    try {
      return matchesPattern(url.pathname, t.urlPattern);
    } catch {
      return false;
    }
  });
  candidates.sort((a, b) => {
    const [aw, ap] = specificity(a.urlPattern);
    const [bw, bp] = specificity(b.urlPattern);
    return aw - bw || ap - bp || a.templateId.localeCompare(b.templateId);
  });
  return candidates[0] ?? null;
}
