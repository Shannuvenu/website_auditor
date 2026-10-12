import { describe, expect, it } from 'vitest';
import { loadAppsScript, plain } from '../scripts/appsScriptVm';

const gs = loadAppsScript();
const enqueue = gs.Queue_enqueue_ as (ctx: unknown, spec: unknown) => { enqueued: boolean; runId?: string; reason?: string };
const process_ = gs.Queue_process_ as (ctx: unknown) => { urlsProcessed: number; runsCompleted: number; stoppedBecause: string };

const template = (id: string, n = 5) => ({ templateId: id, brand: 'DH', sampleUrls: Array.from({ length: n }, (_, i) => `https://www.deccanherald.com/article/${id}-${i}`) });

function makeCtx(opts: { urlCostMs?: number; budgetMs?: number; quotaOn?: (url: string) => boolean } = {}) {
  const store = new Map<string, string>();
  let clock = 0;
  let counter = 0;
  const log = { collected: [] as string[], audits: [] as unknown[], runs: new Map<string, Record<string, unknown>>(), finalized: [] as string[] };
  const ctx = {
    props: { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v), remove: (k: string) => void store.delete(k) },
    now: () => clock,
    nowIso: () => new Date(1_700_000_000_000 + clock).toISOString(),
    newId: () => `run${++counter}`,
    budgetMs: opts.budgetMs ?? 240000,
    minRemainingMs: 70000,
    runsPerUrl: 3,
    createRun: (row: Record<string, unknown>) => void log.runs.set(String(row.run_id), { ...row }),
    updateRun: (id: string, patch: Record<string, unknown>) => void Object.assign(log.runs.get(id) as object, patch),
    appendAuditRows: (rows: unknown[]) => void log.audits.push(...rows),
    collectUrl: (state: { urls: string[]; templateId: string }, i: number) => {
      const url = state.urls[i];
      if (opts.quotaOn?.(url)) return { retryLater: true };
      clock += opts.urlCostMs ?? 20000;
      log.collected.push(url);
      return { rows: [{ url }], failed: false };
    },
    failedRows: (_s: unknown, i: number) => [{ failedIndex: i }],
    finalizeRun: (state: { runId: string }) => {
      log.finalized.push(state.runId);
      return { status: 'completed', summary: { urlsMeasured: 5 } };
    },
  };
  return { ctx, store, log };
}

describe('resumable queue', () => {
  it('processes a whole run when time allows', () => {
    const { ctx, log, store } = makeCtx();
    enqueue(ctx, { template: template('T1'), device: 'mobile', trigger: 'scheduled', runsPerUrl: 3 });
    const stats = plain<{ urlsProcessed: number; runsCompleted: number; stoppedBecause: string }>(process_(ctx));
    expect(stats).toEqual({ urlsProcessed: 5, runsCompleted: 1, stoppedBecause: 'idle' });
    expect(log.runs.get('run1')).toMatchObject({ status: 'completed', units_done: 5 });
    expect([...store.keys()]).toEqual(['Q_ORDER']); // run state cleaned up
  });

  it('saves progress at the time limit and resumes from the next URL without repeating work', () => {
    const { ctx, log } = makeCtx({ urlCostMs: 80000 }); // budget 240s, needs 70s spare: 3 URLs per execution
    enqueue(ctx, { template: template('T1'), device: 'mobile', trigger: 'scheduled', runsPerUrl: 3 });

    const first = plain<{ urlsProcessed: number; stoppedBecause: string }>(process_(ctx));
    expect(first).toMatchObject({ urlsProcessed: 3, stoppedBecause: 'time' });
    expect(log.runs.get('run1')).toMatchObject({ status: 'running', units_done: 3 });
    expect(log.finalized).toEqual([]);

    // next trigger: a fresh execution window (clock budget measured from its own start)
    const second = plain<{ urlsProcessed: number; runsCompleted: number }>(process_(ctx));
    expect(second).toMatchObject({ urlsProcessed: 2, runsCompleted: 1 });
    expect(log.collected).toHaveLength(5);
    expect(new Set(log.collected).size).toBe(5); // no URL measured twice
    expect(log.finalized).toEqual(['run1']);
  });

  it('works through several runs in order', () => {
    const { ctx, log } = makeCtx({ urlCostMs: 1000 });
    enqueue(ctx, { template: template('A', 2), device: 'mobile', trigger: 'scheduled', runsPerUrl: 3 });
    enqueue(ctx, { template: template('B', 2), device: 'desktop', trigger: 'scheduled', runsPerUrl: 3 });
    process_(ctx);
    expect(log.finalized).toEqual(['run1', 'run2']);
    expect(log.collected[0]).toContain('/A-0');
    expect(log.collected[2]).toContain('/B-0');
  });

  it('does not queue the same template and device twice', () => {
    const { ctx } = makeCtx();
    expect(enqueue(ctx, { template: template('T1'), device: 'mobile', trigger: 'scheduled', runsPerUrl: 3 }).enqueued).toBe(true);
    expect(plain(enqueue(ctx, { template: template('T1'), device: 'mobile', trigger: 'retest', runsPerUrl: 3 }))).toEqual({ enqueued: false, reason: 'ALREADY_PENDING' });
    expect(enqueue(ctx, { template: template('T1'), device: 'desktop', trigger: 'retest', runsPerUrl: 3 }).enqueued).toBe(true);
  });

  it('stops without losing the URL when the API is rate limited, and gives up after repeated failures', () => {
    const { ctx, log } = makeCtx({ quotaOn: (u) => u.endsWith('-1') });
    enqueue(ctx, { template: template('T1', 3), device: 'mobile', trigger: 'scheduled', runsPerUrl: 3 });
    for (let i = 0; i < 4; i++) expect(plain<{ stoppedBecause: string }>(process_(ctx)).stoppedBecause).toBe('quota');
    expect(log.collected).toHaveLength(1);
    const last = plain<{ runsCompleted: number }>(process_(ctx)); // fifth attempt: URL recorded as failed, run completes
    expect(last.runsCompleted).toBe(1);
    expect(log.runs.get('run1')).toMatchObject({ units_failed: 1, status: 'completed' });
  });
});

describe('web endpoint protection', () => {
  const web = loadAppsScript({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => (k === 'API_TOKEN' ? 'secret-token' : null) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t: string) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: {},
  });
  const post = (body: unknown) => JSON.parse((web.doPost as (e: unknown) => { text: string })({ postData: { contents: JSON.stringify(body) } }).text);

  it('rejects missing or wrong tokens and never returns data', () => {
    expect(post({ action: 'templates' })).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(post({ action: 'templates', token: 'wrong' })).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(post({ action: 'templates', token: 'secret-tokeX' }).ok).toBe(false);
  });

  it('rejects malformed bodies, unknown actions, and answers GET without data', () => {
    const bad = JSON.parse((web.doPost as (e: unknown) => { text: string })({ postData: { contents: '{{' } }).text);
    expect(bad.error.code).toBe('BAD_REQUEST');
    expect(post({ action: 'drop-tables', token: 'secret-token' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ACTION' } });
    const get = JSON.parse((web.doGet as () => { text: string })().text);
    expect(get).toEqual({ ok: true, data: { service: 'template-pagespeed-advisor' } });
  });

  it('health reports presence of settings, never values', () => {
    const res = post({ action: 'health', token: 'secret-token' });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res)).not.toContain('secret-token');
  });

  it('validates retest input before touching any data', () => {
    expect(post({ action: 'retest', token: 'secret-token', templateId: 'X', device: 'tablet' })).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(post({ action: 'aggregate-history', token: 'secret-token' })).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
});
