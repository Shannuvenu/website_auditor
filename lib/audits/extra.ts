import type { CrawlFacts } from '@/lib/crawler/crawl';
import type { RenderFacts } from '@/lib/crawler/render';
import type { Finding } from '@/types/audit';

const mk = (id: string, category: string, title: string, status: Finding['status'], severity: Finding['severity'], evidence: string, explanation: string, recommendation: string): Finding =>
  ({ id, category, title, status, severity, evidence, explanation, recommendation, source: 'crawler' });

export function extraFindings(c: CrawlFacts | null, r: RenderFacts | null): Finding[] {
  const out: Finding[] = [];
  const s = c?.serverCheck;
  if (s) {
    const where = s.inVisibleText ? '' : s.inHtml ? 'The text appears only inside script/data blocks of the initial HTML, not as rendered markup.' : 'The text was not found in the initial server HTML.';
    const browser = !s.inVisibleText && r?.ok ? (r.checkTextFoundMs != null ? ` In a headless browser it appeared after ${r.checkTextFoundMs} ms.` : ' It was also not found after rendering in a headless browser.') : '';
    out.push(mk('ssr-check', 'Performance', `Server-rendered content check: "${s.text}"`, s.inVisibleText ? 'PASS' : 'FAIL', s.inVisibleText ? 'info' : 'high',
      s.inVisibleText ? `"${s.text}" was found in the visible text of the initial server HTML.` : `${where}${browser}`,
      'Content missing from the first HTML response waits for JavaScript before it can paint, and crawlers that do not run JavaScript may not see it.',
      s.inVisibleText ? '' : 'Server-render this content (SSR/SSG) and cache the HTML at the CDN; personalise on the client afterwards.'));
  }
  if (r && !r.ok && !r.disabled) out.push(mk('render-error', 'Performance', 'Browser rendering check incomplete', 'INCOMPLETE', 'info', r.error ?? 'Unknown error', '', ''));
  if (r?.ok) {
    const ads = r.adLikeHosts ?? [];
    out.push(mk('render-ads', 'Performance', 'Ad-network requests on this page', ads.length ? 'WARNING' : 'PASS', ads.length ? 'medium' : 'info',
      ads.length ? `${ads.length} host(s) match known ad-network patterns: ${ads.join(', ')} (seen in a headless browser run).` : 'No requests to known ad-network hosts were observed.',
      'Ad scripts add network and main-thread work. This is a host-pattern match only; it does not prove ads were rendered.',
      ads.length ? 'If this page should be ad-free, stop loading these scripts on this route.' : ''));
    const sess = r.sessionLike ?? [];
    if (sess.length) {
      const first = sess[0].t, found = r.checkTextFoundMs;
      const before = found != null && first < found;
      out.push(mk('render-session', 'Performance', 'Session/entitlement-like requests during load', before ? 'WARNING' : 'PASS', before ? 'medium' : 'info',
        `${sess.length} request(s) matched session/entitlement URL patterns; first at ${first} ms${found != null ? `, checked text appeared at ${found} ms` : ''}: ${sess.slice(0, 3).map((x) => x.url).join(' ; ')}`,
        'URL-pattern heuristic from an unthrottled headless run. Timings show ordering only and are not comparable to Lighthouse numbers. Confirm in a DevTools trace.',
        before ? 'Do not block rendering of public content on a session or entitlement call; render defaults first and personalise afterwards.' : ''));
    }
    if (c && (r.words ?? 0) > c.content.wordCount * 2 + 100 && c.content.wordCount < 300)
      out.push(mk('render-wordcount', 'Performance', 'Content is mostly client-rendered', 'WARNING', 'medium',
        `${c.content.wordCount} words in the server HTML vs ${r.words} after rendering.`, 'Most visible text only exists after JavaScript runs.', 'Server-render the primary content.'));
  }
  return out;
}
