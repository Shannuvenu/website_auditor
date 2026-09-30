import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { safeFetch } from './fetch';

const ANALYTICS: Record<string, RegExp> = {
  'Google Analytics': /google-analytics\.com|gtag\/js\?id=G-/i,
  'Google Tag Manager': /googletagmanager\.com\/gtm\.js/i,
  'Meta Pixel': /connect\.facebook\.net[^"']*fbevents|fbq\(/i,
  'Hotjar': /hotjar\.com/i, 'Microsoft Clarity': /clarity\.ms/i, 'Mixpanel': /mixpanel\.com/i,
};

export async function crawl(url: string) {
  const r = await safeFetch(url);
  const origin = new URL(r.finalUrl).origin, host = new URL(r.finalUrl).hostname;
  const isHtml = /html/i.test(r.headers['content-type'] ?? '');
  const $ = cheerio.load(isHtml ? r.body : '');
  const abs = (s?: string) => { try { return s ? new URL(s, r.finalUrl).toString() : ''; } catch { return ''; } };
  const meta = (sel: string) => $(sel).attr('content')?.trim() || null;

  const images = $('img').map((_, el) => {
    const src = abs($(el).attr('src') || $(el).attr('data-src'));
    const ext = (src.split('?')[0].split('.').pop() || '').toLowerCase();
    return { src, alt: $(el).attr('alt') ?? null, width: $(el).attr('width') ?? null, height: $(el).attr('height') ?? null, lazy: $(el).attr('loading') === 'lazy', format: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg', 'gif'].includes(ext) ? ext : 'unknown' };
  }).get();
  const scripts = $('script[src]').map((_, e) => abs($(e).attr('src'))).get();
  const css = $('link[rel=stylesheet]').map((_, e) => abs($(e).attr('href'))).get();
  const root = host.replace(/^www\./, '');
  const thirdParty = [...new Set([...scripts, ...css].map((s) => { try { return new URL(s).hostname; } catch { return ''; } }).filter((h) => h && !h.endsWith(root)))];
  const links = $('a[href]').map((_, e) => ({ href: abs($(e).attr('href')), text: $(e).text().trim() || $(e).attr('aria-label') || '' })).get().filter((l) => l.href.startsWith('http'));
  const internal = links.filter((l) => new URL(l.href).hostname.endsWith(root)).length;
  const jsonld: string[] = []; let jsonldInvalid = 0;
  $('script[type="application/ld+json"]').each((_, e) => { try { const j = JSON.parse($(e).text()); (Array.isArray(j) ? j : j['@graph'] ?? [j]).forEach((x: any) => x?.['@type'] && jsonld.push(([] as string[]).concat(x['@type']).join(','))); } catch { jsonldInvalid++; } });
  const rawHtml = isHtml ? r.body : '';
  const $t = cheerio.load(rawHtml); $t('script,style,noscript').remove();
  const text = $t('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(' ').length : 0;
  const mixed = r.finalUrl.startsWith('https:') ? (rawHtml.match(/(src|href)=["']http:\/\//gi) ?? []).length : 0;

  let robots: { status: number; body: string } | null = null;
  try { const x = await safeFetch(origin + '/robots.txt', { maxBytes: 500_000 }); robots = { status: x.status, body: x.body }; } catch {}
  const robotsOk = !!robots && robots.status === 200 && !/<html/i.test(robots.body);

  let dnsAddrs: string[] = []; try { dnsAddrs = (await dns.lookup(host, { all: true })).map((a) => a.address); } catch {}
  let cert: { validTo: string; daysLeft: number; issuer: string } | null = null;
  if (r.finalUrl.startsWith('https:')) cert = await new Promise((res) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const c = s.getPeerCertificate(); s.end();
      res(c?.valid_to ? { validTo: c.valid_to, daysLeft: Math.round((new Date(c.valid_to).getTime() - Date.now()) / 864e5), issuer: String((c.issuer as any)?.O ?? '') } : null);
    });
    s.on('error', () => res(null)); s.on('timeout', () => { s.destroy(); res(null); });
  });

  const modified = r.headers['last-modified'] ?? meta('meta[property="article:modified_time"]') ?? (rawHtml.match(/"dateModified"\s*:\s*"([^"]+)"/)?.[1] ?? null);
  const headings = $('h1,h2,h3,h4,h5,h6').map((_, e) => (e as any).tagName.toLowerCase()).get() as string[];

  return {
    http: { status: r.status, finalUrl: r.finalUrl, ms: r.ms, chain: r.chain, contentType: r.headers['content-type'] ?? null, headers: r.headers, truncated: r.truncated, isHtml, https: r.finalUrl.startsWith('https:') },
    html: { title: $('title').first().text().trim() || null, metaDescription: meta('meta[name=description]'), canonical: $('link[rel=canonical]').attr('href') ?? null, robotsMeta: meta('meta[name=robots]'), viewport: meta('meta[name=viewport]'), lang: $('html').attr('lang') ?? null, charset: $('meta[charset]').attr('charset') ?? (r.headers['content-type']?.match(/charset=([^;]+)/)?.[1] ?? null), h1: $('h1').length, h2: $('h2').length, headingSkips: headings.some((h, i) => i > 0 && +h[1] - +headings[i - 1][1] > 1) },
    social: { ogTitle: meta('meta[property="og:title"]'), ogDescription: meta('meta[property="og:description"]'), ogImage: meta('meta[property="og:image"]'), ogUrl: meta('meta[property="og:url"]'), ogType: meta('meta[property="og:type"]'), twCard: meta('meta[name="twitter:card"]'), twTitle: meta('meta[name="twitter:title"]'), twImage: meta('meta[name="twitter:image"]') },
    images: { count: images.length, missingAlt: images.filter((i) => i.alt === null).length, emptyAlt: images.filter((i) => i.alt === '').length, noDimensions: images.filter((i) => !i.width || !i.height).length, lazy: images.filter((i) => i.lazy).length, legacy: images.filter((i) => ['jpg', 'jpeg', 'png', 'gif'].includes(i.format)).length, modern: images.filter((i) => ['webp', 'avif'].includes(i.format)).length, sample: images.slice(0, 10).map((i) => i.src) },
    resources: { scripts: scripts.length, inlineScripts: $('script:not([src])').length, css: css.length, preloadedFonts: $('link[rel=preload][as=font]').length, thirdPartyHosts: thirdParty },
    links: { internal, external: links.length - internal, emptyText: links.filter((l) => !l.text).length },
    structuredData: { jsonLdTypes: jsonld, invalid: jsonldInvalid },
    robotsTxt: { available: robotsOk, sitemaps: robotsOk ? [...robots!.body.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [] },
    analytics: Object.entries(ANALYTICS).filter(([, re]) => re.test(rawHtml)).map(([k]) => k),
    contact: { mailto: $('a[href^="mailto:"]').length, tel: $('a[href^="tel:"]').length, visibleEmails: [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])].slice(0, 5) },
    content: { wordCount, textHtmlRatio: rawHtml.length ? +((text.length / rawHtml.length) * 100).toFixed(1) : 0, htmlBytes: rawHtml.length },
    security: { mixedContent: mixed },
    domain: { host, dnsAddrs, cert },
    freshness: { lastModified: modified },
  };
}
export type CrawlFacts = Awaited<ReturnType<typeof crawl>>;
