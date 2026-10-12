import { NextResponse } from 'next/server';
import { authorize } from '@/lib/auth/guard';
import { getSafeConfigStatus } from '@/lib/config/env';

/** GET /api/admin/config (ADMIN): which settings are present. Never returns keys, tokens or endpoint URLs. */
export async function GET(req: Request) {
  const auth = await authorize(req, 'admin:config');
  if (!auth.ok) return auth.response;
  return NextResponse.json(getSafeConfigStatus());
}
