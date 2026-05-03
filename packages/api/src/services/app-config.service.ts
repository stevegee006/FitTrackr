import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

const DEFAULTS: Record<string, string> = {
  signups_enabled: 'true',
};

export async function getConfig(fastify: FastifyInstance, key: string): Promise<string> {
  const row = await fastify.prisma.appConfig.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? '';
}

export async function setConfig(fastify: FastifyInstance, key: string, value: string): Promise<void> {
  await fastify.prisma.appConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/** Returns the USDA API key — prefers DB config, falls back to env var */
export async function getUsdaApiKey(fastify: FastifyInstance): Promise<string | undefined> {
  const dbKey = await getConfig(fastify, 'usda_fdc_api_key');
  if (dbKey) return dbKey;
  return env.USDA_FDC_API_KEY || undefined;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export async function getAppSettings(fastify: FastifyInstance) {
  const signupsEnabled = await getConfig(fastify, 'signups_enabled');
  const usdaKey = await getUsdaApiKey(fastify);
  return {
    signupsEnabled: signupsEnabled !== 'false',
    usdaApiKeySet: !!usdaKey,
    usdaApiKeyMasked: usdaKey ? maskApiKey(usdaKey) : null,
  };
}

export async function updateAppSettings(
  fastify: FastifyInstance,
  settings: { signupsEnabled?: boolean; usdaApiKey?: string },
) {
  if (settings.signupsEnabled !== undefined) {
    await setConfig(fastify, 'signups_enabled', String(settings.signupsEnabled));
  }
  if (settings.usdaApiKey !== undefined) {
    await setConfig(fastify, 'usda_fdc_api_key', settings.usdaApiKey);
  }
  return getAppSettings(fastify);
}
