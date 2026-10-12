import type { TemplateRegistryEntry } from '@/lib/validation/schemas';
import { parseCsv } from './csv';

/** Reads a CSV export of the Templates sheet tab (File > Download > CSV). Columns are matched by header name. */
export function registryFromCsv(text: string): TemplateRegistryEntry[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const cell = (row: string[], name: string) => {
    const i = names.indexOf(name);
    return i === -1 ? '' : (row[i] ?? '');
  };
  return rows
    .filter((r) => cell(r, 'template_id').trim())
    .map((r) => ({
      templateId: cell(r, 'template_id').trim(),
      templateName: cell(r, 'template_name').trim(),
      brand: cell(r, 'brand').trim().toUpperCase(),
      urlPattern: cell(r, 'url_pattern').trim(),
      sampleUrls: cell(r, 'sample_urls').split(/[\n\r,]+/).map((u) => u.trim()).filter(Boolean),
      active: cell(r, 'active').trim().toLowerCase() === 'true',
      trafficWeight: null,
    }));
}
