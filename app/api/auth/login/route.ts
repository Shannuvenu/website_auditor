import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, isSameOrigin } from '@/lib/auth/guard';
import { rateLimit } from '@/lib/auth/rate-limit';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { authenticate, loadEffectiveUsers } from '@/lib/auth/users';

export const runtime = 'nodejs';

const bodySchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'BAD_REQUEST', 'Username and password are required');

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = rateLimit(`login:${ip}:${parsed.data.username}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.', { 'Retry-After': String(limit.retryAfterSeconds) });
  }

    const user = await authenticate(parsed.data.username, parsed.data.password, await loadEffectiveUsers());
  if (!user) return jsonError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');

  let token: string;
  try {
        token = await createSessionToken(user.username, user.role, Date.now(), user.version ?? '0');
  } catch {
    console.error('[auth] SESSION_SECRET is missing or shorter than 32 characters');
    return jsonError(500, 'NOT_CONFIGURED', 'The server is not configured for sign-in');
  }
  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
