'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setAccessToken, setRefreshToken, getApiUrl } from '@/lib/api-client';
import { useAuth } from '@/providers/AuthProvider';
import { Spinner } from '@/components/ui/Spinner';

function OAuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const code = searchParams.get('code');

    if (!code) {
      router.replace('/login');
      return;
    }

    // Exchange the short-lived auth code for tokens via POST
    fetch(`${getApiUrl()}/auth/exchange-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Code exchange failed');
        return res.json();
      })
      .then((data) => {
        setAccessToken(data.data.accessToken);
        setRefreshToken(data.data.refreshToken);
        return refreshUser();
      })
      .then(() => {
        router.replace('/dashboard');
      })
      .catch(() => {
        router.replace('/login');
      });
  }, [searchParams, refreshUser, router]);

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Spinner />
      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Completing sign in...</p>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center py-12">
          <Spinner />
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      }
    >
      <OAuthCallbackInner />
    </Suspense>
  );
}
