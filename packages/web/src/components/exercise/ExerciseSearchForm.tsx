'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
// All four of these lists (labels, categories, the muscle dropdown and the
// filter chips) used to be local copies of the enums. They are shared now, so
// a muscle group added to the library appears here without a second edit.
import {
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_COLORS,
  ALL_MUSCLE_GROUPS,
  PRIMARY_MUSCLE_GROUPS,
  ALL_EQUIPMENT,
  EQUIPMENT_LABELS,
  ALL_EXERCISE_CATEGORIES,
  EXERCISE_CATEGORY_LABELS,
} from '@fittrackr/shared';
import type { Exercise, MuscleGroup } from '@fittrackr/shared';
import { Search, Dumbbell, ChevronRight, Plus, X, Check } from 'lucide-react';

interface ExerciseSearchFormProps {
  onSelect: (exercise: Exercise) => void;
  placeholder?: string;
}

interface CreateForm {
  name: string;
  primaryMuscle: MuscleGroup;
  equipment: string;
  category: string;
}

export function ExerciseSearchForm({ onSelect, placeholder = 'Search exercises…' }: ExerciseSearchFormProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    name: '',
    primaryMuscle: 'CHEST',
    equipment: 'BARBELL',
    category: 'COMPOUND',
  });
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

  const createMutation = useMutation({
    mutationFn: (body: CreateForm) =>
      apiFetch<{ data: Exercise }>('/exercises', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      setShowCreate(false);
      onSelect(res.data);
    },
  });

  const exercises = data?.data ?? [];
  const hasSearched = query.length > 0 || !!muscleFilter;
  const noResults = hasSearched && !isLoading && exercises.length === 0;

  function openCreate() {
    setCreateForm((f) => ({ ...f, name: query }));
    setShowCreate(true);
  }

  const selectClass = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="space-y-3">
      {!showCreate ? (
        <>
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
            {PRIMARY_MUSCLE_GROUPS.map(
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

          {noResults && (
            <div className="text-center py-4 space-y-2">
              <p className="text-sm text-gray-500">No exercises found for &quot;{query}&quot;</p>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800"
              >
                <Plus className="h-4 w-4" />
                Create &quot;{query}&quot;
              </button>
            </div>
          )}

          {exercises.length > 0 && (
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
                      {MUSCLE_GROUP_LABELS[ex.primaryMuscle]} · {ex.equipment.toLowerCase().replace(/_/g, ' ')}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                </button>
              ))}
              {/* Always offer create at the bottom of results too */}
              <button
                type="button"
                onClick={openCreate}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left text-indigo-600 dark:text-indigo-400"
              >
                <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-indigo-50 dark:bg-indigo-950/40">
                  <Plus className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">Create new exercise…</span>
              </button>
            </div>
          )}

          {/* Show create option even before searching */}
          {!hasSearched && (
            <button
              type="button"
              onClick={openCreate}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create new exercise
            </button>
          )}
        </>
      ) : (
        /* ── Create form ── */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">New Exercise</p>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Name</label>
            <Input
              autoFocus
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Incline Dumbbell Press"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Primary Muscle</label>
              <select
                value={createForm.primaryMuscle}
                onChange={(e) => setCreateForm((f) => ({ ...f, primaryMuscle: e.target.value as MuscleGroup }))}
                className={selectClass}
              >
                {ALL_MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>{MUSCLE_GROUP_LABELS[m]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Equipment</label>
              <select
                value={createForm.equipment}
                onChange={(e) => setCreateForm((f) => ({ ...f, equipment: e.target.value }))}
                className={selectClass}
              >
                {ALL_EQUIPMENT.map((eq) => (
                  <option key={eq} value={eq}>{EQUIPMENT_LABELS[eq]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Category</label>
            <div className="flex gap-1.5 flex-wrap">
              {ALL_EXERCISE_CATEGORIES.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCreateForm((f) => ({ ...f, category: k }))}
                  className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    createForm.category === k
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400'
                  }`}
                >
                  {EXERCISE_CATEGORY_LABELS[k]}
                </button>
              ))}
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-xs text-red-500">
              {(createMutation.error as Error)?.message || 'Failed to create exercise.'}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createForm.name.trim() || createMutation.isPending}
              className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            >
              {createMutation.isPending ? <Spinner /> : <Check className="h-4 w-4" />}
              {createMutation.isPending ? 'Creating…' : 'Create & Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
