import type { FastifyInstance } from 'fastify';
import type { Exercise } from '@fittrackr/shared';
import { logger } from '../utils/logger.js';

const WGER_BASE = 'https://wger.de/api/v2';
const CACHE_TTL = 86400; // 24h

const CATEGORY_MAP: Record<number, string> = {
  8: 'ARMS', 10: 'BACK', 11: 'CALVES', 12: 'CHEST',
  13: 'CORE', 14: 'LEGS', 15: 'SHOULDERS',
};

const MUSCLE_MAP: Record<number, string> = {
  1: 'BICEPS', 2: 'SHOULDERS', 3: 'BACK', 4: 'CHEST',
  5: 'HAMSTRINGS', 6: 'QUADS', 7: 'CALVES',
  8: 'CORE', 9: 'GLUTES', 10: 'TRICEPS', 11: 'FOREARMS',
};

function mapMuscle(id: number): string {
  return MUSCLE_MAP[id] ?? 'FULL_BODY';
}

interface WgerExercise {
  id: number;
  name: string;
  category: { id: number; name: string };
  muscles: { id: number }[];
  muscles_secondary: { id: number }[];
  equipment: { id: number; name: string }[];
  description: string;
}

export async function searchWger(
  fastify: FastifyInstance,
  term: string,
  language = 2, // English
): Promise<Partial<Exercise>[]> {
  const cacheKey = `wger:search:v1:${term.toLowerCase().trim()}`;

  try {
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* cache miss */ }

  try {
    const url = `${WGER_BASE}/exercise/search/?term=${encodeURIComponent(term)}&language=${language}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Wger returned ${res.status}`);
    const data: any = await res.json();

    const suggestions: Partial<Exercise>[] = (data.suggestions ?? []).map((s: any) => ({
      name: s.value ?? s.data?.name,
      source: 'WGER' as const,
    }));

    await fastify.redis.set(cacheKey, JSON.stringify(suggestions), 'EX', CACHE_TTL);
    return suggestions;
  } catch (err) {
    logger.warn({ err, term }, 'Wger search failed');
    return [];
  }
}

export async function getWgerExercise(
  fastify: FastifyInstance,
  wgerId: number,
): Promise<Partial<Exercise> | null> {
  const cacheKey = `wger:exercise:v1:${wgerId}`;

  try {
    const cached = await fastify.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* cache miss */ }

  try {
    const url = `${WGER_BASE}/exerciseinfo/${wgerId}/?format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const ex: WgerExercise = await res.json();

    const translations = (ex as any).translations ?? [];
    const eng = translations.find((t: any) => t.language === language) ?? translations[0];
    const name: string = eng?.name ?? ex.name ?? 'Unknown Exercise';
    const instructions: string | null = eng?.description
      ? eng.description.replace(/<[^>]*>/g, '').trim() || null
      : null;

    const primaryMuscleId = ex.muscles?.[0]?.id;
    const primaryMuscle = primaryMuscleId ? mapMuscle(primaryMuscleId) : 'FULL_BODY';
    const secondaryMuscles = (ex.muscles_secondary ?? []).map((m) => mapMuscle(m.id));

    const result: Partial<Exercise> = {
      name,
      primaryMuscle: primaryMuscle as any,
      secondaryMuscles: secondaryMuscles as any,
      instructions,
      source: 'WGER',
    };

    await fastify.redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL);
    return result;
  } catch (err) {
    logger.warn({ err, wgerId }, 'Wger exercise fetch failed');
    return null;
  }
}
