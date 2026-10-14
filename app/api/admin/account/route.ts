import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleRouteError } from '@/lib/api/errors';
import { AppsScriptError } from '@/lib/apps-script/client';
import { authorize, isSameOrigin, jsonError } from '@/lib/auth/guard';
import { hashPassword } from '@/lib/auth/password';
import { rateLimit } from '@/lib/auth/rate-limit';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { applyAdminOverride, authenticate, getStoredAdminAccount, isAccountStoreAvailable, loadUsers, saveAdminAccount } from '@/lib/auth/users';

export const runtime = 'nodejs';

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newUsername: z.string().trim().min(3, 'Username needs at least 3 characters').max(64).regex(/^[A-Za-z0-9._@-]+$/, 'Username may use letters, numbers and . _ @ - only'),
  newPassword: z.string().min(12, 'Password needs at least 12 characters').max(128, 'Password is too long').optional(),
});

/** POST /api/admin/account (ADMIN): change the admin username and/or password. Needs the current password. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
  const auth = await authorize(req, 'admin:config');
  if (!auth.ok) return auth.response;
  if (!isAccountStoreAvailable()) return jsonError(501, 'NOT_SUPPORTED', 'Account changes are stored in Apps Script and need DATA_SOURCE=apps-script');

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid request');
  const { currentPassword, newUsername, newPassword } = parsed.data;

  const limit = rateLimit(`account:${auth.session.username}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.', { 'Retry-After': String(limit.retryAfterSeconds) });
  }

  try {
    const stored = await getStoredAdminAccount({ fresh: true });
    const users = applyAdminOverride(loadUsers(), stored);
    const current = await authenticate(auth.session.username, currentPassword, users);
    if (!current || current.role !== 'ADMIN') return jsonError(403, 'WRONG_PASSWORD', 'The current password is incorrect');

    if (users.some((u) => u.role !== 'ADMIN' && u.username.toLowerCase() === newUsername.toLowerCase())) {
      return jsonError(409, 'USERNAME_TAKEN', 'That username belongs to another account');
    }
    if (newPassword === undefined && newUsername === current.username) return jsonError(400, 'NOTHING_TO_CHANGE', 'Nothing to change');
    if (newPassword !== undefined) {
      if (newPassword === currentPassword) return jsonError(400, 'BAD_REQUEST', 'The new password must differ from the current one');
      if (newPassword.toLowerCase().includes(newUsername.toLowerCase())) return jsonError(400, 'BAD_REQUEST', 'The password must not contain the username');
    }

    const passwordHash = newPassword !== undefined ? await hashPassword(newPassword) : current.passwordHash;
    const saved = await saveAdminAccount({ username: newUsername, passwordHash, expectedVersion: stored?.version ?? '0' });

    // Fresh cookie for this browser; every older ADMIN session now fails isSessionCurrent().
    const res = NextResponse.json({ ok: true, username: saved.username });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(saved.username, 'ADMIN', Date.now(), saved.version), sessionCookieOptions());
    return res;
  } catch (error) {
    if (error instanceof AppsScriptError && error.code === 'CONFLICT') {
      return jsonError(409, 'CONFLICT', 'The admin account was changed elsewhere. Reload and try again.');
    }
    return handleRouteError(error);
  }
}