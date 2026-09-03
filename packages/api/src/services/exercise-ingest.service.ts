import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  parsedExerciseSchema,
  muscleGroupValues, equipmentValues, exerciseCategoryValues,
} from '@fittrackr/shared';
import { aiVisionCompletion, aiPdfCompletion } from './ai-provider.service.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are a fitness data extraction expert. Extract every exercise from the provided document or image into a structured JSON array.

For each exercise return:
- name: string (full exercise name)
- category: one of ${exerciseCategoryValues.join(', ')}
- primaryMuscle: one of ${muscleGroupValues.join(', ')}
- secondaryMuscles: array of the same muscle group values (can be empty)
- equipment: one of ${equipmentValues.join(', ')}
- instructions: string with execution cues, or null

Return a JSON array directly (no wrapper). Maximum 200 items.`;

const responseSchema = z.array(parsedExerciseSchema);

function repairTruncatedArray(text: string): string | null {
  const startIdx = text.indexOf('[');
  if (startIdx === -1) return null;
  let depth = 0, inString = false, escapeNext = false, lastObjectEnd = -1;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (ch === '}' && depth === 1) lastObjectEnd = i;
    }
  }
  if (lastObjectEnd === -1) return null;
  return text.slice(startIdx, lastObjectEnd + 1) + ']';
}

function parseAiResponse(content: string) {
  for (const attempt of [
    () => JSON.parse(content),
    () => { const m = content.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); throw new Error(); },
    () => { const r = repairTruncatedArray(content); if (r) return JSON.parse(r); throw new Error(); },
  ]) {
    try {
      let parsed = attempt();
      if (parsed && !Array.isArray(parsed) && 'items' in parsed) parsed = parsed.items;
      const result = responseSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch { /* try next */ }
  }
  throw new AppError(502, 'AI_PARSE_ERROR', 'AI did not return valid exercise data.');
}

export async function parsePdfIngest(fastify: FastifyInstance, userId: string, pdfBase64: string) {
  const result = await aiPdfCompletion(fastify, userId, SYSTEM_PROMPT, 'Extract every exercise from this document.', pdfBase64);
  return parseAiResponse(result.content);
}

export async function parseImagesIngest(fastify: FastifyInstance, userId: string, imagesBase64: string[]) {
  const results = await Promise.all(
    imagesBase64.map((img) => aiVisionCompletion(fastify, userId, SYSTEM_PROMPT, 'Extract every exercise from this image.', img, { maxTokens: 4000 })),
  );
  const merged: any[] = [];
  for (const r of results) {
    try { merged.push(...parseAiResponse(r.content)); } catch { /* skip */ }
  }
  if (merged.length === 0) throw new AppError(502, 'AI_PARSE_ERROR', 'AI could not extract any exercises.');
  return merged;
}

export async function bulkImportExercises(fastify: FastifyInstance, items: any[]) {
  let created = 0, skipped = 0;
  for (const item of items) {
    const existing = await fastify.prisma.exercise.findFirst({
      where: { name: { equals: item.name, mode: 'insensitive' } },
    });
    if (existing) { skipped++; continue; }
    await fastify.prisma.exercise.create({
      data: {
        name: item.name,
        category: item.category,
        primaryMuscle: item.primaryMuscle,
        secondaryMuscles: item.secondaryMuscles ?? [],
        equipment: item.equipment ?? 'BODYWEIGHT',
        instructions: item.instructions ?? null,
        source: 'AI_INGEST',
        isCustom: false,
      },
    });
    created++;
  }
  return { created, skipped };
}
