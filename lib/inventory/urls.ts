import { validateSampleUrl } from '@/lib/templates/registry';
import type { Brand } from '@/lib/validation/schemas';

/** Query parameters that only track campaigns or clicks; they never change which template renders. */
const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|yclid|ocid|ref_src|_ga)$/i;

export type NormalizeResult =
  | { ok: true; url: string; path: string; upgradedHttp: boolean }
  | { ok: false; reason: string };

/**
 * Normalizes a discovered URL and applies the registry's own host/https rules (validateSampleUrl), so a
 * discovered URL can never pass here and then fail registry validation for host reasons.
 */
export function normalizeUrl(raw: string, brand: Brand): NormalizeResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  let upgradedHttp = false;
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    upgradedHttp = true;
  }
  url.hash = '';
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

  const check = validateSampleUrl(url.toString(), brand);
  if (!check.ok) return { ok: false, reason: check.reason };
  return { ok: true, url: url.toString(), path: url.pathname, upgradedHttp };
}

/**
 * Files and site-verification assets that sitemaps sometimes list but that are not pages
 * (ads.txt, *.json, google1234.html verification files, /.well-known/...). They are never template candidates.
 */
const NON_PAGE_PATH = /(\.(txt|json|geojson|xml|js|css|map|ico|png|jpe?g|gif|svg|webp|pdf|webmanifest|gz)$)|(^\/\.well-known\/)|(^\/apple-app-site-association$)|(^\/google[0-9a-f]{12,}\.html$)|(^\/izooto\.html$)/i;

export function isNonPagePath(path: string): boolean {
  return NON_PAGE_PATH.test(path);
}

// ---------- robots.txt ----------

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface Robots {
  sitemaps: string[];
  /** Rules of the "User-agent: *" group. */
  rules: RobotsRule[];
}

export function parseRobots(text: string): Robots {
  const sitemaps: string[] = [];
  const rules: RobotsRule[] = [];
  let agents: string[] = [];
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!lastWasAgent) agents = [];
      agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if ((field === 'allow' || field === 'disallow') && agents.includes('*') && value) {
      rules.push({ allow: field === 'allow', path: value });
    }
  }
  return { sitemaps, rules };
}

function robotsRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins; on a tie Allow wins. No matching rule means allowed. */
export function isAllowedByRobots(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!robotsRegex(rule.path).test(pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

// ---------- sitemaps ----------

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export interface ParsedSitemap {
  kind: 'index' | 'urlset' | 'unknown';
  entries: SitemapEntry[];
}

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** Reads a sitemap index or a URL set. Extension tags (image, news, video) are ignored. */
export function parseSitemap(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const isUrlset = /<urlset[\s>]/i.test(xml);
  if (!isIndex && !isUrlset) return { kind: 'unknown', entries: [] };
  const block = isIndex ? /<sitemap[\s>]([\s\S]*?)<\/sitemap>/gi : /<url[\s>]([\s\S]*?)<\/url>/gi;
  const entries: SitemapEntry[] = [];
  for (const match of xml.matchAll(block)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(match[1]);
    if (!loc) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(match[1]);
    entries.push({ loc: decodeXml(loc[1]), ...(lastmod ? { lastmod: decodeXml(lastmod[1]) } : {}) });
  }
  return { kind: isIndex ? 'index' : 'urlset', entries };
}
