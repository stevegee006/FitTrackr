'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
interface ImportSummary {
  workoutsCreated: number;
  setsCreated: number;
  exercisesCreated: number;
  skipped: number;
}

export default function ImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (csv: string) =>
      apiFetch<{ data: ImportSummary }>('/workouts/import-csv', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      }),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    mutation.reset();
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target?.result as string);
    };
    reader.readAsText(file);
  }

  function handleImport() {
    if (!csvText) return;
    mutation.mutate(csvText);
  }

  const summary = mutation.data?.data;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Workouts</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Upload a CSV export from your previous fitness app
        </p>
      </div>

      <Card>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-10 text-center transition-colors hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/20"
        >
          <UploadCloud className="h-10 w-10 text-gray-400 dark:text-gray-500" />
          {fileName ? (
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{fileName}</span>
          ) : (
            <>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Click to select a CSV file
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Accepts .csv files
              </span>
            </>
          )}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />

        {csvText && !mutation.isSuccess && (
          <div className="mt-4">
            <Button
              className="w-full"
              onClick={handleImport}
              isLoading={mutation.isPending}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Importing…' : 'Import Workouts'}
            </Button>
          </div>
        )}

        {mutation.isError && (
          <p className="mt-4 rounded-lg bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {mutation.error instanceof Error ? mutation.error.message : 'Import failed. Please try again.'}
          </p>
        )}
      </Card>

      {mutation.isSuccess && summary && (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <UploadCloud className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">Import complete</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Imported {summary.workoutsCreated} workout{summary.workoutsCreated !== 1 ? 's' : ''},{' '}
                {summary.setsCreated} set{summary.setsCreated !== 1 ? 's' : ''} across{' '}
                {summary.exercisesCreated > 0
                  ? `${summary.exercisesCreated} new exercise${summary.exercisesCreated !== 1 ? 's' : ''}`
                  : 'existing exercises'}
              </p>
            </div>
          </div>

          {summary.skipped > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {summary.skipped} session{summary.skipped !== 1 ? 's' : ''} skipped (already imported)
            </p>
          )}

          <Link href="/workouts">
            <Button variant="outline" className="w-full">
              View Workouts
            </Button>
          </Link>
        </Card>
      )}
    </div>
  );
}
