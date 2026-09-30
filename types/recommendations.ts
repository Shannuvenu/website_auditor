export interface Recommendations {
  available: boolean; reason?: string; summary?: string; biggestIssues?: string[];
  highestImpactFixes?: { title: string; findingIds: string[]; steps: string[]; evidence: string }[];
  categoryAnalysis?: { category: string; analysis: string }[];
  priorities?: { shortTerm: string[]; mediumTerm: string[]; ongoing: string[] };
}
