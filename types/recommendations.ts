export interface TopIssue {
  rank: number; title: string; findingIds: string[]; whyItMatters: string; fixSteps: string[];
  evidence: { id: string; title: string; text: string }[];
}
export interface Recommendations { available: boolean; reason?: string; summary?: string; topIssues?: TopIssue[] }
