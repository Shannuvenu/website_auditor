import { z } from 'zod';
import { cache } from '@/lib/cache/memory';
import { getAppsScriptConfig } from '@/lib/config/env';

export class AppsScriptError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** True only for failures that are safe to repeat once (read requests). */
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppsScriptError';
  }
}

const envelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

const READ_CACHE_MS = 60_000;
const STALE_CACHE_MS = 6 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 800;
const TIMEOUT_MS = 55_000;

/** Identical read requests that are still running share one network call. */
const inFlight = new Map<string, Promise<unknown>>();

/** One request to Apps Script. Server-side only: the token travels in the POST body, never in a URL. */
async function requestOnce<T>(action: string, payload: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { endpoint, token } = getAppsScriptConfig();
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      // text/plain keeps this a "simple" request for Apps Script; the body is still JSON
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action, token }),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.log(`[timing] apps-script action=${action} outcome=${timedOut ? 'timeout' : 'unreachable'} ms=${elapsed()}`);
    // a timeout already cost the full wait, so it is not repeated; a quick network failure may be
    throw new AppsScriptError('UNREACHABLE', timedOut ? 'The data service timed out' : 'The data service could not be reached', !timedOut);
  }
  if (!response.ok) {
    console.log(`[timing] apps-script action=${action} outcome=http-${response.status} ms=${elapsed()}`);
    throw new AppsScriptError('HTTP_ERROR', `The data service answered HTTP ${response.status}`, true);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppsScriptError('BAD_RESPONSE', 'The data service did not return JSON (check the deployment access setting)', true);
  }
  console.log(`[timing] apps-script action=${action} outcome=ok ms=${elapsed()}`);
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) throw new AppsScriptError('BAD_RESPONSE', 'Unexpected response from the data service', true);
  if (!envelope.data.ok) throw new AppsScriptError(envelope.data.error.code, envelope.data.error.message);

  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    const received = envelope.data.data && typeof envelope.data.data === 'object' ? Object.keys(envelope.data.data).join(',') : typeof envelope.data.data;
    console.error(`[apps-script] ${action}: response failed validation (${parsed.error.issues[0]?.path.join('.')}; data keys: ${received || 'none'})`);
    throw new AppsScriptError('BAD_RESPONSE', 'The data service returned data in an unexpected format', true);
  }
  return parsed.data;
}

/** Reads are idempotent, so a transient failure is repeated once after a short pause. */
async function readWithRetry<T>(action: string, payload: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  try {
    return await requestOnce(action, payload, schema);
  } catch (error) {
    if (!(error instanceof AppsScriptError) || !error.retryable) throw error;
    console.log(`[apps-script] ${action}: ${error.code}, retrying once`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return requestOnce(action, payload, schema);
  }
}

/**
 * Calls the protected Apps Script web app. The response is validated with `schema` before it is used.
 * Cacheable (read) calls are cached for a minute, shared while in flight, retried once on transient failure,
 * and answered from the last good copy (up to 6 hours old) if Apps Script keeps failing.
 * Writes (cacheable not set) are never retried or served from cache.
 */
export async function callAppsScript<T>(
  action: string,
  payload: Record<string, unknown>,
  schema: z.ZodType<T>,
  options: { cacheable?: boolean } = {},
): Promise<T> {
  if (!options.cacheable) return requestOnce(action, payload, schema);

  const cacheKey = `apps-script:${action}:${JSON.stringify(payload)}`;
  const hit = cache.get<T>(cacheKey);
  if (hit !== undefined) {
    console.log(`[timing] apps-script action=${action} cache=hit`);
    return hit;
  }
  const pending = inFlight.get(cacheKey) as Promise<T> | undefined;
  if (pending) {
    console.log(`[timing] apps-script action=${action} shared-with-in-flight-call`);
    return pending;
  }

  const promise = readWithRetry(action, payload, schema)
    .then((data) => {
      cache.set(cacheKey, data, READ_CACHE_MS);
      cache.set(`stale:${cacheKey}`, data, STALE_CACHE_MS);
      return data;
    })
    .catch((error: unknown) => {
      const stale = cache.get<T>(`stale:${cacheKey}`);
      if (stale === undefined) throw error;
      console.warn(`[apps-script] ${action}: failed, serving the last good copy`);
      return stale;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, promise);
  return promise;
}