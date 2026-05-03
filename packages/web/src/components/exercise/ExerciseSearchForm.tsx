'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS } from '@fittrackr/shared';
import type { Exercise, MuscleGroup } from '@fittrackr/shared';
import { Search, Dumbbell, ChevronRight } from 'lucide-react';

interface ExerciseSearchFormProps {
  onSelect: (exercise: Exercise) => void;
  placeholder?: string;
}

export function ExerciseSearchForm({ onSelect, placeholder = 'Search exercises…' }: ExerciseSearchFormProps) {
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['exercises', query, muscleFilter],
    queryFn: () =>
      apiFetch<{ data: Exercise[]; meta: any }>(
        `/exercises?search=${encodeURIComponent(query)}&muscle=${muscleFilter}&limit=30`,
      ),
    enabled: query.length > 0 || !!muscleFilter,
    staleTime: 30_000,
  });

  const exercises = data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
          autoFocus
        />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['CHEST', 'BACK', 'SHOULDERS', 'BICEPS', 'TRICEPS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CORE'] as MuscleGroup[]).map(
          (m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMuscleFilter(muscleFilter === m ? '' : m)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
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

      {isLoading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      {!isLoading && exercises.length === 0 && (query.length > 0 || muscleFilter) && (
        <p className="text-sm text-gray-500 text-center py-4">No exercises found.</p>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {exercises.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => onSelect(ex)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          >
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: MUSCLE_GROUP_COLORS[ex.primaryMuscle] + '20' }}
            >
              <Dumbbell
                className="h-4 w-4"
                style={{ color: MUSCLE_GROUP_COLORS[ex.primaryMuscle] }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ex.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {MUSCLE_GROUP_LABELS[ex.primaryMuscle]} · {ex.equipment.toLowerCase().replace('_', ' ')}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
