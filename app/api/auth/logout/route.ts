import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/auth/guard';
import { SESSION_COOKIE } from '@/lib/auth/session';

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
