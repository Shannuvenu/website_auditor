import { loadAppsScript, plain, type GsContext } from './appsScriptVm';
import type { RunRecord, TemplateAggregate, TemplateRegistryEntry } from '../lib/validation/schemas';

/**
 * Builds the synthetic demo dataset (DATA_SOURCE=mock). Per-URL Lighthouse rows are generated from a seeded
 * PRNG and then aggregated with the real Aggregation.gs code, so the demo exercises the production aggregator.
 * Everything here is invented for demonstration. It is not measured data.
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

interface AuditProfile {
  id: string;
  title: string;
  category: 'performance' | 'accessibility';
  ms?: [number, number];
  bytes?: [number, number];
  shared?: string[]; // resources that repeat across URLs
}

const AUDITS: Record<string, AuditProfile> = {
  lcpImage: { id: 'prioritize-lcp-image', title: 'Preload Largest Contentful Paint image', category: 'performance', ms: [600, 1500], shared: [] },
  renderBlocking: { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', category: 'performance', ms: [300, 900], shared: ['/assets/main.css', '/assets/fonts.css'] },
  unusedJs: { id: 'unused-javascript', title: 'Reduce unused JavaScript', category: 'performance', ms: [200, 700], bytes: [150000, 420000], shared: ['/assets/vendor.js', '/assets/ads-loader.js'] },
  imageSize: { id: 'uses-responsive-images', title: 'Properly size images', category: 'performance', ms: [250, 800], bytes: [120000, 600000], shared: ['/media/hero.jpg'] },
  nextGen: { id: 'modern-image-formats', title: 'Serve images in next-gen formats', category: 'performance', bytes: [80000, 350000], shared: ['/media/hero.jpg'] },
  unsized: { id: 'unsized-images', title: 'Image elements do not have explicit width and height', category: 'performance', shared: [] },
  contrast: { id: 'color-contrast', title: 'Background and foreground colors do not have a sufficient contrast ratio', category: 'accessibility', shared: [] },
  imageAlt: { id: 'image-alt', title: 'Image elements do not have [alt] attributes', category: 'accessibility', shared: [] },
  linkName: { id: 'link-name', title: 'Links do not have a discernible name', category: 'accessibility', shared: [] },
};

interface TemplateSpec {
  id: string;
  name: string;
  brand: 'DH' | 'PV';
  pattern: string;
  segment: string;
  perf: Record<'mobile' | 'desktop', number>;
  a11y: number;
  crux: 'url' | 'origin' | 'none';
  failProb: Partial<Record<keyof typeof AUDITS, number>>;
}

const HOSTS = { DH: 'www.deccanherald.com', PV: 'www.prajavani.net' } as const;

const TEMPLATES: TemplateSpec[] = [
  { id: 'DH_ARTICLE', name: 'Article', brand: 'DH', pattern: '/article/*', segment: 'article', perf: { mobile: 47, desktop: 78 }, a11y: 90, crux: 'url', failProb: { lcpImage: 0.8, renderBlocking: 1, unsized: 0.6, unusedJs: 0.7, contrast: 0.4 } },
  { id: 'DH_SECTION', name: 'Section', brand: 'DH', pattern: '/section/*', segment: 'section', perf: { mobile: 66, desktop: 88 }, a11y: 93, crux: 'origin', failProb: { unsized: 0.6, renderBlocking: 0.5, linkName: 0.3 } },
  { id: 'DH_GALLERY', name: 'Gallery', brand: 'DH', pattern: '/gallery/*', segment: 'gallery', perf: { mobile: 54, desktop: 80 }, a11y: 85, crux: 'origin', failProb: { imageSize: 0.9, nextGen: 0.8, imageAlt: 0.5 } },
  { id: 'PV_ARTICLE', name: 'Article', brand: 'PV', pattern: '/article/*', segment: 'article', perf: { mobile: 61, desktop: 84 }, a11y: 88, crux: 'url', failProb: { renderBlocking: 1, unusedJs: 0.5, contrast: 0.6 } },
  { id: 'PV_SECTION', name: 'Section', brand: 'PV', pattern: '/section/*', segment: 'section', perf: { mobile: 70, desktop: 90 }, a11y: 91, crux: 'origin', failProb: { unusedJs: 0.6, linkName: 0.4 } },
  { id: 'PV_GALLERY', name: 'Gallery', brand: 'PV', pattern: '/gallery/*', segment: 'gallery', perf: { mobile: 58, desktop: 82 }, a11y: 84, crux: 'none', failProb: { imageSize: 0.8, nextGen: 0.7, imageAlt: 0.6 } },
];

const SNAPSHOTS = [
  { at: '2026-09-22T02:14:00.000Z', trigger: 'scheduled' as const, drift: -3 },
  { at: '2026-09-29T02:12:00.000Z', trigger: 'scheduled' as const, drift: -1 },
  { at: '2026-10-05T02:11:00.000Z', trigger: 'scheduled' as const, drift: 0 },
];
// A hypothetical shipped fix on DH_ARTICLE (mobile): the hero image is now preloaded. Demonstrates "re-test after a fix".
const RETEST = { templateId: 'DH_ARTICLE', device: 'mobile' as const, at: '2026-10-06T04:40:00.000Z' };

const DEVICES = ['mobile', 'desktop'] as const;

function sampleUrls(t: TemplateSpec): string[] {
  return Array.from({ length: 10 }, (_, i) => `https://${HOSTS[t.brand]}/${t.segment}/demo-${t.segment}-${i + 1}`);
}

function buildRows(gs: GsContext, t: TemplateSpec, device: 'mobile' | 'desktop', runId: string, drift: number, fixed: boolean, skipUrls: string[]) {
  const rng = mulberry32(hash(`${t.id}|${device}|${drift}|${fixed}`));
  const rows: Record<string, unknown>[] = [];
  const urls = sampleUrls(t).filter((u) => !skipUrls.includes(u));
  urls.forEach((url, ui) => {
    const affected = Object.entries(t.failProb).filter(([key, p]) => {
      const prob = fixed && key === 'lcpImage' ? 0.1 : (p as number);
      return ui / 10 + 0.05 < prob || rng() < prob * 0.15;
    });
    for (let run = 1; run <= 3; run++) {
      const perf = Math.max(5, Math.min(99, Math.round(t.perf[device] + drift + (fixed ? 14 : 0) + (rng() - 0.5) * 14)));
      const audits = affected.map(([key]) => {
        const p = AUDITS[key];
        const pick = (r?: [number, number]) => (r ? Math.round(r[0] + rng() * (r[1] - r[0])) : null);
        const resources = (p.shared ?? []).map((r) => `https://${HOSTS[t.brand]}${r}?v=${ui}`);
        resources.push(`https://${HOSTS[t.brand]}/media/${t.segment}-${ui + 1}.jpg`);
        return {
          id: p.id, title: p.title, category: p.category, score: 0, displayValue: null,
          savingsMs: pick(p.ms), savingsBytes: pick(p.bytes),
          items: resources.slice(0, 4).map((resource) => ({ resource, wastedMs: null, wastedBytes: null })),
        };
      });
      const cruxHere = t.crux === 'none' && device === 'desktop' ? 'none' : t.crux;
      rows.push({
        runId, templateId: t.id, brand: t.brand, device, url, runIndex: run, status: 'ok', performance: perf,
        accessibility: Math.max(40, Math.min(100, t.a11y + Math.round((rng() - 0.5) * 6))),
        lcpMs: Math.round((device === 'mobile' ? 4300 : 1900) - (perf - t.perf[device]) * 30 + rng() * 400),
        cls: Number((0.05 + (affected.some(([k]) => k === 'unsized') ? 0.1 : 0) + rng() * 0.04).toFixed(3)),
        tbtMs: Math.round(device === 'mobile' ? 380 + rng() * 200 : 90 + rng() * 60),
        fcpMs: Math.round(device === 'mobile' ? 2100 + rng() * 300 : 900 + rng() * 150),
        speedIndexMs: Math.round(device === 'mobile' ? 4800 + rng() * 600 : 2200 + rng() * 300),
        cruxScope: run === 1 ? cruxHere : 'none',
        cruxLcpMs: run === 1 && cruxHere !== 'none' ? Math.round((device === 'mobile' ? 4300 : 2100) + rng() * 300) : null,
        cruxCls: run === 1 && cruxHere !== 'none' ? Number((0.12 + rng() * 0.04).toFixed(2)) : null,
        cruxInpMs: run === 1 && cruxHere !== 'none' ? Math.round(220 + rng() * 40) : null,
        audits,
      });
    }
  });
  void gs;
  return { rows, urls: sampleUrls(t) };
}

export interface MockFixtures {
  templates: TemplateRegistryEntry[];
  aggregates: TemplateAggregate[];
  runs: RunRecord[];
}

export function generateMockFixtures(): MockFixtures {
  const gs = loadAppsScript();
  const aggregate = gs.Aggregation_aggregate_ as GsFunction2;
  const templates: TemplateRegistryEntry[] = TEMPLATES.map((t) => ({
    templateId: t.id, templateName: t.name, brand: t.brand, urlPattern: t.pattern, sampleUrls: sampleUrls(t),
    active: true, trafficWeight: null, notes: 'Demo template (synthetic data)', problems: [],
  }));
  const aggregates: TemplateAggregate[] = [];
  const runs: RunRecord[] = [];

  const add = (t: TemplateSpec, device: 'mobile' | 'desktop', at: string, trigger: 'scheduled' | 'retest', drift: number, fixed: boolean, skip: string[], requestedBy: string | null) => {
    const runId = `mock-${t.id.toLowerCase()}-${device}-${at.slice(0, 10).replace(/-/g, '')}${trigger === 'retest' ? '-rt' : ''}`;
    const { rows, urls } = buildRows(gs, t, device, runId, drift, fixed, skip);
    const agg = plain<TemplateAggregate>(
      aggregate({ template: { templateId: t.id, templateName: t.name, brand: t.brand }, device, runId, trigger, generatedAt: at, plannedUrls: urls, rows, maxAudits: 40 }),
    );
    aggregates.push(agg);
    const started = new Date(Date.parse(at) - 9 * 60 * 1000).toISOString();
    const failedAll = t.id === 'PV_GALLERY' && device === 'desktop' && drift === -3;
    runs.push({
      runId, createdAt: started, startedAt: started, finishedAt: at, trigger, requestedBy, brand: t.brand, templateId: t.id, device,
      status: failedAll ? 'failed' : agg.urlsMeasured < urls.length ? 'partial' : 'completed',
      urlCount: urls.length, urlsDone: urls.length, urlsFailed: urls.length - agg.urlsMeasured,
      summary: { urlsMeasured: agg.urlsMeasured, performance: agg.scores.performance, accessibility: agg.scores.accessibility, lcpMs: agg.labMetrics.lcpMs, failingAudits: agg.audits.length },
      error: failedAll ? 'PageSpeed API unavailable after retries' : null,
    });
  };

  for (const snap of SNAPSHOTS) {
    for (const t of TEMPLATES) {
      for (const device of DEVICES) {
        const skip = t.id === 'PV_SECTION' && device === 'mobile' && snap.drift === 0 ? [sampleUrls(t)[8], sampleUrls(t)[9]] : [];
        add(t, device, snap.at, snap.trigger, snap.drift, false, skip, null);
      }
    }
  }
  const rt = TEMPLATES.find((t) => t.id === RETEST.templateId) as TemplateSpec;
  add(rt, RETEST.device, RETEST.at, 'retest', 0, true, [], 'dev');

  // The one run whose every URL failed produces no aggregate: drop it from the aggregates list.
  const failed = runs.find((r) => r.status === 'failed');
  const out = failed ? aggregates.filter((a) => a.runId !== failed.runId) : aggregates;
  return { templates, aggregates: out, runs };
}

type GsFunction2 = (input: unknown) => unknown;
