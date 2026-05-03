'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getAllTimezones, formatTimezoneLabel } from '@/lib/timezones';

interface TimezoneComboboxProps {
  value: string | null;
  onChange: (tz: string) => void;
}

export function TimezoneCombobox({ value, onChange }: TimezoneComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const allTimezones = useMemo(() => getAllTimezones(), []);

  const filtered = useMemo(() => {
    if (!search) return allTimezones;
    const lower = search.toLowerCase();
    return allTimezones.filter(
      (tz) =>
        tz.toLowerCase().includes(lower) ||
        formatTimezoneLabel(tz).toLowerCase().includes(lower),
    );
  }, [allTimezones, search]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        placeholder={value ? formatTimezoneLabel(value) : 'Search timezone...'}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className={cn(
          'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm',
          'placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500',
          'dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder:text-gray-500',
        )}
      />
      {open && (
        <div
          className={cn(
            'absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border',
            'border-gray-300 bg-white shadow-lg',
            'dark:border-gray-600 dark:bg-gray-800',
          )}
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              No timezones found
            </p>
          ) : (
            filtered.slice(0, 50).map((tz) => (
              <button
                key={tz}
                type="button"
                onClick={() => {
                  onChange(tz);
                  setSearch('');
                  setOpen(false);
                }}
                className={cn(
                  'block w-full px-3 py-2 text-left text-sm transition-colors',
                  'hover:bg-emerald-50 dark:hover:bg-gray-700',
                  value === tz &&
                    'bg-emerald-50 font-medium text-emerald-700 dark:bg-gray-700 dark:text-emerald-400',
                )}
              >
                {formatTimezoneLabel(tz)}
              </button>
            ))
          )}
          {filtered.length > 50 && (
            <p className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 text-center border-t border-gray-200 dark:border-gray-700">
              Type to narrow results…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
