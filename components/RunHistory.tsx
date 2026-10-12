import { StateMessage } from '@/components/StateMessage';
import { formatDateTime } from '@/lib/format';
import type { RunRecord } from '@/lib/validation/schemas';

const STATUS_STYLE: Record<RunRecord['status'], string> = {
  completed: 'bg-green-100 text-green-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-slate-100 text-slate-700',
};

export function RunHistory({ runs }: { runs: RunRecord[] }) {
  if (!runs.length) return <StateMessage title="No runs match these filters" />;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Run</th><th className="px-4 py-2">Brand</th><th className="px-4 py-2">Template</th><th className="px-4 py-2">Device</th>
            <th className="px-4 py-2">URLs</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Summary</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} className="border-b border-slate-100 align-top last:border-0">
              <td className="px-4 py-3">{formatDateTime(r.finishedAt ?? r.startedAt ?? r.createdAt)}<span className="block text-xs text-slate-500">{r.trigger === 'retest' ? `Re-test${r.requestedBy ? ` by ${r.requestedBy}` : ''}` : 'Scheduled'}</span></td>
              <td className="px-4 py-3">{r.brand}</td>
              <td className="px-4 py-3">{r.templateId}</td>
              <td className="px-4 py-3">{r.device}</td>
              <td className="px-4 py-3 tabular-nums">{r.urlsDone}/{r.urlCount}{r.urlsFailed ? <span className="block text-xs text-red-700">{r.urlsFailed} failed</span> : null}</td>
              <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
              <td className="px-4 py-3 text-xs text-slate-600">
                {r.summary && r.summary.performance !== undefined ? `Perf ${r.summary.performance ?? 'n/a'} · A11y ${r.summary.accessibility ?? 'n/a'} · ${r.summary.failingAudits ?? 0} failing audits` : r.error ?? '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
