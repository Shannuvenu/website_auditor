export interface TopIssue {
  rank: number; title: string; rootCause: string; findingIds: string[]; affected: string;
  whyItMatters: string; fix: string; fixLocation: string; fixSteps: string[];
  effort: 'low' | 'medium' | 'high'; businessRisk: 'low' | 'medium' | 'high'; riskNote: string;
  confidence: 'low' | 'medium' | 'high';
  unverified?: string[];
  evidence: { id: string; title: string; text: string }[];
}
export interface Recommendations { available: boolean; reason?: string; summary?: string; topIssues?: TopIssue[] }