import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-lg font-semibold">Admin access required</h1>
      <p className="text-sm text-slate-600">Your role cannot open this page. Developers use the template views only.</p>
      <Link href="/" className="text-sm text-blue-700 hover:underline">Back to templates</Link>
    </main>
  );
}
