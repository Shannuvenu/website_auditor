import { AdminMatchTool } from '@/components/AdminMatchTool';
import { AppShell } from '@/components/AppShell';
import { StateMessage } from '@/components/StateMessage';
import { requireSession } from '@/lib/auth/server';
import { getSafeConfigStatus } from '@/lib/config/env';
import { getRegistryReport } from '@/lib/services/registry';
import type { TemplateRegistryEntry } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const yesNo = (v: boolean) => (v ? 'Configured' : 'Not set');

export default async function AdminPage() {
  const session = await requireSession('admin:config');
  const config = getSafeConfigStatus();
  let templates: TemplateRegistryEntry[] | null = null;
  try {
    templates = await getRegistryReport();
  } catch {
    templates = null;
  }

  return (
    <AppShell session={session}>
      <h1 className="mb-4 text-xl font-semibold">Admin</h1>
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">System status</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-3">
            <dt className="text-slate-600">Data source</dt><dd className="sm:col-span-2">{config.dataSource}</dd>
            <dt className="text-slate-600">Apps Script endpoint and token</dt><dd className="sm:col-span-2">{yesNo(config.appsScriptConfigured)}</dd>
            <dt className="text-slate-600">LLM</dt><dd className="sm:col-span-2">{config.llmProvider ? `${config.llmProvider}${config.llmModel ? ` (${config.llmModel})` : ''}` : 'Not set'}</dd>
            <dt className="text-slate-600">Session secret</dt><dd className="sm:col-span-2">{yesNo(config.sessionSecretConfigured)}</dd>
            <dt className="text-slate-600">Developers may re-test</dt><dd className="sm:col-span-2">{config.developerRetestAllowed ? 'Yes' : 'No'}</dd>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Secrets are never shown. The Apps Script source, Script Properties and triggers are managed only in the Apps Script editor by the admin; see the README.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Template registry (read-only here; edit the Templates sheet)</h2>
          {templates === null ? (
            <StateMessage tone="error" title="Could not read the registry">Check the Apps Script connection.</StateMessage>
          ) : !templates.length ? (
            <StateMessage title="The registry is empty">Add rows to the Templates sheet tab.</StateMessage>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr><th className="py-1 pr-3">Template</th><th className="pr-3">Brand</th><th className="pr-3">Pattern</th><th className="pr-3">Samples</th><th className="pr-3">Active</th><th>Problems</th></tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.templateId} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-3">{t.templateId}<span className="block text-xs text-slate-500">{t.templateName}</span></td>
                      <td className="pr-3">{t.brand}</td>
                      <td className="pr-3 font-mono text-xs">{t.urlPattern}</td>
                      <td className="pr-3">{t.sampleUrls.length}</td>
                      <td className="pr-3">{t.active ? 'Yes' : 'No'}</td>
                      <td className="text-xs text-red-700">{t.problems?.length ? t.problems.join('; ') : <span className="text-green-700">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Which template does a URL belong to?</h2>
          <AdminMatchTool />
        </section>
      </div>
    </AppShell>
  );
}
