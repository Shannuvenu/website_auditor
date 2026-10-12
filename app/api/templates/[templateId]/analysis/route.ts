import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleRouteError } from '@/lib/api/errors';
import { templateIdSchema } from '@/lib/api/params';
import { authorize, isSameOrigin, jsonError } from '@/lib/auth/guard';
import { rateLimit } from '@/lib/auth/rate-limit';
import { analyzeTemplate } from '@/lib/services/analysis';
import { deviceSchema } from '@/lib/validation/schemas';

export const maxDuration = 60;

const bodySchema = z.object({ device: deviceSchema });

/**
 * POST /api/templates/:templateId/analysis  { "device": "mobile" }
 * Runs the LLM on the latest aggregate, validates the output, ranks it. Results are cached per run.
 */
export async function POST(req: Request, { params }: { params: { templateId: string } }) {
  if (!isSameOrigin(req)) return jsonError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
  const auth = await authorize(req, 'analyze');
  if (!auth.ok) return auth.response;
  const id = templateIdSchema.safeParse(params.templateId);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return jsonError(400, 'BAD_REQUEST', 'Invalid template id or device');

  const limit = rateLimit(`analysis:${auth.session.username}`, 20, 60_000);
  if (!limit.allowed) return jsonError(429, 'RATE_LIMITED', 'Too many analysis requests', { 'Retry-After': String(limit.retryAfterSeconds) });

  try {
    const result = await analyzeTemplate(id.data, body.data.device);
    return result ? NextResponse.json(result) : jsonError(404, 'NOT_FOUND', 'No measurements for this template yet');
  } catch (error) {
    return handleRouteError(error);
  }
}
