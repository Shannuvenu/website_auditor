'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Admin helper: change the ADMIN username and/or password. The server re-checks the current password and re-validates everything. */
export function AdminAccountForm({ username, enabled }: { username: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get('newPassword') ?? '');
    if (newPassword !== String(data.get('confirmPassword') ?? '')) {
      setMessage({ ok: false, text: 'The new passwords do not match' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: data.get('currentPassword'),
          newUsername: data.get('newUsername'),
          ...(newPassword ? { newPassword } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ ok: false, text: body?.error?.message ?? 'Request failed' });
        return;
      }
      form.reset();
      setMessage({ ok: true, text: 'Saved. This browser stays signed in; other sessions for this account were signed out.' });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server' });
    } finally {
      setBusy(false);
    }
  }

  const input = 'mt-1 w-full rounded border border-slate-300 px-3 py-1.5';
  return (
    <>
      {!enabled ? (
        <p className="mb-2 text-sm text-amber-800">Changes are stored in Apps Script, so they need DATA_SOURCE=apps-script. This form is disabled in demo mode.</p>
      ) : null}
      <form key={username} onSubmit={submit} className="grid max-w-md gap-3 text-sm">
        <label>Username<input name="newUsername" defaultValue={username} required minLength={3} maxLength={64} autoComplete="username" className={input} /></label>
        <label>New password (leave empty to keep the current one)<input name="newPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" className={input} /></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" className={input} /></label>
        <label>Current password<input name="currentPassword" type="password" required autoComplete="current-password" className={input} /></label>
        <div className="flex items-center gap-3">
          <button disabled={busy || !enabled} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-60">Save changes</button>
          {message ? <span role="status" className={message.ok ? 'text-green-700' : 'text-red-700'}>{message.text}</span> : null}
        </div>
      </form>
    </>
  );
}