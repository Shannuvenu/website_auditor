import { NextResponse } from 'next/server';
import { handleRouteError } from '@/lib/api/errors';
import { deviceParamSchema, optionalParam, templateIdSchema } from '@/lib/api/params';
import { authorize, jsonError } from '@/lib/auth/guard';
import { getTemplateDetail } from '@/lib/services/detail';

/** GET /api/templates/:templateId?device=mobile|desktop: latest aggregate, history and before/after comparison. */
export async function GET(req: Request, { params }: { params: { templateId: string } }) {
  const auth = await authorize(req, 'view:templates');
  if (!auth.ok) return auth.response;
  const id = templateIdSchema.safeParse(params.templateId);
  const device = deviceParamSchema.safeParse(optionalParam(new URL(req.url).searchParams.get('device')));
  if (!id.success || !device.success) return jsonError(400, 'BAD_REQUEST', 'Invalid template id or device');
  try {
    const detail = await getTemplateDetail(id.data, device.data);
    return detail ? NextResponse.json(detail) : jsonError(404, 'NOT_FOUND', 'No measurements for this template yet');
  } catch (error) {
    return handleRouteError(error);
  }
}
