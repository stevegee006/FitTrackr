'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_COLORS, TRAINING_GOAL_LABELS } from '@fittrackr/shared';
import type { TrainingGoal, MuscleGroup } from '@fittrackr/shared';
import { Sparkles, Target, CheckCircle } from 'lucide-react';

export default function TrainingGoalsPage() {
  const queryClient = useQueryClient();
  const [showGenerator, setShowGenerator] = useState(false);
  const [form, setForm] = useState({
    primaryGoal: 'HYPERTROPHY',
    weeklyFrequency: 4,
    experienceLevel: 'INTERMEDIATE',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['training-goals'],
    queryFn: () => apiFetch<{ data: TrainingGoal[] }>('/training-goals'),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch('/training-goals/generate', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-goals'] });
      setShowGenerator(false);
    },
  });

  const goals = data?.data ?? [];
  const active = goals.find((g) => g.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Training Goals</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Weekly volume targets per muscle group</p>
        </div>
        <Button onClick={() => setShowGenerator(true)} className="gap-1.5">
          <Sparkles className="h-4 w-4" />
          Generate
        </Button>
      </div>

      {showGenerator && (
        <Card className="space-y-4" data-tutorial="training-goal-generator">
          <h2 className="font-semibold">Generate Volume Targets</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Primary Goal</label>
              <select
                value={form.primaryGoal}
                onChange={(e) => setForm((f) => ({ ...f, primaryGoal: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {Object.entries(TRAINING_GOAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Days/week</label>
              <select
                value={form.weeklyFrequency}
                onChange={(e) => setForm((f) => ({ ...f, weeklyFrequency: parseInt(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Experience Level</label>
              <div className="flex gap-2">
                {['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, experienceLevel: level }))}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      form.experienceLevel === level
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {level.charAt(0) + level.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="flex-1 gap-2">
              {generateMutation.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {generateMutation.isPending ? 'Generating…' : 'Generate Targets'}
            </Button>
            <Button variant="outline" onClick={() => setShowGenerator(false)}>Cancel</Button>
          </div>
          {generateMutation.isError && (
            <p className="text-sm text-red-500">Failed to generate. Check your AI API key in Settings.</p>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : active ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/40 px-2 py-0.5 rounded-full font-medium">
              <CheckCircle className="h-3 w-3" /> Active
            </span>
            <span className="text-sm font-semibold">{TRAINING_GOAL_LABELS[active.primaryGoal]}</span>
            <span className="text-xs text-gray-500">· {active.weeklyFrequency}x/week</span>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 italic">{active.reasoning}</p>

          <div className="space-y-2">
            {Object.entries((active.volumeTargets as any)?.weeklySetTargets ?? {}).map(([muscle, target]) => {
              const m = muscle as MuscleGroup;
              return (
                <div key={muscle} className="flex items-center gap-3">
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: MUSCLE_GROUP_COLORS[m] }}
                  />
                  <span className="text-sm w-28 shrink-0">{MUSCLE_GROUP_LABELS[m]}</span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(((target as number) / 20) * 100, 100)}%`,
                        backgroundColor: MUSCLE_GROUP_COLORS[m],
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 shrink-0 w-16 text-right">{target} sets/wk</span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="py-10 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/50">
            <Target className="h-6 w-6 text-indigo-500" />
          </div>
          <p className="font-semibold text-gray-700 dark:text-gray-200">No volume targets yet</p>
          <p className="mt-1 text-sm text-gray-500">Generate AI-powered weekly set targets</p>
        </Card>
      )}
    </div>
  );
}
