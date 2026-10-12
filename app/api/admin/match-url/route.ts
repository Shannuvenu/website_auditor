import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleRouteError } from '@/lib/api/errors';
import { authorize, isSameOrigin, jsonError } from '@/lib/auth/guard';
import { getDataSource } from '@/lib/data';
import { matchTemplate } from '@/lib/templates/registry';

const bodySchema = z.object({ url: z.string().min(1).max(2048) });

/** POST /api/admin/match-url { "url": "https://www.deccanherald.com/article/..." } (ADMIN). String matching only; the URL is never fetched. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
  const auth = await authorize(req, 'admin:registry');
  if (!auth.ok) return auth.response;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'BAD_REQUEST', 'A url is required');
  try {
    const match = matchTemplate(body.data.url, await getDataSource().listTemplates());
    return NextResponse.json({ match: match ? { templateId: match.templateId, templateName: match.templateName, brand: match.brand, urlPattern: match.urlPattern } : null });
  } catch (error) {
    return handleRouteError(error);
  }
}
