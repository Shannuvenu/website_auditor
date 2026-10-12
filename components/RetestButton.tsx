'use client';

import { useState } from 'react';
import type { Device } from '@/lib/validation/schemas';

export function RetestButton({ templateId, device }: { templateId: string; device: Device }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function retest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/retest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId, device }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      const result = body?.results?.[0];
      if (result?.enqueued) setMessage({ text: 'Re-test queued. It runs on the next queue trigger (within about 5 minutes); see Run history.', error: false });
      else setMessage({ text: result?.reason === 'COOLDOWN' ? 'This template was re-tested recently. Try again later.' : 'A run for this template is already queued.', error: true });
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={retest} disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
        {busy ? 'Queuing…' : `Re-test same sample URLs (${device})`}
      </button>
      {message ? <p role="status" className={`text-xs ${message.error ? 'text-red-700' : 'text-green-800'}`}>{message.text}</p> : null}
    </div>
  );
}
