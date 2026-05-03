'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { Exercise, MuscleGroup } from '@fittrackr/shared';
import { Search, Dumbbell, ChevronRight } from 'lucide-react';

export default function ExercisesPage() {
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | ''>('');

  const { data, isLoading } = useQuery({
    queryKey: ['exercises', query, muscleFilter],
    queryFn: () =>
      apiFetch<{ data: Exercise[]; meta: any }>(
        `/exercises?search=${encodeURIComponent(query)}&muscle=${muscleFilter}&limit=50`,
      ),
    staleTime: 30_000,
  });

  const exercises = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exercise Library</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Browse and filter exercises</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="pl-9"
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CORE', 'CALVES'] as MuscleGroup[]).map(
          (m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMuscleFilter(muscleFilter === m ? '' : m)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                muscleFilter === m
                  ? 'text-white border-transparent'
                  : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400'
              }`}
              style={muscleFilter === m ? { backgroundColor: MUSCLE_GROUP_COLORS[m] } : {}}
            >
              {MUSCLE_GROUP_LABELS[m]}
            </button>
          ),
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {exercises.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">No exercises found.</div>
          ) : (
            exercises.map((ex) => (
              <div key={ex.id} className="flex items-center gap-3 px-4 py-3">
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: MUSCLE_GROUP_COLORS[ex.primaryMuscle] + '20' }}
                >
                  <Dumbbell className="h-4 w-4" style={{ color: MUSCLE_GROUP_COLORS[ex.primaryMuscle] }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{ex.name}</p>
                  <p className="text-xs text-gray-500">
                    {MUSCLE_GROUP_LABELS[ex.primaryMuscle]}
                    {ex.secondaryMuscles?.length > 0 && ` · ${ex.secondaryMuscles.slice(0, 2).map((m) => MUSCLE_GROUP_LABELS[m as MuscleGroup]).join(', ')}`}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 shrink-0">
                  {ex.equipment.toLowerCase().replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {data?.meta && (
        <p className="text-xs text-center text-gray-400">{data.meta.total} exercises in library</p>
      )}
    </div>
  );
}
