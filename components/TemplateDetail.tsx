import Link from 'next/link';
import { EvidencePanel } from '@/components/EvidencePanel';
import { MeasuredHistory } from '@/components/MeasuredHistory';
import { RankedFixes } from '@/components/RankedFixes';
import { ScoreBadge } from '@/components/ScoreBadge';
import { formatDateTime } from '@/lib/format';
import { rankAuditsByImpact } from '@/lib/priority';
import type { TemplateDetailData } from '@/lib/services/detail';
import { trafficWeightFor } from '@/lib/services/overview';

export function TemplateDetail({ data, canRetest }: { data: TemplateDetailData; canRetest: boolean }) {
  const { aggregate } = data;
  const measured = rankAuditsByImpact(aggregate.audits, aggregate.device, trafficWeightFor(data.template))
    .slice(0, 8)
    .map(({ audit }) => ({ auditId: audit.auditId, title: audit.title, affectedCount: audit.affectedCount, sampledCount: audit.sampledCount }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <nav className="text-sm text-slate-500"><Link href={`/?device=${aggregate.device}`} className="hover:underline">Templates</Link> /</nav>
          <h1 className="text-xl font-semibold">{aggregate.templateName} · {aggregate.brand} · {aggregate.device === 'mobile' ? 'Mobile' : 'Desktop'}</h1>
          <p className="text-sm text-slate-500">Measured {formatDateTime(aggregate.generatedAt)}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          Perf <ScoreBadge score={aggregate.scores.performance} label="Performance" />
          A11y <ScoreBadge score={aggregate.scores.accessibility} label="Accessibility" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Ranked fixes</h2>
          <RankedFixes templateId={aggregate.templateId} device={aggregate.device} runId={aggregate.runId} measured={measured} />
        </section>
        <EvidencePanel aggregate={aggregate} canRetest={canRetest} />
      </div>
      <MeasuredHistory history={data.history} comparison={data.comparison} />
    </div>
  );
}
