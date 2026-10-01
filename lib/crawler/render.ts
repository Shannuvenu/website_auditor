import { assertSafeUrl } from '@/lib/security/url';

export interface RenderFacts {
  ok: boolean; disabled?: boolean; error?: string;
  words?: number; h1?: number; checkTextFoundMs?: number | null; loadMs?: number;
  totalRequests?: number; thirdPartyHosts?: string[]; adLikeHosts?: string[]; gtmRequests?: number;
  sessionLike?: { t: number; url: string }[];
  timeline?: { t: number; type: string; host: string; path: string }[];
}

const AD_RE = /doubleclick|googlesyndication|googletagservices|adservice\.google|prebid|adnxs|criteo|taboola|outbrain|amazon-adsystem|pubmatic|rubiconproject|openx\.net|smartadserver|moatads|3lift|casalemedia|adsrvr/i;
const SESSION_RE = /supertokens|\/auth\/session|session\/refresh|\/entitlement|\/user\/me|\/subscription/i;
const rootOf = (h: string) => h.split('.').slice(-2).join('.');

// Optional headless-browser pass. Disabled unless ENABLE_PLAYWRIGHT=true. Every request is SSRF-checked.
export async function renderPage(url: string, checkText?: string): Promise<RenderFacts> {
  if (process.env.ENABLE_PLAYWRIGHT !== 'true') return { ok: false, disabled: true };
  let chromium: any;
  try { const name = 'playwright'; chromium = (await import(/* webpackIgnore: true */ name)).chromium; }
  catch { return { ok: false, error: 'Playwright is not installed (run: npm i playwright && npx playwright install chromium).' }; }
  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 }, isMobile: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
    });
    const page = await ctx.newPage();
    const t0 = Date.now();
    const verdict = new Map<string, boolean>();
    const log: { t: number; type: string; host: string; path: string; url: string }[] = [];
    await page.route('**/*', async (route: any) => {
      try {
        const req = route.request(), u = req.url();
        if (!/^https?:/i.test(u)) return await route.continue();
        const p = new URL(u);
        let ok = verdict.get(p.hostname);
        if (ok === undefined) { try { await assertSafeUrl(u); ok = true; } catch { ok = false; } verdict.set(p.hostname, ok); }
        if (!ok) return await route.abort();
        const type = req.resourceType();
        log.push({ t: Date.now() - t0, type, host: p.hostname, path: (p.pathname + p.search).slice(0, 120), url: u });
        if (['image', 'media', 'font'].includes(type)) return await route.abort(); // not needed for this check; keeps it fast
        return await route.continue();
      } catch { /* page or browser already closed */ }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let foundMs: number | null = null;
    if (checkText) {
      await page.waitForFunction((t: string) => !!document.body && document.body.innerText.toLowerCase().includes(t), checkText.toLowerCase(), { timeout: 15000 })
        .then(() => { foundMs = Date.now() - t0; }).catch(() => {});
    }
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const dom = await page.evaluate(() => ({ words: (document.body?.innerText ?? '').trim().split(/\s+/).filter(Boolean).length, h1: document.querySelectorAll('h1').length }));
    const root = rootOf(new URL(url).hostname);
    const hosts = [...new Set(log.map((r) => r.host))];
    const result: RenderFacts = {
      ok: true, words: dom.words, h1: dom.h1, checkTextFoundMs: checkText ? foundMs : null, loadMs: Date.now() - t0,
      totalRequests: log.length, thirdPartyHosts: hosts.filter((h) => rootOf(h) !== root).slice(0, 40),
      adLikeHosts: hosts.filter((h) => AD_RE.test(h)), gtmRequests: log.filter((r) => /googletagmanager\.com/.test(r.host)).length,
      sessionLike: log.filter((r) => SESSION_RE.test(r.url) && r.type !== 'document').slice(0, 10).map((r) => ({ t: r.t, url: r.url.slice(0, 140) })),
      timeline: log.slice(0, 60).map(({ t, type, host, path }) => ({ t, type, host, path })),
    };
    await page.unroute('**/*').catch(() => {});
    return result;
  } catch (e: any) {
    const m = String(e?.message ?? e);
    return { ok: false, error: /Executable doesn't exist/i.test(m) ? 'Chromium not installed. Run: npx playwright install chromium' : `Render failed: ${m.split('\n')[0]}` };
  } finally { await browser?.close().catch(() => {}); }
}