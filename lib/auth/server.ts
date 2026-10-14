import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isDeveloperRetestAllowed } from '@/lib/config/env';
import { can, type Permission } from './rbac';
import { SESSION_COOKIE, verifySessionToken, type Session } from './session';
import { isSessionCurrent } from './users';

export async function getCurrentSession(): Promise<Session | null> {
  return verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
}

/** For server components: redirects to /login when signed out and to the home page without the permission. */
export async function requireSession(permission?: Permission): Promise<Session> {
  const session = await getCurrentSession();
  if (!session || !(await isSessionCurrent(session))) redirect('/login');
  if (permission && !can(session.role, permission, { developerRetest: isDeveloperRetestAllowed() })) redirect('/forbidden');
  return session;
}
