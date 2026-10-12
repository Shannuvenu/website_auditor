// Signed, stateless session cookie. Uses Web Crypto only, so it runs in middleware (edge) and Node.
import type { Role } from '@/types';

export const SESSION_COOKIE = 'psa_session';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface Session {
  username: string;
  role: Role;
  expiresAt: number; // unix seconds
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionToken(username: string, role: Role, now = Date.now()): Promise<string> {
  const session: Session = { username, role, expiresAt: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS };
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(payload));
  return `v1.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the session, or null for anything missing, tampered with, expired or malformed. Never throws on bad input. */
export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(), fromBase64Url(parts[2]), encoder.encode(parts[1]));
    if (!valid) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))) as Partial<Session>;
    if (typeof data.username !== 'string' || typeof data.expiresAt !== 'number') return null;
    if (data.role !== 'ADMIN' && data.role !== 'DEVELOPER') return null;
    if (data.expiresAt <= Math.floor(now / 1000)) return null;
    return { username: data.username, role: data.role, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE_SECONDS };
}
