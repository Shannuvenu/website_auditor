export type Status = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_APPLICABLE' | 'INCOMPLETE' | 'ERROR';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export interface Finding {
  id: string; category: string; title: string; status: Status; severity: Severity;
  evidence: string; explanation: string; recommendation: string; source: 'pagespeed' | 'crawler';
}
export interface Metric { value: number | null; display: string; rating: 'good' | 'needs-improvement' | 'poor' | 'unavailable' }
export interface PsiResult {
  ok: boolean; error?: string; scores?: Record<string, number | null>;
  metrics?: Record<string, Metric>; warnings?: string[]; audits?: PsiAudit[];
  extra?: Record<string, unknown>;
}
export interface PsiAudit { id: string; title: string; description: string; score: number | null; mode: string; displayValue?: string; numericValue?: number; itemCount: number; items: string[]; category: string }