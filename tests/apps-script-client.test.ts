import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppsScriptError, callAppsScript } from '@/lib/apps-script/client';

const schema = z.object({ templates: z.array(z.string()) });
const okResponse = (templates: string[]) => new Response(JSON.stringify({ ok: true, data: { templates } }), { status: 200 });

let counter = 0;
const uniquePayload = () => ({ n: `t${++counter}` });

beforeEach(() => {
  process.env.APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/test/exec';
  process.env.APPS_SCRIPT_TOKEN = 'test-token';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('callAppsScript (mocked fetch; no real Apps Script is contacted)', () => {
  it('shares one network call between identical concurrent reads', async () => {
    const fetchMock = vi.fn(async () => okResponse(['A']));
    vi.stubGlobal('fetch', fetchMock);
    const payload = uniquePayload();
    const [a, b] = await Promise.all([
      callAppsScript('templates', payload, schema, { cacheable: true }),
      callAppsScript('templates', payload, schema, { cacheable: true }),
    ]);
    expect(a).toEqual({ templates: ['A'] });
    expect(b).toEqual({ templates: ['A'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a read once after HTTP 404 and then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('nope', { status: 404 })).mockResolvedValueOnce(okResponse(['B']));
    vi.stubGlobal('fetch', fetchMock);
    const result = await callAppsScript('templates', uniquePayload(), schema, { cacheable: true });
    expect(result).toEqual({ templates: ['B'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once when the response has an unexpected shape', async () => {
    const bad = new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
    const fetchMock = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(okResponse(['C']));
    vi.stubGlobal('fetch', fetchMock);
    expect(await callAppsScript('templates', uniquePayload(), schema, { cacheable: true })).toEqual({ templates: ['C'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the last good copy when a later read fails twice, and fails when there is none', async () => {
    const payload = uniquePayload();
    const t0 = Date.now();
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(['D'])));
    expect(await callAppsScript('templates', payload, schema, { cacheable: true })).toEqual({ templates: ['D'] });

    vi.spyOn(Date, 'now').mockReturnValue(t0 + 5 * 60_000); // fresh copy expired, stale copy still valid
    const failing = vi.fn(async () => new Response('down', { status: 404 }));
    vi.stubGlobal('fetch', failing);
    expect(await callAppsScript('templates', payload, schema, { cacheable: true })).toEqual({ templates: ['D'] });
    expect(failing).toHaveBeenCalledTimes(2);

    await expect(callAppsScript('templates', uniquePayload(), schema, { cacheable: true })).rejects.toBeInstanceOf(AppsScriptError);
  });

  it('never retries or caches writes', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callAppsScript('retest', { templateId: 'X' }, schema)).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an application error such as an invalid token', async () => {
    const body = JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callAppsScript('templates', uniquePayload(), schema, { cacheable: true })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});