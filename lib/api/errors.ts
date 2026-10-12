import { NextResponse } from 'next/server';
import { AppsScriptError } from '@/lib/apps-script/client';

/** Maps internal failures to safe API responses. Messages never include tokens, URLs or stack traces. */
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof AppsScriptError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'BAD_REQUEST' ? 400 : ['COOLDOWN', 'BUSY'].includes(error.code) ? 429 : 502;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  console.error(`[api] unexpected error: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`);
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, { status: 500 });
}
