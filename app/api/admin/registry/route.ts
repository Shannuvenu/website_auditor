import { NextResponse } from 'next/server';
import { handleRouteError } from '@/lib/api/errors';
import { authorize } from '@/lib/auth/guard';
import { getRegistryReport } from '@/lib/services/registry';

/** GET /api/admin/registry (ADMIN): the template registry as stored in the Templates sheet, with validation problems. */
export async function GET(req: Request) {
  const auth = await authorize(req, 'admin:registry');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ templates: await getRegistryReport() });
  } catch (error) {
    return handleRouteError(error);
  }
}
