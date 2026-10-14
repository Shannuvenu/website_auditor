import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { can } from '@/lib/auth/rbac';
import { resetRateLimit, rateLimit } from '@/lib/auth/rate-limit';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { applyAdminOverride, authenticate, loadUsers } from '@/lib/auth/users';
import { middleware } from '../middleware';
import { GET as getTemplates } from '@/app/api/templates/route';
import { GET as getRuns } from '@/app/api/runs/route';
import { POST as postRetest } from '@/app/api/retest/route';
import { POST as postAnalysis } from '@/app/api/templates/[templateId]/analysis/route';
import { GET as getAdminConfig } from '@/app/api/admin/config/route';
import { GET as getAdminRegistry } from '@/app/api/admin/registry/route';
import { POST as postMatch } from '@/app/api/admin/match-url/route';
import { POST as postLogin } from '@/app/api/auth/login/route';

const SECRET = 'x'.repeat(40);
let adminCookie = '';
let devCookie = '';

beforeAll(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_SOURCE = 'mock';
  process.env.AI_PROVIDER = 'mock';
  process.env.AUTH_USERS = JSON.stringify([
    { username: 'admin', role: 'ADMIN', passwordHash: await hashPassword('admin-password-1') },
    { username: 'dev', role: 'DEVELOPER', passwordHash: await hashPassword('dev-password-123') },
  ]);
  adminCookie = `${SESSION_COOKIE}=${await createSessionToken('admin', 'ADMIN')}`;
  devCookie = `${SESSION_COOKIE}=${await createSessionToken('dev', 'DEVELOPER')}`;
});

beforeEach(() => {
  delete process.env.ALLOW_DEVELOPER_RETEST;
  resetRateLimit();
});

const req = (path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe('passwords', () => {
  it('hashes with salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt:')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('authenticates only known users with the right password', async () => {
    const users = loadUsers();
    expect((await authenticate('admin', 'admin-password-1', users))?.role).toBe('ADMIN');
    expect(await authenticate('admin', 'nope', users)).toBeNull();
    expect(await authenticate('ghost', 'admin-password-1', users)).toBeNull();
    expect(loadUsers('not json')).toEqual([]);
    expect(loadUsers('')).toEqual([]);
  });
});

describe('session tokens', () => {
  it('round-trips, expires, and rejects tampering', async () => {
    const token = await createSessionToken('dev', 'DEVELOPER', 1_000_000);
    expect(await verifySessionToken(token, 1_000_000)).toMatchObject({ username: 'dev', role: 'DEVELOPER' });
    expect(await verifySessionToken(token, 1_000_000 + 9 * 3600 * 1000)).toBeNull();
    const [v, payload, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ username: 'dev', role: 'ADMIN', expiresAt: 99999999999 })).replace(/=+$/, '');
    expect(await verifySessionToken(`${v}.${forged}.${sig}`)).toBeNull();
    expect(await verifySessionToken(`${v}.${payload}.AAAA`)).toBeNull();
    expect(await verifySessionToken('garbage')).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
  });

  it('is invalid under a different secret', async () => {
    const token = await createSessionToken('admin', 'ADMIN');
    process.env.SESSION_SECRET = 'y'.repeat(40);
    expect(await verifySessionToken(token)).toBeNull();
    process.env.SESSION_SECRET = SECRET;
  });
});

describe('role permissions', () => {
  it('separates admin and developer', () => {
    expect(can('ADMIN', 'admin:config')).toBe(true);
    expect(can('ADMIN', 'admin:registry')).toBe(true);
    expect(can('DEVELOPER', 'admin:config')).toBe(false);
    expect(can('DEVELOPER', 'admin:registry')).toBe(false);
    for (const p of ['view:templates', 'view:runs', 'analyze'] as const) expect(can('DEVELOPER', p)).toBe(true);
  });

  it('lets the admin switch developer re-tests off', () => {
    expect(can('DEVELOPER', 'retest')).toBe(true);
    expect(can('DEVELOPER', 'retest', { developerRetest: false })).toBe(false);
    expect(can('ADMIN', 'retest', { developerRetest: false })).toBe(true);
  });
});

describe('middleware', () => {
  const next = (path: string, cookie?: string) => middleware(new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} }));

  it('redirects signed-out pages to /login and answers 401 for APIs', async () => {
    const page = await next('/');
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toContain('/login');
    expect((await next('/api/templates')).status).toBe(401);
    expect((await next('/templates/DH_ARTICLE')).status).toBe(307);
  });

  it('keeps the login endpoints public', async () => {
    expect((await next('/login')).status).toBe(200);
    expect((await next('/api/auth/login')).status).toBe(200);
  });

  it('lets developers through to normal pages but blocks /admin', async () => {
    expect((await next('/', devCookie)).status).toBe(200);
    expect((await next('/runs', devCookie)).status).toBe(200);
    expect((await next('/admin', devCookie)).status).toBe(403);
    expect((await next('/api/admin/config', devCookie)).status).toBe(403);
    expect((await next('/admin', adminCookie)).status).toBe(200);
  });

  it('rejects a forged cookie', async () => {
    expect((await next('/api/runs', `${SESSION_COOKIE}=v1.abc.def`)).status).toBe(401);
  });
});

describe('API authorization (handlers enforce it independently of middleware)', () => {
  it('requires a session', async () => {
    expect((await getTemplates(req('/api/templates'))).status).toBe(401);
    expect((await getRuns(req('/api/runs'))).status).toBe(401);
    expect((await postRetest(req('/api/retest', { method: 'POST', body: { templateId: 'DH_ARTICLE', device: 'mobile' } }))).status).toBe(401);
  });

  it('serves developers the read APIs', async () => {
    const res = await getTemplates(req('/api/templates?device=mobile', { cookie: devCookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows[0].performance).toBeLessThanOrEqual(body.rows[body.rows.length - 1].performance);
    expect((await getRuns(req('/api/runs', { cookie: devCookie }))).status).toBe(200);
  });

  it('denies developers every admin API', async () => {
    expect((await getAdminConfig(req('/api/admin/config', { cookie: devCookie }))).status).toBe(403);
    expect((await getAdminRegistry(req('/api/admin/registry', { cookie: devCookie }))).status).toBe(403);
    expect((await postMatch(req('/api/admin/match-url', { method: 'POST', cookie: devCookie, body: { url: 'https://www.deccanherald.com/' } }))).status).toBe(403);
  });

  it('lets admins read config, which never contains secrets', async () => {
    process.env.APPS_SCRIPT_TOKEN = 'super-secret-token';
    process.env.ANTHROPIC_API_KEY = 'sk-secret-key';
    const res = await getAdminConfig(req('/api/admin/config', { cookie: adminCookie }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('sk-secret-key');
    delete process.env.APPS_SCRIPT_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('matches a URL to a template for admins without fetching it', async () => {
    const res = await postMatch(req('/api/admin/match-url', { method: 'POST', cookie: adminCookie, body: { url: 'https://www.deccanherald.com/article/anything' } }));
    expect((await res.json()).match.templateId).toBe('DH_ARTICLE');
  });

  it('allows developer re-tests by default and blocks them when disabled', async () => {
    const body = { templateId: 'DH_ARTICLE', device: 'mobile' };
    expect((await postRetest(req('/api/retest', { method: 'POST', cookie: devCookie, body }))).status).toBe(200);
    process.env.ALLOW_DEVELOPER_RETEST = 'false';
    expect((await postRetest(req('/api/retest', { method: 'POST', cookie: devCookie, body }))).status).toBe(403);
    expect((await postRetest(req('/api/retest', { method: 'POST', cookie: adminCookie, body }))).status).toBe(200);
  });

  it('validates retest input (no URLs accepted, only a template id and device)', async () => {
    for (const body of [{ templateId: 'dh article', device: 'mobile' }, { templateId: 'DH_ARTICLE', device: 'tablet' }, { url: 'http://169.254.169.254/' }]) {
      expect((await postRetest(req('/api/retest', { method: 'POST', cookie: adminCookie, body }))).status).toBe(400);
    }
  });

  it('blocks cross-site state changes', async () => {
    const forged = new Request('http://localhost:3000/api/retest', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'https://evil.example', 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ templateId: 'DH_ARTICLE', device: 'mobile' }),
    });
    expect((await postRetest(forged)).status).toBe(403);
  });

  it('runs and caches the analysis for developers', async () => {
    const res = await postAnalysis(req('/api/templates/DH_ARTICLE/analysis', { method: 'POST', cookie: devCookie, body: { device: 'mobile' } }), { params: { templateId: 'DH_ARTICLE' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.issues[0].rank).toBe(1);
    expect(body.rejected).toEqual([]);
  });
});

describe('login endpoint', () => {
  const login = (username: string, password: string) => postLogin(req('/api/auth/login', { method: 'POST', body: { username, password } }));

  it('sets an httpOnly session cookie on success and a generic error on failure', async () => {
    const ok = await login('dev', 'dev-password-123');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const bad = await login('dev', 'wrong-password');
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.message).toBe('Invalid username or password');
  });

  it('rate limits repeated failures', async () => {
    for (let i = 0; i < 5; i++) await login('admin', `bad-${i}`);
    expect((await login('admin', 'admin-password-1')).status).toBe(429);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit within the window', () => {
    expect(rateLimit('k', 2, 1000, 0).allowed).toBe(true);
    expect(rateLimit('k', 2, 1000, 1).allowed).toBe(true);
    expect(rateLimit('k', 2, 1000, 2).allowed).toBe(false);
    expect(rateLimit('k', 2, 1000, 1500).allowed).toBe(true);
  });
});
describe('admin account override', () => {
  it('replaces the env ADMIN and keeps developers', () => {
    const env = loadUsers();
    const stored = { username: 'boss', passwordHash: `scrypt:16384:8:1:${'A'.repeat(22)}:${'B'.repeat(86)}`, version: 'v1', updatedAt: '2026-10-14T00:00:00Z' };
    const merged = applyAdminOverride(env, stored);
    expect(merged.filter((u) => u.role === 'ADMIN').map((u) => u.username)).toEqual(['boss']);
    expect(merged.some((u) => u.username === 'dev')).toBe(true);
    expect(applyAdminOverride(env, null)).toEqual(env);
  });

  it('carries the credential version in the session', async () => {
    expect(await verifySessionToken(await createSessionToken('boss', 'ADMIN', Date.now(), 'v1'))).toMatchObject({ username: 'boss', cv: 'v1' });
    expect((await verifySessionToken(await createSessionToken('dev', 'DEVELOPER')))?.cv).toBe('0');
  });
});