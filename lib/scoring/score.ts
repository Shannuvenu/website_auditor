import type { Finding, PsiResult } from '@/types/audit';

export const ALL = ['Performance', 'SEO', 'Accessibility', 'Best Practices', 'Security', 'Mobile', 'Technical SEO', 'Images', 'Resources', 'Social Tags', 'Content Quality', 'Analytics & Tracking', 'Domain & DNS', 'Content Freshness', 'Contact Information', 'Links'];
const PSI: Record<string, string> = { Performance: 'performance', SEO: 'seo', Accessibility: 'accessibility', 'Best Practices': 'best-practices' };
const PEN: Record<string, number> = { critical: 30, high: 20, medium: 10, low: 5, info: 0 };

export function scoreAll(findings: Finding[], mobile: PsiResult) {
  const cats: Record<string, { score: number | null; source: string; issues: number; checks: number }> = {};
  for (const name of ALL) {
    const fs = findings.filter((f) => f.category === name);
    const issues = fs.filter((f) => f.status === 'FAIL' || f.status === 'WARNING').length;
    const cr = fs.filter((f) => f.source === 'crawler' && f.status !== 'NOT_APPLICABLE' && f.status !== 'INCOMPLETE' && f.id !== 'analytics' && f.id !== 'freshness');
    const psi = PSI[name] && mobile.ok ? mobile.scores?.[PSI[name]] ?? null : null;
    if (psi != null) {
      cats[name] = { score: psi, source: 'Lighthouse / PageSpeed (mobile)', issues, checks: fs.length };
    } else if (cr.length) {
      const penalty = cr.reduce((s, f) => s + (f.status === 'FAIL' ? PEN[f.severity] : f.status === 'WARNING' ? PEN[f.severity] / 2 : 0), 0);
      cats[name] = { score: Math.max(0, Math.round(100 - penalty)), source: 'Own verified checks', issues, checks: cr.length };
    } else {
      cats[name] = { score: null, source: PSI[name] ? 'Lighthouse / PageSpeed (unavailable)' : 'Own verified checks (not applicable / no data)', issues, checks: 0 };
    }
  }
  const vals = Object.values(cats).map((c) => c.score).filter((s): s is number => s != null);
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  const bad = findings.filter((f) => f.status === 'FAIL' || f.status === 'WARNING');
  const sev = (s: string) => bad.filter((f) => f.severity === s).length;
  return { categories: cats, overall, severity: { critical: sev('critical'), high: sev('high'), medium: sev('medium'), low: sev('low') }, totalIssues: bad.length };
}