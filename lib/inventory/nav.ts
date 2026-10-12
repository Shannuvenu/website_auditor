import { BRAND_HOSTS } from '@/lib/templates/brands';
import type { Candidate } from './families';
import { getFollowing, type HttpGet } from './http';
import { isAllowedByRobots, isNonPagePath, normalizeUrl, type RobotsRule } from './urls';
import type { Brand } from '@/lib/validation/schemas';

export interface NavResult {
  ok: boolean;
  problem?: string;
  /** Internal links found on the home page that are not already known as pages are candidates. */
  candidates: Candidate[];
  /** Links to other hosts (for example a separate subscription site): counted and reported, never followed. */
  externalHosts: Record<string, number>;
}

/** Pulls href values out of anchor tags. */
export function extractLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) out.push(m[1].trim());
  return out;
}

/**
 * Reads the brand's home page once and turns its internal links (menus, footer, section links) into candidate
 * URLs. Sitemaps list stories but often miss section fronts, subscription pages and other landing pages that
 * only the navigation links to.
 */
export async function discoverFromHomepage(options: { brand: Brand; get: HttpGet; robotsRules?: RobotsRule[] }): Promise<NavResult> {
  const { brand, get } = options;
  const host = BRAND_HOSTS[brand][0];
  const home = await getFollowing(get, `https://${host}/`, brand);
  if (!home.ok) return { ok: false, problem: home.problem ?? 'home page not readable', candidates: [], externalHosts: {} };

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const externalHosts: Record<string, number> = {};
  for (const href of extractLinks(home.body)) {
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue;
    let absolute: URL;
    try {
      absolute = new URL(href, home.finalUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') continue;
    const check = normalizeUrl(absolute.toString(), brand);
    if (!check.ok) {
      const other = absolute.hostname.toLowerCase();
      if (!BRAND_HOSTS[brand].includes(other)) externalHosts[other] = (externalHosts[other] ?? 0) + 1;
      continue;
    }
    if (isNonPagePath(check.path)) continue;
    if (options.robotsRules && !isAllowedByRobots(options.robotsRules, check.path)) continue;
    if (seen.has(check.url)) continue;
    seen.add(check.url);
    candidates.push({ url: check.url, path: check.path, sitemap: 'homepage-links' });
  }
  return { ok: true, candidates, externalHosts };
}
