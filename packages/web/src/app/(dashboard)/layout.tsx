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
      <SidebarNav />
      <div className="flex-1 lg:pl-64">
        <main className="mx-auto max-w-lg lg:max-w-5xl px-4 lg:px-8 pt-safe-6 pb-24 lg:pb-6">{children}</main>
      </div>
      <BottomNav />
      <TutorialOverlay {...tutorial} />
    </div>
  );
}
