import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/80 dark:backdrop-blur-sm', className)} {...props}>
      {children}
    </div>
  );
}
