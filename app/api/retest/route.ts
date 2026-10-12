import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleRouteError } from '@/lib/api/errors';
import { templateIdSchema } from '@/lib/api/params';
import { authorize, isSameOrigin, jsonError } from '@/lib/auth/guard';
import { rateLimit } from '@/lib/auth/rate-limit';
import { getDataSource } from '@/lib/data';

const bodySchema = z.object({ templateId: templateIdSchema, device: z.enum(['mobile', 'desktop', 'both']) });

/**
 * POST /api/retest  { "templateId": "DH_ARTICLE", "device": "mobile" | "desktop" | "both" }
 * Queues a re-run of the template's registered sample URLs. The request never carries URLs.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
  const auth = await authorize(req, 'retest');
  if (!auth.ok) return auth.response;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'BAD_REQUEST', 'Invalid template id or device');

  const limit = rateLimit(`retest:${auth.session.username}`, 5, 60_000);
  if (!limit.allowed) return jsonError(429, 'RATE_LIMITED', 'Too many re-test requests', { 'Retry-After': String(limit.retryAfterSeconds) });

  try {
    return NextResponse.json(await getDataSource().enqueueRetest({ ...body.data, requestedBy: auth.session.username }));
  } catch (error) {
    return handleRouteError(error);
  }
}
