import { BRAND_HOSTS } from '@/lib/templates/brands';
import type { Candidate } from './families';
import { getFollowing, type HttpGet } from './http';
import { isAllowedByRobots, isNonPagePath, normalizeUrl, parseRobots, parseSitemap } from './urls';
import type { Brand } from '@/lib/validation/schemas';

export interface DiscoverOptions {
  brand: Brand;
  get: HttpGet;
  maxSitemaps?: number;
  maxUrls?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DiscoverResult {
  brand: Brand;
  robotsFound: boolean;
  sitemapsRead: string[];
  sitemapsSkipped: { url: string; reason: string }[];
  candidates: Candidate[];
  /** Reason -> count, plus up to 25 example URLs. */
  rejectedCounts: Record<string, number>;
  rejectedExamples: { url: string; reason: string }[];
  duplicatesDropped: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * Reads robots.txt, then the sitemaps it declares (index files are followed), on the brand's own hosts only.
 * It never requests article pages and never measures anything.
 */
export async function discoverCandidates(options: DiscoverOptions): Promise<DiscoverResult> {
  const { brand, get } = options;
  const maxSitemaps = options.maxSitemaps ?? 200;
  const maxUrls = options.maxUrls ?? 300_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pause = () => (options.delayMs ? sleep(options.delayMs) : Promise.resolve());
  const host = BRAND_HOSTS[brand]?.[0];
  const result: DiscoverResult = {
    brand, robotsFound: false, sitemapsRead: [], sitemapsSkipped: [], candidates: [], rejectedCounts: {}, rejectedExamples: [], duplicatesDropped: 0, truncated: false, warnings: [],
  };
  if (!host) {
    result.warnings.push(`No host configured for brand ${brand}`);
    return result;
  }

  const robotsRes = await getFollowing(get, `https://${host}/robots.txt`, brand);
  const robots = robotsRes.ok ? parseRobots(robotsRes.body) : { sitemaps: [], rules: [] };
  result.robotsFound = robotsRes.ok;
  if (!robotsRes.ok) result.warnings.push(`robots.txt not readable (${robotsRes.problem ?? 'unknown'}); crawling nothing beyond the default sitemap`);

  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (raw: string, why: string) => {
    const check = normalizeUrl(raw, brand);
    if (!check.ok) {
      result.sitemapsSkipped.push({ url: raw, reason: `${why}: ${check.reason}` });
      return;
    }
    if (!queued.has(check.url)) {
      queued.add(check.url);
      queue.push(check.url);
    }
  };
  robots.sitemaps.forEach((s) => enqueue(s, 'declared in robots.txt'));
  if (!queue.length) {
    result.warnings.push('No usable Sitemap line in robots.txt; trying /sitemap.xml');
    enqueue(`https://${host}/sitemap.xml`, 'default sitemap');
  }

  const seen = new Set<string>();
  while (queue.length && result.sitemapsRead.length < maxSitemaps && !result.truncated) {
    const sitemapUrl = queue.shift() as string;
    if (!isAllowedByRobots(robots.rules, new URL(sitemapUrl).pathname)) {
      result.sitemapsSkipped.push({ url: sitemapUrl, reason: 'disallowed by robots.txt' });
      continue;
    }
    await pause();
    const res = await getFollowing(get, sitemapUrl, brand);
    if (!res.ok) {
      result.sitemapsSkipped.push({ url: sitemapUrl, reason: res.problem ?? 'not readable' });
      continue;
    }
    const parsed = parseSitemap(res.body);
    result.sitemapsRead.push(sitemapUrl);
    if (parsed.kind === 'unknown') {
      result.sitemapsSkipped.push({ url: sitemapUrl, reason: 'not a sitemap or sitemap index' });
      continue;
    }
    if (parsed.kind === 'index') {
      parsed.entries.forEach((e) => enqueue(e.loc, 'listed in sitemap index'));
      continue;
    }
    for (const entry of parsed.entries) {
      const check = normalizeUrl(entry.loc, brand);
      if (!check.ok) {
        result.rejectedCounts[check.reason] = (result.rejectedCounts[check.reason] ?? 0) + 1;
        if (result.rejectedExamples.length < 25) result.rejectedExamples.push({ url: entry.loc, reason: check.reason });
        continue;
      }
      const reject = isNonPagePath(check.path)
        ? 'Not a page (file or site-verification asset)'
        : !isAllowedByRobots(robots.rules, check.path + new URL(check.url).search)
          ? 'Disallowed by robots.txt'
          : null;
      if (reject) {
        result.rejectedCounts[reject] = (result.rejectedCounts[reject] ?? 0) + 1;
        if (result.rejectedExamples.length < 25) result.rejectedExamples.push({ url: entry.loc, reason: reject });
        continue;
      }
      if (seen.has(check.url)) {
        result.duplicatesDropped++;
        continue;
      }
      if (result.candidates.length >= maxUrls) {
        result.truncated = true;
        break;
      }
      seen.add(check.url);
      result.candidates.push({ url: check.url, path: check.path, ...(entry.lastmod ? { lastmod: entry.lastmod } : {}), sitemap: sitemapUrl });
    }
  }
  if (queue.length && !result.truncated) {
    result.truncated = true;
    result.warnings.push(`Stopped after ${maxSitemaps} sitemaps; ${queue.length} more were not read`);
  }
  if (!result.candidates.length) result.warnings.push('No candidate URLs were found');
  return result;
}
