import { RatingPill } from '@/components/ScoreBadge';
import { RetestButton } from '@/components/RetestButton';
import { formatCls, formatMs, formatSeconds, rateMetric } from '@/lib/pagespeed/ratings';
import type { TemplateAggregate } from '@/lib/validation/schemas';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between py-1 text-sm">
    <span className="text-slate-600">{label}</span>
    {children}
  </div>
);

export function EvidencePanel({ aggregate, canRetest }: { aggregate: TemplateAggregate; canRetest: boolean }) {
  const { crux, labMetrics: lab } = aggregate;
  const cruxLabel = crux.scope === 'url' ? `URL-level, ${crux.urlCount} URLs` : crux.scope === 'origin' ? 'Origin-level (URL data unavailable)' : 'No CrUX data';
  return (
    <aside className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <section>
        <h3 className="text-sm font-semibold">Sample URLs</h3>
        <p className="text-sm text-slate-600">{aggregate.urlsMeasured} of {aggregate.urlCount} URLs measured, {aggregate.runsPerUrl} runs each (median)</p>
        {aggregate.representativeUrls.length ? (
          <details className="mt-1 text-xs text-slate-600">
            <summary className="cursor-pointer">Representative URLs</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{aggregate.representativeUrls.map((u) => <li key={u} className="break-all">{u}</li>)}</ul>
          </details>
        ) : null}
      </section>

      <section className="border-t border-slate-100 pt-3">
        <h3 className="text-sm font-semibold">Field data (CrUX p75)</h3>
        <p className="mb-1 text-xs text-slate-500">{cruxLabel}</p>
        <Row label="LCP"><RatingPill rating={rateMetric('lcp', crux.lcpMs)}>{formatSeconds(crux.lcpMs)}</RatingPill></Row>
        <Row label="CLS"><RatingPill rating={rateMetric('cls', crux.cls)}>{formatCls(crux.cls)}</RatingPill></Row>
        <Row label="INP"><RatingPill rating={rateMetric('inp', crux.inpMs)}>{formatMs(crux.inpMs)}</RatingPill></Row>
      </section>

      <section className="border-t border-slate-100 pt-3">
        <h3 className="text-sm font-semibold">Lab metrics (median)</h3>
        <Row label="LCP"><RatingPill rating={rateMetric('lcp', lab.lcpMs)}>{formatSeconds(lab.lcpMs)}</RatingPill></Row>
        <Row label="CLS"><RatingPill rating={rateMetric('cls', lab.cls)}>{formatCls(lab.cls)}</RatingPill></Row>
        <Row label="TBT"><RatingPill rating={rateMetric('tbt', lab.tbtMs)}>{formatMs(lab.tbtMs)}</RatingPill></Row>
        <Row label="FCP"><RatingPill rating={rateMetric('fcp', lab.fcpMs)}>{formatSeconds(lab.fcpMs)}</RatingPill></Row>
      </section>

      <section className="border-t border-slate-100 pt-3 text-sm">
        <h3 className="font-semibold">How fixes are ranked</h3>
        <p className="text-slate-600">savings × share of URLs × traffic weight ÷ effort (S=1, M=2, L=4). Computed in code, not by the model.</p>
      </section>

      <section className="border-t border-slate-100 pt-3 text-sm">
        <h3 className="mb-1 font-semibold">After a fix</h3>
        {canRetest ? <RetestButton templateId={aggregate.templateId} device={aggregate.device} /> : <p className="text-slate-600">Ask an admin to re-run the same sample URLs.</p>}
      </section>
    </aside>
  );
}
