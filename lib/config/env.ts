// Server-side configuration. Values are read lazily so tests can set process.env freely.
// Nothing in this module logs or returns secret values; `getSafeConfigStatus` reports presence only.

export type DataSourceKind = 'apps-script' | 'mock';

const APPS_SCRIPT_HOSTS = ['script.google.com', 'script.googleusercontent.com'];

export function getDataSourceKind(): DataSourceKind {
  return (process.env.DATA_SOURCE ?? 'mock').trim() === 'apps-script' ? 'apps-script' : 'mock';
}

export interface AppsScriptConfig {
  endpoint: string;
  token: string;
}

/** Throws a readable error when the endpoint is missing or not a Google Apps Script https URL. */
export function getAppsScriptConfig(): AppsScriptConfig {
  const endpoint = (process.env.APPS_SCRIPT_ENDPOINT ?? '').trim();
  const token = (process.env.APPS_SCRIPT_TOKEN ?? '').trim();
  if (!endpoint || !token) throw new Error('APPS_SCRIPT_ENDPOINT and APPS_SCRIPT_TOKEN must be set when DATA_SOURCE=apps-script');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('APPS_SCRIPT_ENDPOINT is not a valid URL');
  }
  if (url.protocol !== 'https:' || !APPS_SCRIPT_HOSTS.includes(url.hostname)) {
    throw new Error('APPS_SCRIPT_ENDPOINT must be an https://script.google.com/... URL');
  }
  return { endpoint, token };
}

export function isDeveloperRetestAllowed(): boolean {
  return (process.env.ALLOW_DEVELOPER_RETEST ?? 'true').trim().toLowerCase() !== 'false';
}

export function getLlmTemperature(): number {
  const raw = process.env.AI_TEMPERATURE;
  const t = raw === undefined || raw === '' ? NaN : Number(raw);
  // Clamped to 0..1 (Anthropic's maximum). Low values keep output closer to the evidence.
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.1;
}

export function getMaxLlmInputChars(): number {
  const n = Number(process.env.AI_MAX_INPUT_CHARS);
  return Number.isFinite(n) && n >= 4000 ? n : 24000;
}

export interface SafeConfigStatus {
  dataSource: DataSourceKind;
  appsScriptConfigured: boolean;
  llmProvider: string | null;
  llmModel: string | null;
  developerRetestAllowed: boolean;
  sessionSecretConfigured: boolean;
  usersConfigured: boolean;
}

/** What the admin screen may show. Never includes keys, tokens or endpoint URLs. */
export function getSafeConfigStatus(): SafeConfigStatus {
  const provider = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  return {
    dataSource: getDataSourceKind(),
    appsScriptConfigured: Boolean(process.env.APPS_SCRIPT_ENDPOINT && process.env.APPS_SCRIPT_TOKEN),
    llmProvider: provider || null,
    llmModel: process.env.AI_MODEL?.trim() || null,
    developerRetestAllowed: isDeveloperRetestAllowed(),
    sessionSecretConfigured: (process.env.SESSION_SECRET ?? '').length >= 32,
    usersConfigured: Boolean(process.env.AUTH_USERS),
  };
}
