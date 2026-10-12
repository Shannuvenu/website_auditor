import type { Brand } from '@/lib/validation/schemas';

/**
 * Hosts that sample URLs may point at. This mirrors the BRAND_HOSTS Script Property in Apps Script
 * and is the SSRF/abuse guard: nothing outside these hosts is ever accepted as a sample URL.
 */
export const BRAND_HOSTS: Record<Brand, readonly string[]> = {
  DH: ['www.deccanherald.com'],
  PV: ['www.prajavani.net'],
};

export const BRAND_LABELS: Record<Brand, string> = { DH: 'Deccan Herald', PV: 'Prajavani' };
