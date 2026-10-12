import { NextResponse } from 'next/server';
import { handleRouteError } from '@/lib/api/errors';
import { brandParamSchema, optionalParam } from '@/lib/api/params';
import { authorize, jsonError } from '@/lib/auth/guard';
import { getDataSource } from '@/lib/data';

/** GET /api/runs?brand=DH|PV&templateId=DH_ARTICLE: run history, newest first. */
export async function GET(req: Request) {
  const auth = await authorize(req, 'view:runs');
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  const brand = brandParamSchema.safeParse(optionalParam(params.get('brand')));
  if (!brand.success) return jsonError(400, 'BAD_REQUEST', 'Invalid brand');
  try {
    const runs = await getDataSource().listRuns({ brand: brand.data, templateId: optionalParam(params.get('templateId')), limit: 200 });
    return NextResponse.json({ runs });
  } catch (error) {
    return handleRouteError(error);
  }
}
