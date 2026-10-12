import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@/lib/inventory/csv';
import { discoverCandidates } from '@/lib/inventory/discover';
import { buildFamilies, familyOf, findUnmatched, selectSamples, type Candidate } from '@/lib/inventory/families';
import { getFollowing, type HttpGet, type HttpResponse } from '@/lib/inventory/http';
import { discoverFromHomepage, extractLinks } from '@/lib/inventory/nav';
import { registryFromCsv } from '@/lib/inventory/registryCsv';
import { isAllowedByRobots, isNonPagePath, normalizeUrl, parseRobots, parseSitemap } from '@/lib/inventory/urls';
import { validateTemplate } from '@/lib/templates/registry';
import { extractEvidence, summarizeEvidence, verifySamples } from '@/lib/inventory/verify';
import type { TemplateRegistryEntry } from '@/lib/validation/schemas';

const DH = 'https://www.deccanherald.com';
const PV = 'https://www.prajavani.net';
const cand = (url: string, lastmod?: string): Candidate => ({ url, path: new URL(url).pathname, sitemap: 's', ...(lastmod ? { lastmod } : {}) });

/** A fake HTTP layer: map of URL -> response. Anything else is a 404. */
const fakeGet = (routes: Record<string, Partial<HttpResponse>>): { get: HttpGet; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    get: async (url) => {
      calls.push(url);
      const r = routes[url];
      return r ? { status: 200, location: null, body: '', ...r } : { status: 404, location: null, body: '' };
    },
  };
};

describe('normalizeUrl', () => {
  it('drops tracking parameters and fragments, keeps real parameters sorted', () => {
    const r = normalizeUrl(`${DH}/india/x?utm_source=a&b=2&fbclid=z&a=1#top`, 'DH');
    expect(r).toMatchObject({ ok: true, url: `${DH}/india/x?a=1&b=2` });
  });
  it('upgrades http to https and removes trailing slashes and duplicate slashes', () => {
    const r = normalizeUrl('http://www.deccanherald.com//india//story/', 'DH');
    expect(r).toMatchObject({ ok: true, url: `${DH}/india/story`, upgradedHttp: true });
  });
  it('rejects other brands hosts, bare domains, subdomains, credentials and odd ports', () => {
    expect(normalizeUrl(`${PV}/a`, 'DH').ok).toBe(false);
    expect(normalizeUrl('https://deccanherald.com/a', 'DH').ok).toBe(false);
    expect(normalizeUrl('https://evil.example.com/a', 'DH').ok).toBe(false);
    expect(normalizeUrl('https://user:pw@www.deccanherald.com/a', 'DH').ok).toBe(false);
    expect(normalizeUrl('https://www.deccanherald.com:8443/a', 'DH').ok).toBe(false);
    expect(normalizeUrl('not a url', 'DH').ok).toBe(false);
  });
  it('accepts both brands on their own host', () => {
    expect(normalizeUrl(`${PV}/sports/cricket/x-1234567`, 'PV').ok).toBe(true);
  });
});

describe('robots.txt and sitemaps', () => {
  const robots = parseRobots('User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /search\nAllow: /search/ok\nDisallow: /*.json$\nSitemap: https://www.deccanherald.com/sitemap.xml\n# c\n');
  it('reads Sitemap lines and the * group only', () => {
    expect(robots.sitemaps).toEqual(['https://www.deccanherald.com/sitemap.xml']);
    expect(robots.rules.map((r) => r.path)).toEqual(['/search', '/search/ok', '/*.json$']);
  });
  it('applies longest-match and wildcard rules', () => {
    expect(isAllowedByRobots(robots.rules, '/search?q=a')).toBe(false);
    expect(isAllowedByRobots(robots.rules, '/search/ok')).toBe(true);
    expect(isAllowedByRobots(robots.rules, '/a/b.json')).toBe(false);
    expect(isAllowedByRobots(robots.rules, '/g')).toBe(true);
    expect(isAllowedByRobots([], '/anything')).toBe(true);
  });
  it('parses a sitemap index and a url set, decoding entities and CDATA', () => {
    const index = parseSitemap('<sitemapindex><sitemap><loc>https://www.deccanherald.com/a.xml</loc></sitemap></sitemapindex>');
    expect(index).toEqual({ kind: 'index', entries: [{ loc: 'https://www.deccanherald.com/a.xml' }] });
    const urls = parseSitemap('<urlset xmlns:image="x"><url><loc>https://www.deccanherald.com/a?x=1&amp;y=2</loc><lastmod>2026-10-01</lastmod><image:image><image:loc>https://img/x.jpg</image:loc></image:image></url><url><loc><![CDATA[https://www.deccanherald.com/b]]></loc></url></urlset>');
    expect(urls.entries).toEqual([{ loc: 'https://www.deccanherald.com/a?x=1&y=2', lastmod: '2026-10-01' }, { loc: 'https://www.deccanherald.com/b' }]);
    expect(parseSitemap('<html></html>').kind).toBe('unknown');
  });
});

describe('discoverCandidates (fake HTTP, no network)', () => {
  const urlset = (paths: string[]) => `<urlset>${paths.map((p) => `<url><loc>${p}</loc></url>`).join('')}</urlset>`;
  it('follows robots -> index -> child sitemaps, dedupes, normalizes and rejects off-brand URLs', async () => {
    const { get } = fakeGet({
      [`${DH}/robots.txt`]: { body: `Sitemap: ${DH}/index.xml\nSitemap: https://cdn.other.com/x.xml` },
      [`${DH}/index.xml`]: { body: `<sitemapindex><sitemap><loc>${DH}/s1.xml</loc></sitemap><sitemap><loc>https://evil.example.com/s2.xml</loc></sitemap></sitemapindex>` },
      [`${DH}/s1.xml`]: { body: urlset([`${DH}/india/a?utm_source=x`, `${DH}/india/a`, `${DH}/world/b`, `${PV}/off-brand`, 'http://www.deccanherald.com/c/']) },
    });
    const r = await discoverCandidates({ brand: 'DH', get });
    expect(r.candidates.map((c) => c.url).sort()).toEqual([`${DH}/c`, `${DH}/india/a`, `${DH}/world/b`]);
    expect(r.duplicatesDropped).toBe(1);
    expect(Object.values(r.rejectedCounts).reduce((a, b) => a + b, 0)).toBe(1);
    expect(r.sitemapsSkipped.map((s) => s.url).sort()).toEqual(['https://cdn.other.com/x.xml', 'https://evil.example.com/s2.xml']);
  });
  it('falls back to /sitemap.xml when robots.txt has no Sitemap line, and reports it', async () => {
    const { get } = fakeGet({ [`${PV}/robots.txt`]: { body: 'User-agent: *\nDisallow: /x' }, [`${PV}/sitemap.xml`]: { body: urlset([`${PV}/a/b-12345`]) } });
    const r = await discoverCandidates({ brand: 'PV', get });
    expect(r.candidates).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/trying \/sitemap\.xml/);
  });
  it('does not read a sitemap that robots.txt disallows', async () => {
    const { get, calls } = fakeGet({ [`${DH}/robots.txt`]: { body: `User-agent: *\nDisallow: /private\nSitemap: ${DH}/private/s.xml` } });
    const r = await discoverCandidates({ brand: 'DH', get });
    expect(calls).not.toContain(`${DH}/private/s.xml`);
    expect(r.sitemapsSkipped[0].reason).toMatch(/robots/);
  });
  it('stops at the URL cap and says so', async () => {
    const { get } = fakeGet({ [`${DH}/robots.txt`]: { body: `Sitemap: ${DH}/s.xml` }, [`${DH}/s.xml`]: { body: urlset([`${DH}/a/1`, `${DH}/a/2`, `${DH}/a/3`]) } });
    const r = await discoverCandidates({ brand: 'DH', get, maxUrls: 2 });
    expect(r.candidates).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
  it('reports an unreadable robots.txt instead of failing', async () => {
    const { get } = fakeGet({});
    const r = await discoverCandidates({ brand: 'DH', get });
    expect(r.robotsFound).toBe(false);
    expect(r.candidates).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('redirects', () => {
  it('follows an in-brand redirect and refuses an off-brand one', async () => {
    const ok = fakeGet({ [`${DH}/a`]: { status: 301, location: '/b' }, [`${DH}/b`]: { body: 'hi' } });
    expect(await getFollowing(ok.get, `${DH}/a`, 'DH')).toMatchObject({ ok: true, finalUrl: `${DH}/b` });
    const off = fakeGet({ [`${DH}/a`]: { status: 302, location: 'https://evil.example.com/x' } });
    const r = await getFollowing(off.get, `${DH}/a`, 'DH');
    expect(r.ok).toBe(false);
    expect(off.calls).toEqual([`${DH}/a`]);
  });
});

describe('familyOf and buildFamilies', () => {
  it('groups by shape, not by section, and keeps hint families separate', () => {
    expect(familyOf('/').key).toBe('HOME');
    expect(familyOf('/sports/cricket/slug-4312343').key).toBe(familyOf('/explainer/olanota/other-4289446').key);
    expect(familyOf('/video/some-clip-123456').key).toBe('HINT:VIDEO:ITEM');
    expect(familyOf('/video').key).toBe('HINT:VIDEO:ROOT');
    expect(familyOf('/sports/photos/x').key).toBe('HINT:GALLERY:ITEM');
    expect(familyOf('/business').key).toBe('SHAPE:d1');
  });
  const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => cand(`${DH}${prefix}${i + 1}`, `2026-10-${String(10 + (i % 9)).padStart(2, '0')}`));
  it('proposes inactive families with 5 to 10 varied samples and reports shortfalls instead of inventing URLs', () => {
    const cands = [...many('/india/story-', 30).map((c) => cand(c.url.replace('/india/', `/s${c.url.length % 4}/x/`))), cand(`${DH}/`), cand(`${DH}/video/clip-1`), cand(`${DH}/video/clip-2`)];
    const families = buildFamilies('DH', cands);
    const video = families.find((f) => f.key === 'HINT:VIDEO:ITEM');
    expect(video?.pattern).toBe('/video/**');
    expect(video?.samples).toHaveLength(2);
    expect(video?.sampleShortfall).toBe(true);
    expect(video?.problems.join(' ')).toMatch(/5 to 10 sample URLs/);
    const home = families.find((f) => f.key === 'HOME');
    expect(home?.samples).toEqual([`${DH}/`]);
    const big = families.find((f) => f.candidateCount === 30);
    expect(big?.samples.length).toBe(10);
    expect(new Set(big?.samples).size).toBe(10);
  });
  it('flags a family whose samples another registry template would win', () => {
    const registry: TemplateRegistryEntry[] = [{ templateId: 'DH_ALL', templateName: 'All', brand: 'DH', urlPattern: '/video/**', sampleUrls: Array.from({ length: 5 }, (_, i) => `${DH}/video/${i}`), active: true, trafficWeight: null }];
    const cands = Array.from({ length: 6 }, (_, i) => cand(`${DH}/video/clip-${i}`));
    const [family] = buildFamilies('DH', cands, registry);
    expect(family.status).toBe('overlaps-registry');
    expect(family.registryOverlap).toEqual({ DH_ALL: 6 });
  });
  it('avoids template id collisions with the registry and reports unmatched URLs', () => {
    const registry: TemplateRegistryEntry[] = [{ templateId: 'DH_VIDEO_ITEM', templateName: 'v', brand: 'DH', urlPattern: '/video/**', sampleUrls: [], active: false, trafficWeight: null }];
    const cands = [cand(`${DH}/video/a`), cand(`${DH}/india/x`)];
    expect(buildFamilies('DH', cands, registry).find((f) => f.key === 'HINT:VIDEO:ITEM')?.suggestedTemplateId).toBe('DH_VIDEO_ITEM_2');
    expect(findUnmatched(cands, registry).map((c) => c.url)).toEqual([`${DH}/india/x`]);
  });
  it('selectSamples is deterministic, round-robin across sections and free of duplicates', () => {
    const cands = [cand(`${DH}/a/1`, '2026-10-01'), cand(`${DH}/a/2`, '2026-10-05'), cand(`${DH}/b/1`, '2026-10-02'), cand(`${DH}/b/1`, '2026-10-02'), cand(`${DH}/c/1`)];
    expect(selectSamples(cands, 4)).toEqual([`${DH}/a/2`, `${DH}/b/1`, `${DH}/c/1`, `${DH}/a/1`]);
    expect(selectSamples(cands, 4)).toEqual(selectSamples([...cands].reverse(), 4));
  });
});

describe('page evidence and sample verification (fake HTTP)', () => {
  const page = (type: string, canonical?: string) => `<html><head><meta property="og:type" content="${type}"><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle"}]}</script>${canonical ? `<link rel="canonical" href="${canonical}">` : ''}</head></html>`;
  it('extracts og:type, JSON-LD types, canonical and amp link', () => {
    const e = extractEvidence(`<meta content="article" property="og:type"><link rel="amphtml" href="x"><link rel="canonical" href="${DH}/a">${page('article')}`);
    expect(e).toMatchObject({ ogType: 'article', ldTypes: ['NewsArticle'], canonical: `${DH}/a`, hasAmpLink: true });
  });
  it('keeps only samples that load, stay on their own URL and match their canonical', async () => {
    const { get } = fakeGet({
      [`${DH}/ok`]: { body: page('article', `${DH}/ok`) },
      [`${DH}/moved`]: { status: 301, location: '/elsewhere' },
      [`${DH}/elsewhere`]: { body: page('article') },
      [`${DH}/canon`]: { body: page('article', `${DH}/other`) },
      [`${DH}/offsite`]: { status: 302, location: 'https://evil.example.com/' },
    });
    const r = await verifySamples({ brand: 'DH', urls: ['ok', 'moved', 'canon', 'offsite', 'missing'].map((p) => `${DH}/${p}`), get });
    expect(r.filter((x) => x.ok).map((x) => x.url)).toEqual([`${DH}/ok`]);
    expect(r.find((x) => x.url.endsWith('/moved'))?.reason).toMatch(/redirects to/);
    expect(r.find((x) => x.url.endsWith('/canon'))?.reason).toMatch(/canonical is a different page/);
    expect(r.find((x) => x.url.endsWith('/offsite'))?.reason).toMatch(/not followed/);
    expect(r.find((x) => x.url.endsWith('/missing'))?.reason).toBe('HTTP 404');
  });
  it('stops after enough good samples and respects robots rules', async () => {
    const { get, calls } = fakeGet({ [`${DH}/a`]: { body: page('article') }, [`${DH}/b`]: { body: page('article') }, [`${DH}/c`]: { body: page('article') } });
    await verifySamples({ brand: 'DH', urls: [`${DH}/a`, `${DH}/b`, `${DH}/c`], get, stopAfterOk: 2 });
    expect(calls).toEqual([`${DH}/a`, `${DH}/b`]);
    const blocked = await verifySamples({ brand: 'DH', urls: [`${DH}/private/x`], get, robotsRules: [{ allow: false, path: '/private' }] });
    expect(blocked[0].reason).toMatch(/robots/);
  });
  it('flags a mixed family', () => {
    const art = { ogType: 'article', ldTypes: ['NewsArticle'], canonical: null, hasAmpLink: false };
    const site = { ogType: 'website', ldTypes: ['CollectionPage'], canonical: null, hasAmpLink: false };
    expect(summarizeEvidence([art, art, art, art]).mixed).toBe(false);
    expect(summarizeEvidence([art, art, site, site]).mixed).toBe(true);
  });
});

describe('csv and registry export', () => {
  it('round-trips quotes, commas and line breaks', () => {
    const rows = [['a', 'b,c', 'd"e', 'f\ng']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('reads a Templates sheet export with multi-line sample_urls', () => {
    const csv = `template_id,template_name,brand,url_pattern,sample_urls,active,traffic_weight,notes\nDH_X,X,dh,/a/*,"${DH}/a/1\n${DH}/a/2",TRUE,,n\n`;
    const [t] = registryFromCsv(csv);
    expect(t).toMatchObject({ templateId: 'DH_X', brand: 'DH', active: true });
    expect(t.sampleUrls).toEqual([`${DH}/a/1`, `${DH}/a/2`]);
  });
});

describe('improvements after the first real run', () => {
  it('recognizes files and verification assets that are not pages', () => {
    for (const p of ['/ads.txt', '/campaign.json', '/bihar_ac_all.geojson', '/.well-known/assetlinks.json', '/apple-app-site-association', '/google229cb86cb2f672c7.html', '/izooto.html']) {
      expect(isNonPagePath(p)).toBe(true);
    }
    for (const p of ['/', '/india/story-4173541', '/bengaluru-traffic-event.html', '/auto/bikes']) expect(isNonPagePath(p)).toBe(false);
  });
  it('drops non-pages and robots-disallowed URLs from the candidates and counts them', async () => {
    const { get } = fakeGet({
      [`${DH}/robots.txt`]: { body: `User-agent: *\nDisallow: /brandspot\nSitemap: ${DH}/s.xml` },
      [`${DH}/s.xml`]: { body: `<urlset>${['/a/story-123456', '/ads.txt', '/brandspot/x', '/google229cb86cb2f672c7.html'].map((p) => `<url><loc>${DH}${p}</loc></url>`).join('')}</urlset>` },
    });
    const r = await discoverCandidates({ brand: 'DH', get });
    expect(r.candidates.map((c) => c.path)).toEqual(['/a/story-123456']);
    expect(r.rejectedCounts).toEqual({ 'Not a page (file or site-verification asset)': 2, 'Disallowed by robots.txt': 1 });
  });
  it('samples the biggest sections first instead of the alphabetically first ones', () => {
    const many = (section: string, n: number) => Array.from({ length: n }, (_, i) => cand(`${DH}/${section}/story-${i + 1}0000`));
    const cands = [...many('agriculture', 1), ...many('art', 1), ...many('district', 30), ...many('news', 20), ...many('sports', 10)];
    const picked = selectSamples(cands, 3).map((u) => new URL(u).pathname.split('/')[1]);
    expect(picked).toEqual(['district', 'news', 'sports']);
  });
  it('gives AMP web stories and sponsored pages their own families', () => {
    expect(familyOf('/ampstories/lifestyle/fashion/x-3936427').key).toBe('HINT:WEB_STORY:ITEM');
    expect(familyOf('/dhbrandspot/jio-ipo-4170944').key).toBe('HINT:SPONSORED:ITEM');
    expect(familyOf('/dhbrandpr/x-4173521').key).toBe('HINT:SPONSORED:ITEM');
  });
  it('lets only the home page family pass with one sample, through the documented exception', () => {
    const [home] = buildFamilies('DH', [cand(`${DH}/`)]);
    expect(home.notes).toMatch(/single-url-ok/);
    expect(home.sampleShortfall).toBe(false);
    expect(home.problems).toEqual([]);
    const [video] = buildFamilies('DH', [cand(`${DH}/video/a`)]);
    expect(video.sampleShortfall).toBe(true);
  });
  it('registry validation: one sample is invalid without the exception marker and valid with it', () => {
    const base = { templateId: 'DH_HOME', templateName: 'Home', brand: 'DH', urlPattern: '/', sampleUrls: [`${DH}/`], active: true, trafficWeight: null };
    expect(validateTemplate(base).join(' ')).toMatch(/needs 5 to 10/);
    expect(validateTemplate({ ...base, notes: 'single-url-ok' })).toEqual([]);
    expect(validateTemplate({ ...base, notes: 'single-url-ok', sampleUrls: [] }).join(' ')).toMatch(/needs 1 to 10/);
  });
});

describe('home page links', () => {
  const html = `<nav><a href="/business">Business</a><a href='/sports/cricket'>Cricket</a><a href="https://www.deccanherald.com/subscribe?utm_source=x">Subscribe</a>
    <a href="https://subscribe.example.org/plans">Plans</a><a href="mailto:a@b.c">m</a><a href="/ads.txt">f</a><a href="/private/x">p</a><a href="/business">dup</a><a href="#top">t</a></nav>`;
  it('extracts hrefs', () => {
    expect(extractLinks(html)).toContain('/sports/cricket');
  });
  it('turns internal links into candidates, reports other hosts, and skips files, robots-blocked, duplicates and mail links', async () => {
    const { get } = fakeGet({ [`${DH}/`]: { body: html } });
    const r = await discoverFromHomepage({ brand: 'DH', get, robotsRules: [{ allow: false, path: '/private' }] });
    expect(r.ok).toBe(true);
    expect(r.candidates.map((c) => c.path).sort()).toEqual(['/business', '/sports/cricket', '/subscribe']);
    expect(r.externalHosts).toEqual({ 'subscribe.example.org': 1 });
    expect(r.candidates.every((c) => c.sitemap === 'homepage-links')).toBe(true);
  });
  it('reports an unreadable home page instead of failing', async () => {
    const { get } = fakeGet({});
    expect((await discoverFromHomepage({ brand: 'PV', get })).ok).toBe(false);
  });
});

describe('live blogs and premium', () => {
  it('finds live blogs by slug, at any depth, without catching ordinary stories', () => {
    expect(familyOf('/india/karnataka/karnataka-politics-live-updates-cm-4020383').key).toBe('LIVE_BLOG');
    expect(familyOf('/sports/delhi-protest-live-updates-will-hit-streets-4173999').key).toBe('LIVE_BLOG');
    expect(familyOf('/india/the-company-is-alive-and-well-4173000').key).not.toBe('LIVE_BLOG');
    expect(familyOf('/world/delivered-live-music-festival-4173001').key).not.toBe('LIVE_BLOG');
  });
  it('proposes a live blog family with a pattern that matches its samples', () => {
    const cands = Array.from({ length: 6 }, (_, i) => cand(`${DH}/india/s${i}/match-live-updates-${4000000 + i}`));
    const [family] = buildFamilies('DH', cands);
    expect(family.suggestedTemplateId).toBe('DH_LIVE_BLOG');
    expect(family.pattern).toBe('/**');
    expect(family.samples).toHaveLength(6);
    expect(family.problems).toEqual([]);
  });
  it('keeps the premium area apart from ordinary sections', () => {
    expect(familyOf('/premium').key).toBe('HINT:PREMIUM:ROOT');
  });
});
