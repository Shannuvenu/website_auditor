export function StateMessage({ title, children, tone = 'neutral' }: { title: string; children?: React.ReactNode; tone?: 'neutral' | 'error' }) {
  const styles = tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-white text-slate-700';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-6 ${styles}`}>
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm">{children}</div> : null}
    </div>
  );
}
