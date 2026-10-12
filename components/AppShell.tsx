import Link from 'next/link';
import { LogoutButton } from '@/components/LogoutButton';
import { getDataSourceKind } from '@/lib/config/env';
import type { Session } from '@/lib/auth/session';

export function AppShell({ session, children }: { session: Session; children: React.ReactNode }) {
  const demo = getDataSourceKind() === 'mock';
  const nav = [
    { href: '/', label: 'Templates' },
    { href: '/runs', label: 'Run history' },
    ...(session.role === 'ADMIN' ? [{ href: '/admin', label: 'Admin' }] : []),
  ];
  return (
    <div className="min-h-screen">
      {demo ? (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900">
          Demo mode: all numbers are synthetic sample data, not measurements (DATA_SOURCE=mock).
        </div>
      ) : null}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold">PageSpeed Advisor</span>
            <nav className="flex gap-4 text-sm">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="text-slate-600 hover:text-slate-900">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              {session.username} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{session.role}</span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
