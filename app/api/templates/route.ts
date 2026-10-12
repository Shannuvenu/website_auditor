import { NextResponse } from 'next/server';
import { handleRouteError } from '@/lib/api/errors';
import { brandParamSchema, deviceParamSchema, optionalParam } from '@/lib/api/params';
import { authorize, jsonError } from '@/lib/auth/guard';
import { getOverview } from '@/lib/services/overview';

/** GET /api/templates?brand=DH|PV&device=mobile|desktop: template overview rows, lowest performance first. */
export async function GET(req: Request) {
  const auth = await authorize(req, 'view:templates');
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const device = deviceParamSchema.safeParse(optionalParam(params.get('device')));
  const brand = brandParamSchema.safeParse(optionalParam(params.get('brand')));
  if (!device.success || !brand.success) return jsonError(400, 'BAD_REQUEST', 'Invalid brand or device');
  try {
    return NextResponse.json({ rows: await getOverview({ brand: brand.data, device: device.data }) });
  } catch (error) {
    return handleRouteError(error);
  }
}
