'use client';

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <button type="button" onClick={reset} className="rounded border border-slate-300 px-3 py-1 text-sm">Try again</button>
    </main>
  );
}
