import { randomBytes, scrypt as scryptCb, timingSafeEqual, type BinaryLike } from 'node:crypto';

// Format: scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
// Uses ":" separators because "$" is expanded by dotenv in .env files.
const KEY_LENGTH = 64;
const DEFAULTS = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: BinaryLike, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEY_LENGTH, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, DEFAULTS.N, DEFAULTS.r, DEFAULTS.p);
  return `scrypt:${DEFAULTS.N}:${DEFAULTS.r}:${DEFAULTS.p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20) return false;
  try {
    const expected = Buffer.from(parts[5], 'base64url');
    const actual = await derive(password, Buffer.from(parts[4], 'base64url'), N, r, p);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
