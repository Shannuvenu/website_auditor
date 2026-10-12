import { NextResponse } from 'next/server';
import { isDeveloperRetestAllowed } from '@/lib/config/env';
import { can, type Permission } from './rbac';
import { readCookie, SESSION_COOKIE, verifySessionToken, type Session } from './session';

export type AuthResult = { ok: true; session: Session } | { ok: false; response: NextResponse };

export function jsonError(status: number, code: string, message: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/** Checks the session cookie and the permission. Route handlers call this first, whatever the middleware did. */
export async function authorize(req: Request, permission: Permission): Promise<AuthResult> {
  const session = await verifySessionToken(readCookie(req.headers.get('cookie'), SESSION_COOKIE));
  if (!session) return { ok: false, response: jsonError(401, 'UNAUTHENTICATED', 'Sign in required') };
  if (!can(session.role, permission, { developerRetest: isDeveloperRetestAllowed() })) {
    return { ok: false, response: jsonError(403, 'FORBIDDEN', 'You do not have permission for this action') };
  }
  return { ok: true, session };
}

/** CSRF defence for state-changing requests: the Origin header must match this host. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === (req.headers.get('host') ?? new URL(req.url).host);
  } catch {
    return false;
  }
}
