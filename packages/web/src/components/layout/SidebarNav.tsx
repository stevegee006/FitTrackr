'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navItems } from './nav-items';

const TUTORIAL_KEYS: Record<string, string> = {
  '/log': 'nav-log',
  '/nutrition': 'nav-macros',
  '/profile': 'nav-profile',
};

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex h-16 items-center gap-2.5 px-6">
        <img src="/logo-flame.svg" alt="" className="h-7 w-7" />
        <span className="text-lg font-bold">
          <span className="text-gray-900 dark:text-gray-100">Fit</span>
          <span className="text-gray-400 dark:text-gray-500 font-light">Trackr</span>
        </span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              {...(TUTORIAL_KEYS[href] ? { 'data-tutorial': TUTORIAL_KEYS[href], 'data-tutorial-ctx': 'desktop' } : {})}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
