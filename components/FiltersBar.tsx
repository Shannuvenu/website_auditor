'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface FilterSpec {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue: string;
}

export function FiltersBar({ filters }: { filters: FilterSpec[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function update(name: string, value: string) {
    const next = new URLSearchParams(search.toString());
    next.set(name, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3">
      {filters.map((f) => (
        <label key={f.name} className="flex items-center gap-2 text-sm text-slate-600">
          {f.label}
          <select
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-900"
            value={search.get(f.name) ?? f.defaultValue}
            onChange={(e) => update(f.name, e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
