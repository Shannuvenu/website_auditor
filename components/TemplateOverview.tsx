import Link from 'next/link';
import { RatingPill, ScoreBadge } from '@/components/ScoreBadge';
import { StateMessage } from '@/components/StateMessage';
import { formatDateTime } from '@/lib/format';
import { formatSeconds, rateMetric } from '@/lib/pagespeed/ratings';
import type { OverviewRow } from '@/lib/services/overview';

export function TemplateOverview({ rows }: { rows: OverviewRow[] }) {
  if (!rows.length) {
    return (
      <StateMessage title="No templates for this selection">
        The registry has no active template for this brand. Add and activate rows in the Templates sheet, then wait for the first scheduled or manual run. See the README, section &quot;Scheduling&quot;.
      </StateMessage>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Template</th>
            <th className="px-4 py-2">Brand</th>
            <th className="px-4 py-2">Perf</th>
            <th className="px-4 py-2">A11y</th>
            <th className="px-4 py-2">LCP p75</th>
            <th className="px-4 py-2">Top issue</th>
            <th className="px-4 py-2">Measured</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.templateId}-${row.device}`} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/50">
              <td className="px-4 py-3 font-medium">
                <Link className="text-blue-700 hover:underline" href={`/templates/${row.templateId}?device=${row.device}`}>
                  {row.templateName}
                </Link>
              </td>
              <td className="px-4 py-3">{row.brand}</td>
              <td className="px-4 py-3"><ScoreBadge score={row.performance} label="Performance" /></td>
              <td className="px-4 py-3"><ScoreBadge score={row.accessibility} label="Accessibility" /></td>
              <td className="px-4 py-3">
                <RatingPill rating={rateMetric('lcp', row.lcpMs)}>{formatSeconds(row.lcpMs)}</RatingPill>
                {row.lcpSource ? <span className="ml-1 text-xs text-slate-500">{row.lcpSource}</span> : null}
              </td>
              <td className="px-4 py-3">
                {row.status === 'invalid' ? (
                  <span className="text-red-700">
                    Registry row invalid, will not run
                    <span className="block text-xs">{row.problems[0]}</span>
                  </span>
                ) : row.status === 'not-measured' ? (
                  <span className="text-slate-500">Not measured yet</span>
                ) : row.topIssue ? (
                  <>
                    {row.topIssue.title}
                    <span className="block text-xs text-slate-500">
                      {row.topIssue.affectedCount} of {row.topIssue.sampledCount} sample URLs
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">No failing audits</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {row.urlsMeasured}/{row.urlCount} URLs
                <span className="block">{row.status === 'measured' ? formatDateTime(row.generatedAt) : 'No run yet'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}