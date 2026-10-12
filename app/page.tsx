import { AppShell } from '@/components/AppShell';
import { FiltersBar } from '@/components/FiltersBar';
import { StateMessage } from '@/components/StateMessage';
import { TemplateOverview } from '@/components/TemplateOverview';
import { requireSession } from '@/lib/auth/server';
import { getOverview, type OverviewRow } from '@/lib/services/overview';
import { brandSchema, deviceSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({ searchParams }: { searchParams: { brand?: string; device?: string } }) {
  const session = await requireSession('view:templates');
  const brand = brandSchema.safeParse(searchParams.brand);
  const device = deviceSchema.safeParse(searchParams.device);

  let rows: OverviewRow[] | null = null;
  let error: string | null = null;
  try {
    rows = await getOverview({ brand: brand.success ? brand.data : undefined, device: device.success ? device.data : 'mobile' });
  } catch (e) {
    console.error(`[page] overview failed: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`);
    error = e instanceof Error && e.name === 'AppsScriptError' ? e.message : 'The measurements could not be loaded.';
  }

  return (
    <AppShell session={session}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Templates</h1>
          <p className="text-sm text-slate-600">Lowest-scoring templates first. Select a row for ranked fixes.</p>
        </div>
        <FiltersBar
          filters={[
            { name: 'brand', label: 'Brand', defaultValue: 'all', options: [{ value: 'all', label: 'All' }, { value: 'DH', label: 'DH' }, { value: 'PV', label: 'PV' }] },
            { name: 'device', label: 'Device', defaultValue: 'mobile', options: [{ value: 'mobile', label: 'Mobile' }, { value: 'desktop', label: 'Desktop' }] },
          ]}
        />
      </div>
      {error ? <StateMessage tone="error" title="Could not load templates">{error}</StateMessage> : <TemplateOverview rows={rows ?? []} />}
    </AppShell>
  );
}
