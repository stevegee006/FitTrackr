import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import type { CreateSsoProviderInput, UpdateSsoProviderInput } from '@fittrackr/shared';
import { NotFoundError } from '../utils/errors.js';
import { encrypt, decrypt } from '../utils/encryption.js';

/**
 * Encrypt sensitive fields inside a config object.
 * For SAML: encrypts `cert`
 * For OIDC: encrypts `clientSecret`
 */
function encryptConfig(type: 'SAML' | 'OIDC', config: Record<string, unknown>): Record<string, unknown> {
  const encrypted = { ...config };
  if (type === 'SAML' && typeof encrypted.cert === 'string') {
    encrypted.cert = encrypt(encrypted.cert);
  }
  if (type === 'OIDC' && typeof encrypted.clientSecret === 'string') {
    encrypted.clientSecret = encrypt(encrypted.clientSecret);
  }
  return encrypted;
}

/**
 * Decrypt sensitive fields inside a config object.
 */
export function decryptConfig(type: 'SAML' | 'OIDC', config: Record<string, unknown>): Record<string, unknown> {
  const decrypted = { ...config };
  if (type === 'SAML' && typeof decrypted.cert === 'string') {
    decrypted.cert = decrypt(decrypted.cert);
  }
  if (type === 'OIDC' && typeof decrypted.clientSecret === 'string') {
    decrypted.clientSecret = decrypt(decrypted.clientSecret);
  }
  return decrypted;
}

export async function listSsoProviders(fastify: FastifyInstance) {
  return fastify.prisma.ssoProvider.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getSsoProvider(fastify: FastifyInstance, id: string) {
  const provider = await fastify.prisma.ssoProvider.findUnique({ where: { id } });
  if (!provider) throw new NotFoundError('SSO Provider');

  return {
    ...provider,
    config: decryptConfig(provider.type, provider.config as Record<string, unknown>),
  };
}

export async function createSsoProvider(fastify: FastifyInstance, input: CreateSsoProviderInput) {
  const encryptedConfig = encryptConfig(input.type, input.config as Record<string, unknown>);

  const provider = await fastify.prisma.ssoProvider.create({
    data: {
      name: input.name,
      type: input.type,
      enabled: input.enabled ?? false,
      config: encryptedConfig as unknown as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true,
      createdAt: true,
    },
  });

  return provider;
}

export async function updateSsoProvider(
  fastify: FastifyInstance,
  id: string,
  input: UpdateSsoProviderInput,
) {
  const existing = await fastify.prisma.ssoProvider.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('SSO Provider');

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.enabled !== undefined) updateData.enabled = input.enabled;
  if (input.type !== undefined) updateData.type = input.type;

  if (input.config !== undefined) {
    const type = input.type ?? existing.type;
    updateData.config = encryptConfig(type, input.config as Record<string, unknown>) as unknown as Prisma.InputJsonValue;
  }

  const provider = await fastify.prisma.ssoProvider.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true,
      createdAt: true,
    },
  });

  return provider;
}

export async function deleteSsoProvider(fastify: FastifyInstance, id: string) {
  const existing = await fastify.prisma.ssoProvider.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('SSO Provider');
  await fastify.prisma.ssoProvider.delete({ where: { id } });
}

export async function getEnabledProviders(fastify: FastifyInstance) {
  return fastify.prisma.ssoProvider.findMany({
    where: { enabled: true },
    select: { id: true, name: true, type: true },
  });
}
