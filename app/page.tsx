'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const STAGES = ['Fetching website', 'Running PageSpeed analysis', 'Checking security headers', 'Generating recommendations'];
const SHOW = ['Performance', 'Accessibility', 'Best Practices', 'Security'];
const SHOWN_SEV = ['critical', 'high', 'medium'];
const SHOWN_STATUS = ['FAIL', 'WARNING', 'ERROR'];
const SEV: Record<string, string> = { critical: 'bg-red-100 text-red-800', high: 'bg-orange-100 text-orange-800', medium: 'bg-yellow-100 text-yellow-800', low: 'bg-blue-100 text-blue-800', info: 'bg-slate-100 text-slate-700' };
const RATING: Record<string, string> = { good: 'text-green-600', 'needs-improvement': 'text-orange-500', poor: 'text-red-600', unavailable: 'text-slate-400' };
const RLABEL: Record<string, string> = { good: 'Good', 'needs-improvement': 'Needs Improvement', poor: 'Poor', unavailable: 'Unavailable' };
const col = (s: number | null) => (s == null ? 'text-slate-400' : s >= 90 ? 'text-green-600' : s >= 50 ? 'text-orange-500' : 'text-red-600');

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [checkText, setCheckText] = useState('');

  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 12000);
    return () => clearInterval(t);
  }, [loading]);

  async function run(e: React.FormEvent) {
    e.preventDefault(); setError(''); setData(null); setLoading(true);
    try {
      const res = await fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, checkText }) });
      const text = await res.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch {}
      if (!res.ok || !j) throw new Error(j?.error || `Server returned HTTP ${res.status} with an ${text ? 'invalid' : 'empty'} response. Check the terminal running npm run dev for the error.`);
      setData({ ...j, _checkText: checkText });
    } catch (err: any) { setError(err.message || 'Something went wrong'); }
    setLoading(false);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Website Audit &amp; Performance Analyzer</h1>
        <p className="mt-2 text-slate-600">Enter any public URL. Every finding is backed by PageSpeed data or a verified crawl.</p>
        <form onSubmit={run} className="mx-auto mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com/page" className="flex-1 rounded-lg border border-slate-300 px-4 py-3" required />
          <button disabled={loading} className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white disabled:opacity-60">{loading ? 'Analyzing…' : 'Analyze Website'}</button>
        </form>
        <input value={checkText} onChange={(e) => setCheckText(e.target.value)} placeholder='Optional: text that must be in the server HTML, e.g. "1 Year Digital"' className="mx-auto mt-2 block w-full max-w-2xl rounded-lg border border-slate-300 px-4 py-2 text-sm" />
      </header>

      {error && <p className="mx-auto mt-6 max-w-2xl rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
      {loading && (
        <div className="mx-auto mt-8 max-w-md rounded-xl border bg-white p-6">
          <div className="mb-3 h-2 overflow-hidden rounded bg-slate-200"><div className="h-2 animate-pulse bg-indigo-600 transition-all" style={{ width: `${((stage + 1) / STAGES.length) * 100}%` }} /></div>
          <ul className="space-y-1 text-sm">{STAGES.map((s, i) => <li key={s} className={i < stage ? 'text-green-600' : i === stage ? 'font-medium' : 'text-slate-400'}>{i < stage ? '✓' : i === stage ? '…' : '○'} {s}</li>)}</ul>
          <p className="mt-3 text-xs text-slate-500">Analysis usually takes 30–90 seconds. Stages are indicative; all checks run in one request.</p>
        </div>
      )}
      {data && <Report d={data} />}
    </main>
  );
}

function Report({ d }: { d: any }) {
  const cats = Object.entries<any>(d.categories).filter(([n]) => SHOW.includes(n));
  const groups: Record<string, any[]> = {};
  d.issues
    .filter((i: any) => SHOW.includes(i.category) && SHOWN_STATUS.includes(i.status) && SHOWN_SEV.includes(i.severity))
    .forEach((i: any) => (groups[i.category] ||= []).push(i));
  const ssr = d.issues.find((i: any) => i.id === 'ssr-check');
  const m = d.pagespeed.mobile, r = d.recommendations;
  const runs = m.extra?.runs;
  return (
    <div className="mt-10 space-y-8">
      <section className="rounded-xl border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0"><p className="break-all font-medium">{d.finalUrl || d.url}</p><p className="text-sm text-slate-500">{new Date(d.timestamp).toLocaleString()}{d.cached && ' · cached result'}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm"><span className="rounded bg-slate-100 px-2 py-1">{d.summary.totalIssues} issues</span>
          {(['critical', 'high', 'medium'] as const).map((s) => <span key={s} className={`rounded px-2 py-1 ${SEV[s]}`}>{d.summary.severity[s]} {s}</span>)}</div>
        {ssr && <p className={`mt-3 text-sm ${ssr.status === 'PASS' ? 'text-green-700' : 'text-red-700'}`}>{ssr.title}: {ssr.status === 'PASS' ? 'found in the initial server HTML.' : ssr.evidence}</p>}
        {!m.ok && <p className="mt-3 text-sm text-orange-700">PageSpeed (mobile): audit incomplete — {m.error}</p>}
        {!d.pagespeed.desktop.ok && <p className="mt-1 text-sm text-orange-700">PageSpeed (desktop): audit incomplete — {d.pagespeed.desktop.error}</p>}
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cats.map(([n, c]) => (
          <div key={n} className="rounded-xl border bg-white p-4"><p className="text-sm font-medium">{n}</p>
            <p className={`text-3xl font-bold ${c.source?.startsWith('Own') ? 'text-slate-400' : col(c.score)}`}>{c.source?.startsWith('Own') ? '—' : c.score ?? 'N/A'}</p>
            <p className="text-xs text-slate-500">{c.issues} issue(s)</p><p className="mt-1 text-[11px] text-slate-400">{c.source}</p></div>
        ))}
      </section>

      <section><h2 className="mb-3 text-xl font-semibold">Core Web Vitals <span className="text-sm font-normal text-slate-500">(Lighthouse lab data, mobile)</span></h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const).map((k) => { const x = m.metrics?.[k] ?? { display: 'Data unavailable', rating: 'unavailable' };
            return <div key={k} className="rounded-xl border bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">{k}</p><p className="text-lg font-bold">{x.display}</p><p className={`text-sm ${RATING[x.rating]}`}>{RLABEL[x.rating]}</p></div>; })}
        </div>
        <p className="mt-2 text-xs text-slate-500">INP is only available from real-user field data when Google has enough traffic for this URL.</p>
        {runs && (
          <p className="mt-1 text-xs text-slate-500">
            Lab values are from the median of {runs.succeeded}/{runs.requested} PageSpeed runs. Performance scores across runs: {runs.perfScores.join(', ')}
            {runs.lcpMsMin != null && runs.lcpMsMax != null && ` · LCP range ${(runs.lcpMsMin / 1000).toFixed(2)}–${(runs.lcpMsMax / 1000).toFixed(2)} s`}.
          </p>
        )}
      </section>

      <section><h2 className="mb-3 text-xl font-semibold">PageSpeed Insights <span className="text-sm font-normal text-slate-500">(Google Lighthouse)</span></h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(['mobile', 'desktop'] as const).map((st) => { const p = d.pagespeed[st]; return (
            <div key={st} className="rounded-xl border bg-white p-4">
              <h3 className="mb-2 font-semibold capitalize">{st}</h3>
              {!p.ok ? <p className="text-sm text-orange-700">Audit incomplete — {p.error}</p> : (<>
                <div className="grid grid-cols-4 gap-2 text-center">{Object.entries(p.scores).map(([k, v]) => <div key={k}><div className={`text-2xl font-bold ${col(v as number | null)}`}>{(v as number | null) ?? 'N/A'}</div><div className="text-[11px] text-slate-500">{k}</div></div>)}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">{(['fcp', 'lcp', 'tbt', 'cls', 'si', 'ttfb'] as const).map((k) => { const x = p.metrics[k]; return <div key={k}><span className="text-xs uppercase text-slate-500">{k}</span><div className={RATING[x.rating]}>{x.display}</div></div>; })}</div>
              </>)}
            </div>); })}
        </div></section>

      <section><h2 className="mb-3 text-xl font-semibold">Top 5 Issues <span className="text-sm font-normal text-slate-500">(AI-ranked root causes, evidence from verified findings)</span></h2>
        <p className="mb-2 text-xs text-slate-500">Automated checks catch only a minority of accessibility problems. A high accessibility score does not mean the page is accessible.</p>
        {!r.available ? <p className="rounded-xl border bg-white p-4 text-slate-600">{r.reason}</p> : (
          <div className="space-y-3">
            {r.summary && <p className="rounded-xl border bg-white p-4">{r.summary}</p>}
            {r.topIssues?.length === 0 && <p className="rounded-xl border bg-white p-4 text-slate-600">No major issues to report.</p>}
            {r.topIssues?.map((t: any) => (
              <div key={t.rank} className="rounded-xl border bg-white p-4">
                <p className="font-semibold">#{t.rank} {t.title}</p>
                <p className="mt-1 text-sm text-slate-600">{t.whyItMatters}</p>
                <p className="mt-1 text-sm"><span className="font-medium">Root cause:</span> {t.rootCause}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-1">Effort: {t.effort}</span>
                  <span className="rounded bg-slate-100 px-2 py-1">Business risk: {t.businessRisk}</span>
                  <span className="rounded bg-slate-100 px-2 py-1">Evidence strength: {t.confidence}</span>
                  <span className="rounded bg-slate-100 px-2 py-1">Affected: {t.affected}</span>
                </div>
                {t.unverified?.length > 0 && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">⚠ Not found in the evidence, verify before using: {t.unverified.join(', ')}</p>}
                <div className="mt-2 rounded bg-slate-50 p-3 text-xs">
                  <p className="font-medium text-slate-700">Verified evidence</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-600">{t.evidence.map((e: any) => <li key={e.id}><b>{e.title}:</b> {e.text}</li>)}</ul>
                </div>
                <p className="mt-2 text-sm font-medium">How to fix</p>
                <ol className="list-decimal pl-5 text-sm">{t.fixSteps.map((s: string, j: number) => <li key={j}>{s}</li>)}</ol>
                <p className="mt-2 text-xs text-slate-600"><b>Where to fix:</b> {t.fixLocation}</p>
                <p className="mt-1 text-xs text-slate-600"><b>Risk note:</b> {t.riskNote}</p>
              </div>))}
          </div>)}
      </section>

      <Chat d={d} />

      <section><h2 className="mb-3 text-xl font-semibold">Detailed Results <span className="text-sm font-normal text-slate-500">(critical, high and medium issues only)</span></h2>
        {Object.keys(groups).length === 0 && <p className="rounded-xl border bg-white p-4 text-slate-600">No critical, high or medium issues found.</p>}
        <div className="space-y-2">{Object.entries(groups).map(([cat, items]) => (
          <details key={cat} className="rounded-xl border bg-white" open={items.some((i) => i.status === 'FAIL')}>
            <summary className="cursor-pointer p-4 font-medium">{cat} <span className="text-sm text-slate-500">({items.length} issues)</span></summary>
            <div className="divide-y border-t">{items.map((i) => (
              <div key={i.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${SEV[i.severity]}`}>{i.severity}</span><b>{i.title}</b><span className="text-xs text-slate-500">{i.status} · {i.source === 'pagespeed' ? 'PageSpeed' : 'Crawler'}</span></div>
                <p className="mt-1"><span className="font-medium">Evidence:</span> {i.evidence}</p>
                {i.explanation && <p className="mt-1 text-slate-600"><span className="font-medium">Why it matters:</span> {i.explanation}</p>}
                {i.recommendation && <p className="mt-1"><span className="font-medium">Recommended fix:</span> {i.recommendation}</p>}
              </div>))}</div>
          </details>))}</div></section>
    </div>
  );
}

function Chat({ d }: { d: any }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ q: string; a: string; ids: string[]; bad: string[] }[]>([]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;

    setBusy(true);
    setQ('');

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: d.url,
          checkText: d._checkText ?? '',
          question,
        }),
      });

      const j = await res.json();

      setLog((l) => [
        ...l,
        {
          q: question,
          a: res.ok ? j.answer : j.error || 'Request failed',
          ids: res.ok ? j.findingIds ?? [] : [],
          bad: res.ok ? j.unverified ?? [] : [],
        },
      ]);
    } catch (err: any) {
      setLog((l) => [
        ...l,
        {
          q: question,
          a: err.message || 'Request failed',
          ids: [],
          bad: [],
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold">
        Ask about this report{' '}
        <span className="text-sm font-normal text-slate-500">
          (answers only from the evidence above)
        </span>
      </h2>

      <div className="space-y-3">
        {log.map((x, i) => (
          <div key={i} className="rounded-xl border bg-white p-4 text-sm">
            <p className="font-medium">Q: {x.q}</p>
            <p className="mt-1 whitespace-pre-wrap">{x.a}</p>

            {x.ids.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Evidence: {x.ids.join(', ')}
              </p>
            )}

            {x.bad.length > 0 && (
              <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
                ⚠ Not found in the report, verify: {x.bad.join(', ')}
              </p>
            )}
          </div>
        ))}

        <form onSubmit={ask} className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Why is LCP poor on mobile?"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>
      </div>
    </section>
  );
}
