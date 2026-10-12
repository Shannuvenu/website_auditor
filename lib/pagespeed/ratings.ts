// Core Web Vitals thresholds (good / poor boundaries). Reused from the original PageSpeed client.
export type Rating = 'good' | 'needs-improvement' | 'poor' | 'unavailable';
export type MetricKey = 'lcp' | 'cls' | 'fcp' | 'inp' | 'ttfb' | 'tbt' | 'si';

const LIMITS: Record<MetricKey, [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  inp: [200, 500],
  ttfb: [800, 1800],
  tbt: [200, 600],
  si: [3400, 5800],
};

export function rateMetric(key: MetricKey, value: number | null | undefined): Rating {
  if (value === null || value === undefined) return 'unavailable';
  const [good, poor] = LIMITS[key];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

/** Lighthouse score bands: 90+ good, 50-89 needs improvement, below 50 poor. */
export function rateScore(score: number | null | undefined): Rating {
  if (score === null || score === undefined) return 'unavailable';
  return score >= 90 ? 'good' : score >= 50 ? 'needs-improvement' : 'poor';
}

export function formatSeconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`;
}

export function formatMs(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? 'n/a' : `${Math.round(ms)} ms`;
}

export function formatCls(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : value.toFixed(2);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'n/a';
  return bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;
}
