'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="rounded border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100">
      Sign out
    </button>
  );
}
