/**
 * URL path patterns for the template registry.
 *   "/"            only the home page
 *   "/article/*"   "*" matches within a single path segment
 *   "/news/**"     "**" matches across segments
 * Trailing slashes are ignored. Must stay behaviour-identical to Templates.gs; the shared vectors in
 * tests/fixtures/pattern-vectors.json are run against both implementations.
 */
export function patternToRegExp(pattern: string): RegExp {
  let p = pattern.trim();
  if (!p.startsWith('/')) throw new Error('Pattern must start with "/"');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesPattern(pathname: string, pattern: string): boolean {
  let path = pathname || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return patternToRegExp(pattern).test(path);
}

/** Lower is more specific: fewer wildcards first, then the longer literal prefix. */
export function specificity(pattern: string): [number, number] {
  const wildcards = (pattern.match(/\*/g) ?? []).length;
  const literalPrefix = pattern.split('*')[0].length;
  return [wildcards, -literalPrefix];
}
