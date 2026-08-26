'use client';

import { useAuth } from '@/providers/AuthProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { Spinner } from '@/components/ui/Spinner';
import { TutorialOverlay } from '@/components/tutorial/TutorialOverlay';
import { useTutorial } from '@/hooks/useTutorial';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tutorial = useTutorial();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [user, isLoading, router]);

  // Scroll to top on route change to prevent stale scroll position
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen lg:flex">
      {/* Status-bar scrim. viewport-fit=cover lets the page paint under the
          clock/signal/battery, so scrolled content collided with them. This
          covers exactly the top inset (0px height on devices without one). */}
      <div
        aria-hidden
        style={{ height: 'env(safe-area-inset-top, 0px)' }}
        className="fixed top-0 left-0 right-0 z-40 bg-gray-50 dark:bg-gray-950 lg:hidden"
      />
      <SidebarNav />
      <div className="flex-1 lg:pl-64">
        <main className="mx-auto max-w-lg lg:max-w-5xl px-4 lg:px-8 pt-safe-6 pb-28 lg:pb-6">{children}</main>
      </div>
      <BottomNav />
      <TutorialOverlay {...tutorial} />
    </div>
  );
}
