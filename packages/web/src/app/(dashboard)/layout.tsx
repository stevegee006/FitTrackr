'use client';

import { useAuth } from '@/providers/AuthProvider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { Spinner } from '@/components/ui/Spinner';
import { TutorialOverlay } from '@/components/tutorial/TutorialOverlay';
import { useTutorial } from '@/hooks/useTutorial';
import { useHealthImport } from '@/hooks/useHealthImport';
import { RestTimerProvider } from '@/providers/RestTimerProvider';
import { SessionDock } from '@/components/workout/SessionDock';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tutorial = useTutorial();
  // Workouts recorded elsewhere, pulled in once per app launch. Lives here
  // rather than on a page so it runs whichever screen the app opens on — and
  // only inside the native shell, where HealthKit exists.
  useHealthImport();

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
    /* The rest countdown and the session pill are mounted HERE, above the
       routed page, so neither is unmounted by navigation. See the provider. */
    <RestTimerProvider>
    <div className="min-h-screen lg:flex">
      {/* Status-bar scrim. viewport-fit=cover lets the page paint under the
          clock/signal/battery, so scrolled content collided with them.
          Opaque across the inset, then fades out over 1.5rem so content
          dissolves as it scrolls under instead of meeting a hard edge.
          Collapses to a 1.5rem no-op on devices with no inset.
          pointer-events-none matters: the fade tail overlaps the header, and a
          solid overlay there would swallow taps on the back button. */}
      <div
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 right-0 z-40 lg:hidden"
      >
        {/* Opaque over the inset itself. Two stacked layers rather than one
            gradient with env() in a colour stop — Safari's support for env()
            nested inside a gradient is unreliable, and it would fail silently. */}
        <div style={{ height: 'env(safe-area-inset-top, 0px)', background: 'var(--scrim)' }} />
        {/* Fade tail, ending where main's pt-safe-6 padding starts. */}
        <div
          className="h-6"
          style={{ background: 'linear-gradient(to bottom, var(--scrim), transparent)' }}
        />
      </div>
      <SidebarNav />
      <div className="flex-1 lg:pl-64">
        <main className="mx-auto max-w-lg lg:max-w-5xl px-4 lg:px-8 pt-safe-6 pb-28 lg:pb-6">{children}</main>
      </div>
      <BottomNav />
      <SessionDock />
      <TutorialOverlay {...tutorial} />
    </div>
    </RestTimerProvider>
  );
}
