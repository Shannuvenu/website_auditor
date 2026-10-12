import type { LlmProvider } from './provider';
import type { LlmInput } from './prompt';

/**
 * Offline stand-in for the LLM (AI_PROVIDER=mock) so the whole flow can be exercised without an API key.
 * It restates measured evidence only: no causes are guessed ("unknown"), and every number comes from the input.
 */
export function createMockProvider(): LlmProvider {
  return {
    name: 'mock',
    model: 'offline-evidence-echo',
    async complete(_system: string, user: string): Promise<string> {
      const json = user.slice(user.indexOf('{'));
      const input = JSON.parse(json) as LlmInput;
      const issues = input.failingAudits.slice(0, 4).map((audit) => ({
        issue: audit.title,
        audit_ids: [audit.auditId],
        affected_urls: audit.affectedUrls.slice(0, 3),
        likely_cause: 'unknown',
        proposed_change: `Review the "${audit.title}" audit details${
          audit.repeatedOffenders.length ? ` for the repeated offender ${audit.repeatedOffenders[0].resource}` : ''
        } and address what Lighthouse reports for ${audit.affectedCount} of ${audit.sampledCount} sample URLs.`,
        effort: 'M',
        confidence: 'Low',
        verify_step: `Re-run the same sample URLs and check that the ${audit.auditId} audit no longer fails.`,
      }));
      return JSON.stringify({ issues });
    },
  };
}
