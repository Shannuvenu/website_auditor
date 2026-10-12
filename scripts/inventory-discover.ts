/**
 * Template inventory discovery. Reads robots.txt and sitemaps of the configured brand hosts and writes a
 * reviewable inventory. It never runs PageSpeed and never writes to the registry: an administrator reviews
 * templates.proposed.csv and adds approved rows to the Templates sheet.
 *
 *   npm run inventory:discover -- [--brand DH|PV|all] [--registry templates.csv] [--verify]
 *                                 [--max-urls 300000] [--max-sitemaps 200] [--delay-ms 400] [--out dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCsv } from '../lib/inventory/csv';
import { discoverCandidates, type DiscoverResult } from '../lib/inventory/discover';
import { buildFamilies, findUnmatched, type Family } from '../lib/inventory/families';
import { createHttpGet, getFollowing } from '../lib/inventory/http';
import { discoverFromHomepage } from '../lib/inventory/nav';
import { registryFromCsv } from '../lib/inventory/registryCsv';
import { parseRobots } from '../lib/inventory/urls';
import { summarizeEvidence, verifySamples, type EvidenceSummary, type PageEvidence } from '../lib/inventory/verify';
import { BRAND_HOSTS } from '../lib/templates/brands';
import { MAX_SAMPLES, validateTemplate } from '../lib/templates/registry';
import type { Brand, TemplateRegistryEntry } from '../lib/validation/schemas';

const USER_AGENT = 'TemplatePageSpeedAdvisor-InventoryBot/1.0 (internal template inventory; reads robots.txt and sitemaps)';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (flag('help')) {
    console.log('Usage: npm run inventory:discover -- [--brand DH|PV|all] [--registry file.csv] [--verify] [--max-urls N] [--max-sitemaps N] [--delay-ms N] [--out dir]');
    return;
  }
  const brandArg = (arg('brand') ?? 'all').toUpperCase();
  const brands = (brandArg === 'ALL' ? (Object.keys(BRAND_HOSTS) as Brand[]) : ([brandArg] as Brand[])).filter((b) => b in BRAND_HOSTS);
  if (!brands.length) throw new Error(`Unknown brand "${brandArg}". Use DH, PV or all.`);
  const registry = arg('registry') ? registryFromCsv(readFileSync(arg('registry') as string, 'utf8')) : [];
  const delayMs = Number(arg('delay-ms') ?? 400);
  const get = createHttpGet({ userAgent: USER_AGENT });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const outDir = arg('out') ?? join('inventory-output', stamp);
  mkdirSync(outDir, { recursive: true });

  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), registryRows: registry.length, verified: flag('verify'), brands: {} };
  const proposedRows: (string | number | boolean)[][] = [[
    'template_id', 'template_name', 'brand', 'url_pattern', 'sample_urls', 'active', 'traffic_weight', 'notes',
    'status', 'candidate_url_count', 'valid_sample_count', 'top_sections', 'validation_errors', 'evidence', 'discovery_source', 'needs_approval',
  ]];
  const unmatchedRows: (string | number)[][] = [['brand', 'url', 'sitemap']];
  const rejectedRows: (string | number)[][] = [['brand', 'reason', 'count']];
  const summary: string[] = [];

  for (const brand of brands) {
    console.log(`\n== ${brand} ==`);
    const found: DiscoverResult = await discoverCandidates({
      brand, get, delayMs, maxUrls: Number(arg('max-urls') ?? 300_000), maxSitemaps: Number(arg('max-sitemaps') ?? 200),
    });
    console.log(`sitemaps read: ${found.sitemapsRead.length}, candidate URLs: ${found.candidates.length}, duplicates dropped: ${found.duplicatesDropped}`);
    Object.entries(found.rejectedCounts).forEach(([reason, count]) => console.log(`  not used: ${count} x ${reason}`));
    found.warnings.forEach((w) => console.warn(`warning: ${w}`));
    if (found.truncated) console.warn('warning: stopped at a limit, so some sections may be missing. Raise --max-urls / --max-sitemaps.');

    // The home page's own links: section fronts and landing pages that sitemaps often leave out.
    const robotsForNav = await getFollowing(get, `https://${BRAND_HOSTS[brand][0]}/robots.txt`, brand);
    const nav = await discoverFromHomepage({ brand, get, robotsRules: robotsForNav.ok ? parseRobots(robotsForNav.body).rules : [] });
    const known = new Set(found.candidates.map((c) => c.url));
    const navOnly = nav.candidates.filter((c) => !known.has(c.url));
    found.candidates.push(...navOnly);
    console.log(nav.ok ? `home page links: ${nav.candidates.length} internal, ${navOnly.length} not in any sitemap` : `warning: home page links not read (${nav.problem})`);
    const externalList = Object.entries(nav.externalHosts).sort((a, b) => b[1] - a[1]);
    if (externalList.length) console.log(`  home page also links to other hosts (not measured): ${externalList.map(([h, n]) => `${h} x${n}`).join(', ')}`);

    const families: Family[] = buildFamilies(brand, found.candidates, registry);
    const evidence: Record<string, EvidenceSummary> = {};
    const sampleEvidence: Record<string, Record<string, PageEvidence | undefined>> = {};
    if (flag('verify') && found.candidates.length) {
      const robotsRes = await getFollowing(get, `https://${BRAND_HOSTS[brand][0]}/robots.txt`, brand);
      const rules = robotsRes.ok ? parseRobots(robotsRes.body).rules : [];
      for (const family of families) {
        console.log(`verifying ${family.suggestedTemplateId} (${family.pool.length} candidates)`);
        const checked = await verifySamples({ brand, urls: family.pool, get, robotsRules: rules, delayMs, stopAfterOk: MAX_SAMPLES });
        const good = checked.filter((c) => c.ok);
        family.samples = good.map((c) => c.url);
        const entry: TemplateRegistryEntry = { templateId: family.suggestedTemplateId, templateName: family.suggestedName, brand, urlPattern: family.pattern, sampleUrls: family.samples, active: false, trafficWeight: null, notes: family.notes };
        const countProblems = validateTemplate(entry).filter((p) => p.startsWith('needs '));
        family.sampleShortfall = countProblems.length > 0;
        family.problems = [
          ...family.problems.filter((p) => !p.startsWith('needs ')),
          ...countProblems,
          ...checked.filter((c) => !c.ok).map((c) => `sample rejected: ${c.url} (${c.reason})`),
        ];
        const summaryOf = summarizeEvidence(good.map((c) => c.evidence).filter((e): e is PageEvidence => Boolean(e)));
        evidence[family.suggestedTemplateId] = summaryOf;
        sampleEvidence[family.suggestedTemplateId] = Object.fromEntries(good.map((c) => [c.url, c.evidence]));
        if (summaryOf.mixed) family.problems.push('mixed page evidence in this group: review before approving');
      }
    }

    const unmatched = registry.length ? findUnmatched(found.candidates, registry) : [];
    summary.push(`==== ${brand}: ${found.candidates.length} candidate URLs, ${families.length} proposed groups ====`);
    summary.push(`Home page links not in any sitemap (${navOnly.length}): ${navOnly.map((c) => c.path).join(' ')}`);
    summary.push(`Other hosts linked from the home page (not measured): ${externalList.map(([h, n]) => `${h} x${n}`).join(', ') || 'none'}`, '');
    for (const f of families) {
      const ev = evidence[f.suggestedTemplateId];
      const perUrl = sampleEvidence[f.suggestedTemplateId] ?? {};
      proposedRows.push([
        f.suggestedTemplateId, f.suggestedName, brand, f.pattern, f.samples.join('\n'), false, '', f.notes,
        f.status, f.candidateCount, f.samples.length,
        Object.entries(f.sections).map(([s, n]) => `${s}:${n}`).join(' '),
        f.problems.join(' | '),
        ev ? `og:type ${JSON.stringify(ev.ogTypes)}; ld ${JSON.stringify(ev.ldTypes)}` : 'not verified (run with --verify)',
        'sitemap', true,
      ]);
      summary.push(
        `${f.suggestedTemplateId} | ${brand} | pattern ${f.pattern} | candidates=${f.candidateCount} samples=${f.samples.length} | ${Object.entries(f.sections).map(([s, n]) => `${s}:${n}`).join(' ')}`,
        `   STATUS: ${f.status}`,
        `   PROBLEMS: ${f.problems.join(' | ')}`,
        `   EVIDENCE: ${ev ? `og:type ${JSON.stringify(ev.ogTypes)}; ld ${JSON.stringify(ev.ldTypes)}` : 'not verified'}`,
        ...f.samples.map((u) => `   - ${u}${perUrl[u] ? `  [og:${perUrl[u]?.ogType ?? 'none'} ld:${perUrl[u]?.ldTypes.join('+') || 'none'}]` : ''}`),
        '',
      );
    }
    unmatched.forEach((c) => unmatchedRows.push([brand, c.url, c.sitemap]));
    Object.entries(found.rejectedCounts).forEach(([reason, count]) => rejectedRows.push([brand, reason, count]));
    (report.brands as Record<string, unknown>)[brand] = {
      robotsFound: found.robotsFound, sitemapsRead: found.sitemapsRead, sitemapsSkipped: found.sitemapsSkipped,
      candidateUrls: found.candidates.length, duplicatesDropped: found.duplicatesDropped, truncated: found.truncated,
      rejectedCounts: found.rejectedCounts, rejectedExamples: found.rejectedExamples, warnings: found.warnings,
      homepageLinks: { ok: nav.ok, problem: nav.problem ?? null, internal: nav.candidates.map((c) => c.url), notInSitemaps: navOnly.map((c) => c.url), externalHosts: nav.externalHosts },
      unmatchedByRegistry: registry.length ? unmatched.length : 'registry not provided',
      families: families.map((f) => ({ ...f, evidence: evidence[f.suggestedTemplateId] ?? null, sampleEvidence: sampleEvidence[f.suggestedTemplateId] ?? null })),
    };
    const withProblems = families.filter((f) => f.problems.length).length;
    console.log(`proposed families: ${families.length} (${withProblems} with problems, ${families.filter((f) => f.sampleShortfall).length} with too few samples)`);
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'templates.proposed.csv'), toCsv(proposedRows));
  writeFileSync(join(outDir, 'unmatched.csv'), toCsv(unmatchedRows.slice(0, 5001)));
  writeFileSync(join(outDir, 'rejected.csv'), toCsv(rejectedRows));
  writeFileSync(join(outDir, 'summary.txt'), summary.join('\n'));
  console.log(`\nWrote ${outDir}${'/'}{summary.txt,templates.proposed.csv,report.json,unmatched.csv,rejected.csv}`);
  console.log('Nothing was activated and no PageSpeed run was started. Send summary.txt for review.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
