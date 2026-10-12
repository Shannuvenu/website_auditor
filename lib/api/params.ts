import { z } from 'zod';
import { brandSchema, deviceSchema } from '@/lib/validation/schemas';

export const templateIdSchema = z.string().regex(/^[A-Z0-9_]{1,64}$/, 'Invalid template id');
export const deviceParamSchema = deviceSchema.default('mobile');
export const brandParamSchema = brandSchema.optional();

/** Parses a query value that may be missing, returning undefined for blanks ("all"). */
export function optionalParam(value: string | null): string | undefined {
  return value && value !== 'all' ? value : undefined;
}
