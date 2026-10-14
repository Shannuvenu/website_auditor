import { z } from 'zod';
import { callAppsScript } from '@/lib/apps-script/client';
import { getDataSourceKind } from '@/lib/config/env';
import type { Role } from '@/types';
import { verifyPassword } from './password';
import type { Session } from './session';

const usersSchema = z
  .array(
    z.object({
      username: z.string().trim().min(1).max(64),
      role: z.enum(['ADMIN', 'DEVELOPER']),
      passwordHash: z.string().min(20),
    }),
  )
  .min(1);

export interface AppUser {
  username: string;
  role: Role;
  passwordHash: string;
  /** Credential version for a stored account; absent (= '0') for AUTH_USERS entries. */
  version?: string;
}

/** Parses AUTH_USERS. Returns an empty list (nobody can log in) when it is missing or malformed. */
export function loadUsers(raw = process.env.AUTH_USERS): AppUser[] {
  if (!raw) return [];
  try {
    const parsed = usersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

// A fixed, valid hash so a login attempt for an unknown user costs the same time as for a known one.
const DUMMY_HASH =
  'scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function authenticate(username: string, password: string, users = loadUsers()): Promise<AppUser | null> {
  const user = users.find((u) => u.username === username);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return user && ok ? user : null;
}
// ---------- stored admin account (Apps Script Script Property) ----------

const storedAccountSchema = z.object({ username: z.string(), passwordHash: z.string(), version: z.string(), updatedAt: z.string() });
const getAccountSchema = z.object({ account: storedAccountSchema.nullable() });
const setAccountSchema = z.object({ account: storedAccountSchema });
export type StoredAdminAccount = z.infer<typeof storedAccountSchema>;

/** Account changes can only be persisted through Apps Script. */
export function isAccountStoreAvailable(): boolean {
  return getDataSourceKind() === 'apps-script';
}

const ADMIN_CACHE_MS = 30_000;
let adminCache: { account: StoredAdminAccount | null; at: number } | null = null;

/** Cached for 30 s. If Apps Script fails, the last known value is reused; with none, it throws. `fresh` skips the cache and never falls back. */
export async function getStoredAdminAccount(options: { fresh?: boolean } = {}): Promise<StoredAdminAccount | null> {
  if (!isAccountStoreAvailable()) return null;
  if (!options.fresh && adminCache && Date.now() - adminCache.at < ADMIN_CACHE_MS) return adminCache.account;
  try {
    const data = await callAppsScript('auth-get', {}, getAccountSchema);
    adminCache = { account: data.account, at: Date.now() };
    return data.account;
  } catch (error) {
    if (!options.fresh && adminCache) return adminCache.account;
    throw error;
  }
}

export async function saveAdminAccount(input: { username: string; passwordHash: string; expectedVersion: string }): Promise<StoredAdminAccount> {
  const data = await callAppsScript('auth-set', input, setAccountSchema);
  adminCache = { account: data.account, at: Date.now() };
  return data.account;
}

/** The stored admin replaces every ADMIN entry from AUTH_USERS, so the old env password stops working. */
export function applyAdminOverride(users: AppUser[], stored: StoredAdminAccount | null): AppUser[] {
  if (!stored) return users;
  return [...users.filter((u) => u.role !== 'ADMIN'), { username: stored.username, role: 'ADMIN', passwordHash: stored.passwordHash, version: stored.version }];
}

/** Users who may sign in now. If the stored admin cannot be read, admin sign-in is off (fail closed); developers still work. */
export async function loadEffectiveUsers(): Promise<AppUser[]> {
  const envUsers = loadUsers();
  try {
    return applyAdminOverride(envUsers, await getStoredAdminAccount({ fresh: true }));
  } catch {
    console.error('[auth] could not read the stored admin account; admin sign-in is disabled until it can be read');
    return envUsers.filter((u) => u.role !== 'ADMIN');
  }
}

/** False once the admin's credentials changed after this session was issued. DEVELOPER sessions are not checked (no network call). */
export async function isSessionCurrent(session: Session): Promise<boolean> {
  if (session.role !== 'ADMIN' || !isAccountStoreAvailable()) return true;
  const matches = (a: StoredAdminAccount | null) => (a ? session.cv === a.version && session.username === a.username : session.cv === '0');
  try {
    if (matches(await getStoredAdminAccount())) return true;
    return matches(await getStoredAdminAccount({ fresh: true })); // cached value may be stale on this instance
  } catch {
    return false;
  }
}