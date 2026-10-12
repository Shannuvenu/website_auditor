import { rateScore, type Rating } from '@/lib/pagespeed/ratings';

const STYLES: Record<Rating, string> = {
  good: 'border-green-600 bg-green-50 text-green-800',
  'needs-improvement': 'border-amber-500 bg-amber-50 text-amber-800',
  poor: 'border-red-600 bg-red-50 text-red-800',
  unavailable: 'border-slate-300 bg-slate-50 text-slate-500',
};

export function RatingPill({ rating, children }: { rating: Rating; children: React.ReactNode }) {
  return (
    <span className={`inline-flex min-w-[2.5rem] justify-center rounded-full border px-2.5 py-0.5 text-sm font-semibold tabular-nums ${STYLES[rating]}`}>
      {children}
    </span>
  );
}

export function ScoreBadge({ score, label }: { score: number | null; label?: string }) {
  return (
    <span aria-label={label ? `${label} ${score ?? 'not available'}` : undefined}>
      <RatingPill rating={rateScore(score)}>{score ?? 'n/a'}</RatingPill>
    </span>
  );
}
