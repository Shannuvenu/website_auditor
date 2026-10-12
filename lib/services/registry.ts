import { getDataSource } from '@/lib/data';
import { validateTemplate } from '@/lib/templates/registry';
import type { TemplateRegistryEntry } from '@/lib/validation/schemas';

/** Registry rows with problems from both layers: Apps Script's own check and the app's validation. */
export async function getRegistryReport(): Promise<TemplateRegistryEntry[]> {
  const templates = await getDataSource().listTemplates();
  return templates.map((t) => ({ ...t, problems: [...new Set([...(t.problems ?? []), ...validateTemplate(t)])] }));
}
