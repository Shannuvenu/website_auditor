import { formatDateTime, formatSignedDelta } from '@/lib/format';
import { formatSeconds } from '@/lib/pagespeed/ratings';
import type { Comparison } from '@/lib/services/compare';
import type { HistoryPoint } from '@/lib/services/detail';

const CHANGE_STYLE: Record<string, string> = {
  resolved: 'text-green-700',
  improved: 'text-green-700',
  worse: 'text-red-700',
  new: 'text-red-700',
  unchanged: 'text-slate-500',
};

export function MeasuredHistory({ history, comparison }: { history: HistoryPoint[]; comparison: Comparison | null }) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Measured results over time</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr><th className="py-1 pr-3">Run</th><th className="pr-3">Type</th><th className="pr-3">Perf</th><th className="pr-3">A11y</th><th className="pr-3">LCP</th><th>URLs</th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.runId} className="border-t border-slate-100">
                <td className="py-1 pr-3">{formatDateTime(h.generatedAt)}</td>
                <td className="pr-3">{h.trigger === 'retest' ? 'Re-test' : 'Scheduled'}</td>
                <td className="pr-3 tabular-nums">{h.performance ?? 'n/a'}</td>
                <td className="pr-3 tabular-nums">{h.accessibility ?? 'n/a'}</td>
                <td className="pr-3 tabular-nums">{formatSeconds(h.lcpMs)}</td>
                <td>{h.urlsMeasured}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comparison ? (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Latest run vs previous run</p>
          <p>
            Performance {formatSignedDelta(comparison.performanceDelta)}, accessibility {formatSignedDelta(comparison.accessibilityDelta)}, LCP{' '}
            {formatSignedDelta(comparison.cruxLcpDeltaMs ?? comparison.labLcpDeltaMs, ' ms')}
          </p>
          {!comparison.sameSampleSet ? <p className="text-amber-800">The sample URL sets differ between these runs, so treat the comparison with care.</p> : null}
          <ul className="space-y-0.5">
            {comparison.audits.map((a) => (
              <li key={a.auditId} className={CHANGE_STYLE[a.change]}>
                {a.title}: {a.beforeAffected ?? 0}/{a.beforeSampled} → {a.afterAffected ?? 0}/{a.afterSampled} URLs ({a.change})
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-600">Only one run exists so far. Re-run the same sample URLs after a fix to compare.</p>
      )}
    </section>
  );
}
