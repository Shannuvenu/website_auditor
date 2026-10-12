import { describe, expect, it } from 'vitest';
import { bytesToMs, compareByPriority, computePriority, EFFORT_DIVISOR, priorityForIssue, rankAuditsByImpact, savingsMsFor } from '@/lib/priority';
import type { AggregatedAudit } from '@/lib/validation/schemas';

const audit = (over: Partial<AggregatedAudit> = {}): AggregatedAudit => ({
  auditId: 'a', title: 'A', category: 'performance', affectedCount: 8, sampledCount: 10, affectedShare: 0.8,
  affectedUrls: [], medianSavingsMs: 1000, medianSavingsBytes: null, repeatedOffenders: [], ...over,
});

describe('effort mapping', () => {
  it('maps S, M, L to 1, 2, 4', () => {
    expect(EFFORT_DIVISOR).toEqual({ S: 1, M: 2, L: 4 });
  });
});

describe('priority score', () => {
  it('is savings x share x weight / effort', () => {
    expect(computePriority({ savingsMs: 1000, share: 0.8, trafficWeight: 1, effort: 'M' }).score).toBe(400);
    expect(computePriority({ savingsMs: 1000, share: 0.8, trafficWeight: 1, effort: 'S' }).score).toBe(800);
    expect(computePriority({ savingsMs: 1000, share: 0.5, trafficWeight: 2, effort: 'L' }).score).toBe(250);
  });

  it('is null (unquantified) without measured savings, never invented', () => {
    const p = computePriority({ savingsMs: null, share: 1, trafficWeight: 1, effort: 'S' });
    expect(p.score).toBeNull();
    expect(p.basis).toBe('unquantified');
    expect(computePriority({ savingsMs: 0, share: 1, trafficWeight: 1, effort: 'S' }).score).toBeNull();
  });

  it('converts byte-only savings to ms with Lighthouse throttling', () => {
    expect(bytesToMs(204800, 'mobile')).toBeCloseTo(1000, 0); // 1,638.4 Kbps = 204,800 B/s
    expect(savingsMsFor(audit({ medianSavingsMs: null, medianSavingsBytes: 204800 }), 'mobile')).toBeCloseTo(1000, 0);
    expect(savingsMsFor(audit({ medianSavingsMs: 300, medianSavingsBytes: 999999 }), 'mobile')).toBe(300);
    expect(savingsMsFor(audit({ medianSavingsMs: null }), 'desktop')).toBeNull();
  });

  it('uses the max savings and share of the cited audits, not the sum', () => {
    const p = priorityForIssue([audit({ auditId: 'x', medianSavingsMs: 500, affectedShare: 0.9 }), audit({ auditId: 'y', medianSavingsMs: 800, affectedShare: 0.4 })], 'S', 'mobile');
    expect(p.savingsMs).toBe(800);
    expect(p.share).toBe(0.9);
    expect(p.score).toBeCloseTo(720);
  });
});

describe('ranking', () => {
  it('puts quantified items first by score, then unquantified by share/effort, with stable ties', () => {
    const items = [
      { priority: computePriority({ savingsMs: null, share: 0.9, trafficWeight: 1, effort: 'S' }), tieBreak: 'b' },
      { priority: computePriority({ savingsMs: 100, share: 1, trafficWeight: 1, effort: 'S' }), tieBreak: 'a' },
      { priority: computePriority({ savingsMs: 900, share: 1, trafficWeight: 1, effort: 'S' }), tieBreak: 'c' },
      { priority: computePriority({ savingsMs: null, share: 0.3, trafficWeight: 1, effort: 'S' }), tieBreak: 'd' },
    ];
    expect([...items].sort(compareByPriority).map((i) => i.tieBreak)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('ranks audits by measured impact', () => {
    const ranked = rankAuditsByImpact([audit({ auditId: 'low', medianSavingsMs: 100 }), audit({ auditId: 'high', medianSavingsMs: 900 }), audit({ auditId: 'none', medianSavingsMs: null })], 'mobile');
    expect(ranked.map((r) => r.audit.auditId)).toEqual(['high', 'low', 'none']);
  });
});
