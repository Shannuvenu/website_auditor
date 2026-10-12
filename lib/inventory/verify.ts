import { getFollowing, type HttpGet } from './http';
import { isAllowedByRobots, normalizeUrl, type RobotsRule } from './urls';
import type { Brand } from '@/lib/validation/schemas';

export interface PageEvidence {
  ogType: string | null;
  ldTypes: string[];
  canonical: string | null;
  hasAmpLink: boolean;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : null;
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out));
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (typeof type === 'string') out.add(type);
  else if (Array.isArray(type)) type.filter((t): t is string => typeof t === 'string').forEach((t) => out.add(t));
  for (const value of Object.values(obj)) if (value && typeof value === 'object') collectTypes(value, out);
}

/** Page evidence that exists in the HTML itself. It is a proxy for the CMS template, not the template name. */
export function extractEvidence(html: string): PageEvidence {
  const head = html.slice(0, 500_000);
  let ogType: string | null = null;
  let canonical: string | null = null;
  let hasAmpLink = false;
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, 'property')?.toLowerCase() === 'og:type') ogType = attr(tag, 'content');
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase();
    if (rel === 'canonical') canonical = attr(tag, 'href');
    if (rel === 'amphtml') hasAmpLink = true;
  }
  const types = new Set<string>();
  for (const m of head.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectTypes(JSON.parse(m[1]), types);
    } catch {
      // malformed JSON-LD is ignored
    }
  }
  return { ogType, ldTypes: [...types].sort(), canonical, hasAmpLink };
}

export interface VerifiedSample {
  url: string;
  ok: boolean;
  reason?: string;
  evidence?: PageEvidence;
}

/**
 * Fetches sample pages (a handful per family, never the whole inventory), rejecting any that fail, redirect to a
 * different page, redirect off the brand's hosts, or declare a different canonical page.
 */
export async function verifySamples(options: {
  brand: Brand;
  urls: string[];
  get: HttpGet;
  robotsRules?: RobotsRule[];
  delayMs?: number;
  /** Stop once this many samples passed, so a family never costs more requests than needed. */
  stopAfterOk?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<VerifiedSample[]> {
  const { brand, get } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: VerifiedSample[] = [];
  const finals = new Set<string>();
  for (const url of options.urls) {
    if (options.stopAfterOk && out.filter((o) => o.ok).length >= options.stopAfterOk) break;
    if (options.robotsRules && !isAllowedByRobots(options.robotsRules, new URL(url).pathname)) {
      out.push({ url, ok: false, reason: 'disallowed by robots.txt' });
      continue;
    }
    if (options.delayMs) await sleep(options.delayMs);
    const res = await getFollowing(get, url, brand);
    if (!res.ok) {
      out.push({ url, ok: false, reason: res.problem ?? `HTTP ${res.status}` });
      continue;
    }
    const final = normalizeUrl(res.finalUrl, brand);
    if (!final.ok || final.url !== url) {
      out.push({ url, ok: false, reason: `redirects to ${res.finalUrl}` });
      continue;
    }
    const evidence = extractEvidence(res.body);
    if (evidence.canonical) {
      const canon = normalizeUrl(new URL(evidence.canonical, url).toString(), brand);
      if (!canon.ok) {
        out.push({ url, ok: false, reason: `canonical points off-brand: ${evidence.canonical}`, evidence });
        continue;
      }
      if (canon.url !== url) {
        out.push({ url, ok: false, reason: `canonical is a different page: ${canon.url}`, evidence });
        continue;
      }
    }
    if (finals.has(url)) {
      out.push({ url, ok: false, reason: 'duplicate of another sample' });
      continue;
    }
    finals.add(url);
    out.push({ url, ok: true, evidence });
  }
  return out;
}

export interface EvidenceSummary {
  samplesChecked: number;
  ogTypes: Record<string, number>;
  ldTypes: Record<string, number>;
  /** True when one family shows clearly different page types: split it or pick a narrower pattern. */
  mixed: boolean;
}

export function summarizeEvidence(items: PageEvidence[]): EvidenceSummary {
  const ogTypes: Record<string, number> = {};
  const ldTypes: Record<string, number> = {};
  for (const e of items) {
    const og = e.ogType ?? '(none)';
    ogTypes[og] = (ogTypes[og] ?? 0) + 1;
    const ld = e.ldTypes[0] ?? '(none)';
    ldTypes[ld] = (ldTypes[ld] ?? 0) + 1;
  }
  const minority = (counts: Record<string, number>) => {
    const values = Object.values(counts).sort((a, b) => b - a);
    return values.length > 1 && values[1] / Math.max(1, items.length) >= 0.2;
  };
  return { samplesChecked: items.length, ogTypes, ldTypes, mixed: items.length >= 3 && (minority(ogTypes) || minority(ldTypes)) };
}
