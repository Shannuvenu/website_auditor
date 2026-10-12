import { z } from 'zod';
import type { Role } from '@/types';
import { verifyPassword } from './password';

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
