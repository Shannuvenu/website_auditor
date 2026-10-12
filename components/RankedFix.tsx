import { formatBytes } from '@/lib/pagespeed/ratings';
import { formatPercent } from '@/lib/format';
import type { RankedIssue } from '@/lib/llm/analyze';

const CHIP = 'rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700';

function priorityText(p: RankedIssue['priority']): string {
  if (p.score === null) return 'Priority: not quantified (no measured time or byte savings for the cited audits)';
  return `Priority score ${Math.round(p.score)} = ${Math.round(p.savingsMs ?? 0)} ms median savings × ${formatPercent(p.share)} of URLs × weight ${p.trafficWeight} ÷ effort ${p.effortDivisor}`;
}

export function RankedFix({ fix }: { fix: RankedIssue }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{fix.rank}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{fix.issue}</h3>
            <div className="flex gap-2">
              <span className={CHIP}>Effort {fix.effort}</span>
              <span className={CHIP}>Confidence {fix.confidence}</span>
            </div>
          </div>
          <p className="text-sm"><span className="font-medium">Likely cause: </span>{fix.likely_cause}</p>
          <p className="text-sm"><span className="font-medium">Change: </span>{fix.proposed_change}</p>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="mb-1 font-medium">Evidence</p>
            <ul className="space-y-1">
              {fix.evidence.map((e) => (
                <li key={e.auditId}>
                  <code className="rounded bg-white px-1 text-xs">{e.auditId}</code> {e.title}: {e.affectedCount} of {e.sampledCount} sample URLs
                  {e.medianSavingsMs !== null ? `, median ${Math.round(e.medianSavingsMs)} ms savings` : ''}
                  {e.medianSavingsBytes !== null ? `, median ${formatBytes(e.medianSavingsBytes)} savings` : ''}
                  {e.repeatedOffenders.length ? (
                    <ul className="ml-4 mt-0.5 list-disc text-xs text-slate-600">
                      {e.repeatedOffenders.map((o) => (
                        <li key={o.resource} className="break-all">{o.resource} ({o.urlCount} URLs)</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">{priorityText(fix.priority)}</p>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600">Affected URLs ({fix.affected_urls.length})</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {fix.affected_urls.map((u) => (
                <li key={u} className="break-all">{u}</li>
              ))}
            </ul>
          </details>
          <p className="text-sm"><span className="font-medium">Verify: </span>{fix.verify_step}</p>
        </div>
      </div>
    </li>
  );
}
