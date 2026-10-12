import { notFound } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { StateMessage } from '@/components/StateMessage';
import { TemplateDetail } from '@/components/TemplateDetail';
import { can } from '@/lib/auth/rbac';
import { requireSession } from '@/lib/auth/server';
import { templateIdSchema } from '@/lib/api/params';
import { isDeveloperRetestAllowed } from '@/lib/config/env';
import { getTemplateDetail, type TemplateDetailData } from '@/lib/services/detail';
import { deviceSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

export default async function TemplatePage({ params, searchParams }: { params: { templateId: string }; searchParams: { device?: string } }) {
  const session = await requireSession('view:templates');
  const id = templateIdSchema.safeParse(params.templateId);
  if (!id.success) notFound();
  const device = deviceSchema.safeParse(searchParams.device);

  let data: TemplateDetailData | null = null;
  let error: string | null = null;
  try {
    data = await getTemplateDetail(id.data, device.success ? device.data : 'mobile');
  } catch (e) {
    console.error(`[page] template detail failed: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`);
    error = 'The measurements could not be loaded.';
  }

  return (
    <AppShell session={session}>
      {error ? (
        <StateMessage tone="error" title="Could not load this template">{error}</StateMessage>
      ) : data ? (
        <TemplateDetail data={data} canRetest={can(session.role, 'retest', { developerRetest: isDeveloperRetestAllowed() })} />
      ) : (
        <StateMessage title="No measurements for this template and device yet">It has not completed a run. Check Run history.</StateMessage>
      )}
    </AppShell>
  );
}
