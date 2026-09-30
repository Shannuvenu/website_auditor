import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivate(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal'))
    throw new Error('This host is not allowed');
  let ips: string[];
  try { ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address); }
  catch { throw new Error('Domain could not be resolved (DNS lookup failed)'); }
  if (!ips.length || ips.some(isPrivate)) throw new Error('Requests to private or internal addresses are blocked');
  return u;
}
