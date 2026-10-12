'use client';

import { useState } from 'react';

/** Admin helper: which registry template does a URL belong to? Pure string matching, nothing is fetched. */
export function AdminMatchTool() {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const url = new FormData(event.currentTarget).get('url');
    const res = await fetch('/api/admin/match-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    const body = await res.json().catch(() => null);
    setResult(!res.ok ? body?.error?.message ?? 'Request failed' : body.match ? `${body.match.templateId} (${body.match.urlPattern})` : 'No active template matches this URL');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm">
      <input name="url" required placeholder="https://www.deccanherald.com/..." className="min-w-[18rem] flex-1 rounded border border-slate-300 px-3 py-1.5" />
      <button disabled={busy} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100">Match</button>
      {result ? <span role="status">{result}</span> : null}
    </form>
  );
}
