'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { getExternalWorkouts, isNativeShell } from '@/lib/native';

/** Module-level, so a route change inside the app does not re-run the import. */
let ranThisLoad = false;

/**
 * Pull in workouts recorded outside FitTrackr, once per app launch.
 *
 * Silent by design. The alternative — a review screen listing un-imported
 * workouts — means things sit unimported until someone remembers to visit it,
 * and the point of this is that a walk you did on the watch is simply there.
 *
 * Safe to run repeatedly: the native side sends a rolling 90-day window and
 * the server upserts on each workout's HealthKit UUID. That is deliberately
 * chosen over an `HKAnchoredObjectQuery`, whose anchor advances when read — a
 * failed upload would then lose those workouts permanently, with nothing to
 * notice it had happened.
 *
 * `ranThisLoad` is module-level rather than a ref because the hook mounts on
 * every dashboard route. A ref resets with the component; this does not, so a
 * navigation does not re-import.
 *
 * Everything is swallowed. An import that fails must never keep the app from
 * rendering — it will simply try again on the next launch.
 */
export function useHealthImport() {
  const queryClient = useQueryClient();
  const clientRef = useRef(queryClient);
  clientRef.current = queryClient;

  useEffect(() => {
    if (ranThisLoad || !isNativeShell()) return;
    ranThisLoad = true;

    void (async () => {
      try {
        const workouts = await getExternalWorkouts();
        if (workouts.length === 0) return;

        const res = await apiFetch<{ data: { created: number; updated: number } }>(
          '/workouts/import-health',
          { method: 'POST', body: JSON.stringify({ workouts }) },
        );

        // Only disturb the UI when something actually arrived. Refetching the
        // dashboard on every launch to discover nothing changed is churn the
        // user pays for in spinners.
        if ((res?.data?.created ?? 0) > 0) {
          const client = clientRef.current;
          client.invalidateQueries({ queryKey: ['workouts'] });
          client.invalidateQueries({ queryKey: ['workouts-range'] });
          client.invalidateQueries({ queryKey: ['workout-volume'] });
        }
      } catch { /* try again next launch */ }
    })();
  }, []);
}
