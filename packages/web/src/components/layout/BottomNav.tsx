'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navItems } from './nav-items';

export function BottomNav() {
  const pathname = usePathname();
  const centerIndex = Math.floor(navItems.length / 2);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200/80 bg-white/90 backdrop-blur-md pb-safe dark:border-gray-700/60 dark:bg-gray-900/90 lg:hidden">
      <div className="flex items-center justify-around px-2 pt-1.5 pb-1">
        {navItems.map(({ href, label, icon: Icon }, index) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          const isCenter = index === centerIndex;

          if (isCenter) {
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95',
                  isActive
                    ? 'bg-indigo-600 shadow-indigo-500/30'
                    : 'bg-indigo-500 shadow-indigo-500/20'
                )}
              >
                <Icon className="h-5 w-5 text-white" />
              </Link>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] transition-all',
                isActive
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
              )}
            >
              {isActive && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-indigo-500" />
              )}
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
