'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { WORKOUT_TYPE_LABELS } from '@fittrackr/shared';
import type { Program, WorkoutType } from '@fittrackr/shared';
import { Sparkles, Calendar, Trash2, CheckCircle } from 'lucide-react';

const GOAL_LABELS: Record<string, string> = {
  STRENGTH: 'Build Strength',
  HYPERTROPHY: 'Build Muscle',
  ENDURANCE: 'Endurance',
  WEIGHT_LOSS: 'Lose Weight',
  GENERAL_FITNESS: 'General Fitness',
};

export default function ProgramsPage() {
  const queryClient = useQueryClient();
  const [showGenerator, setShowGenerator] = useState(false);
  const [form, setForm] = useState({
    durationWeeks: 8,
    workoutsPerWeek: 4,
    primaryGoal: 'HYPERTROPHY',
    experienceLevel: 'INTERMEDIATE',
    availableEquipment: [] as string[],
    preferences: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['programs'],
    queryFn: () => apiFetch<{ data: Program[] }>('/programs'),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch('/programs/generate', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['programs'] });
      setShowGenerator(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/programs/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs'] }),
  });

  const programs = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Programs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">AI-generated training programs</p>
        </div>
        <Button onClick={() => setShowGenerator(true)} className="gap-1.5">
          <Sparkles className="h-4 w-4" />
          Generate
        </Button>
      </div>

      {showGenerator && (
        <Card className="space-y-4" data-tutorial="program-generator">
          <h2 className="font-semibold">Generate New Program</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Goal</label>
              <select
                value={form.primaryGoal}
                onChange={(e) => setForm((f) => ({ ...f, primaryGoal: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {Object.entries(GOAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Experience</label>
              <select
                value={form.experienceLevel}
                onChange={(e) => setForm((f) => ({ ...f, experienceLevel: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                <option value="BEGINNER">Beginner</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="ADVANCED">Advanced</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Duration</label>
              <select
                value={form.durationWeeks}
                onChange={(e) => setForm((f) => ({ ...f, durationWeeks: parseInt(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {[4, 6, 8, 10, 12, 16].map((w) => <option key={w} value={w}>{w} weeks</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Days/week</label>
              <select
                value={form.workoutsPerWeek}
                onChange={(e) => setForm((f) => ({ ...f, workoutsPerWeek: parseInt(e.target.value) }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
              >
                {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
          </div>
          <textarea
            value={form.preferences}
            onChange={(e) => setForm((f) => ({ ...f, preferences: e.target.value }))}
            placeholder="Any preferences or injuries to note? (optional)"
            rows={2}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="flex-1 gap-2">
              {generateMutation.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
              {generateMutation.isPending ? 'Generating…' : 'Generate Program'}
            </Button>
            <Button variant="outline" onClick={() => setShowGenerator(false)}>Cancel</Button>
          </div>
          {generateMutation.isError && (
            <p className="text-sm text-red-500">
              {(generateMutation.error as Error)?.message || 'Failed to generate. Check your AI API key in Settings.'}
            </p>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : programs.length === 0 ? (
        <Card className="py-10 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-800/50">
            <Calendar className="h-6 w-6 text-indigo-500" />
          </div>
          <p className="font-semibold text-gray-700 dark:text-gray-200">No programs yet</p>
          <p className="mt-1 text-sm text-gray-500">Generate a personalized program with AI</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {programs.map((p) => (
            <Card key={p.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{p.name}</p>
                    {p.isActive && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800/40 px-1.5 py-0.5 rounded-full font-medium">
                        <CheckCircle className="h-2.5 w-2.5" /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{p.durationWeeks} weeks · {p.aiModel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { if (confirm('Delete this program?')) deleteMutation.mutate(p.id); }}
                  className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Week preview */}
              {(p.programData as any)?.weeks?.[0]?.days && (
                <div className="grid grid-cols-7 gap-1">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => {
                    const dayData = (p.programData as any).weeks[0].days.find(
                      (d: any) => d.dayOfWeek === i + 1,
                    );
                    return (
                      <div
                        key={i}
                        className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg text-center ${
                          dayData
                            ? 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-800/30'
                            : 'bg-gray-50 dark:bg-gray-800/50'
                        }`}
                      >
                        <span className="text-[9px] font-medium text-gray-500">{day}</span>
                        {dayData && (
                          <span className="text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 leading-tight">
                            {(dayData.workoutType as string).slice(0, 3)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
