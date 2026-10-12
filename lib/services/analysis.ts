import { analyzeAggregate, type AnalysisResult } from '@/lib/llm/analyze';
import type { Device } from '@/lib/validation/schemas';
import { trafficWeightFor } from './overview';
import { getTemplateDetail } from './detail';

/** Loads the latest aggregate for a template/device and runs the grounded LLM analysis on it. */
export async function analyzeTemplate(templateId: string, device: Device): Promise<AnalysisResult | null> {
  const detail = await getTemplateDetail(templateId, device);
  if (!detail) return null;
  return analyzeAggregate(detail.aggregate, { trafficWeight: trafficWeightFor(detail.template) });
}
