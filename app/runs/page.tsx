import { AppShell } from '@/components/AppShell';
import { FiltersBar } from '@/components/FiltersBar';
import { RunHistory } from '@/components/RunHistory';
import { StateMessage } from '@/components/StateMessage';
import { requireSession } from '@/lib/auth/server';
import { getDataSource } from '@/lib/data';
import { brandSchema, deviceSchema, RUN_STATUSES, type RunRecord } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export default async function RunsPage({ searchParams }: { searchParams: { brand?: string; device?: string; status?: string } }) {
  const session = await requireSession('view:runs');
  const brand = brandSchema.safeParse(searchParams.brand);
  const device = deviceSchema.safeParse(searchParams.device);
  const status = RUN_STATUSES.find((s) => s === searchParams.status);

  let runs: RunRecord[] | null = null;
  try {
    runs = await getDataSource().listRuns({ brand: brand.success ? brand.data : undefined, limit: 200 });
  } catch (e) {
    console.error(`[page] runs failed: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`);
  }
  const filtered = (runs ?? []).filter((r) => (!device.success || r.device === device.data) && (!status || r.status === status));

  return (
    <AppShell session={session}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Run history</h1>
        <FiltersBar
          filters={[
            { name: 'brand', label: 'Brand', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, { value: 'DH', label: 'DH' }, { value: 'PV', label: 'PV' }] },
            { name: 'device', label: 'Device', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, { value: 'mobile', label: 'Mobile' }, { value: 'desktop', label: 'Desktop' }] },
            { name: 'status', label: 'Status', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, ...RUN_STATUSES.map((s) => ({ value: s, label: s }))] },
          ]}
        />
      </div>
      {runs === null ? <StateMessage tone="error" title="Could not load run history">The data service did not respond.</StateMessage> : <RunHistory runs={filtered} />}
    </AppShell>
  );
}
