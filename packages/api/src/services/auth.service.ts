import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ConflictError, UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { getAppSettings } from './app-config.service.js';
import { env } from '../config/env.js';

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const REFRESH_TOKEN_TTL_REMEMBER = 30 * 24 * 60 * 60; // 30 days in seconds

export async function registerUser(
  fastify: FastifyInstance,
  email: string,
  password: string,
  displayName?: string,
) {
  const existing = await fastify.prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }

  // First user becomes admin
  const userCount = await fastify.prisma.user.count();
  const isAdmin = userCount === 0;

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await fastify.prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: displayName ?? null,
      authProvider: 'LOCAL',
      isAdmin,
      profile: { create: {} },
      settings: { create: {} },
    },
    select: { id: true, email: true, displayName: true, isAdmin: true },
  });

  return generateTokens(fastify, user.id, user.email, user.isAdmin);
}

export async function loginUser(fastify: FastifyInstance, email: string, password: string, rememberMe?: boolean) {
  const user = await fastify.prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, authProvider: true, isAdmin: true, mustChangePassword: true },
  });

  if (!user || user.authProvider !== 'LOCAL' || !user.passwordHash) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Retroactive admin promotion: if no admins exist, promote the first-created user
  let { isAdmin } = user;
  if (!isAdmin) {
    const adminExists = await fastify.prisma.user.findFirst({ where: { isAdmin: true } });
    if (!adminExists) {
      const firstUser = await fastify.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
      if (firstUser && firstUser.id === user.id) {
        await fastify.prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
        isAdmin = true;
      }
    }
  }

  const tokens = await generateTokens(fastify, user.id, user.email, isAdmin, rememberMe);
  return { ...tokens, mustChangePassword: user.mustChangePassword ?? false };
}

export async function changePassword(
  fastify: FastifyInstance,
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, authProvider: true },
  });

  if (!user || user.authProvider !== 'LOCAL' || !user.passwordHash) {
    throw new UnauthorizedError('Cannot change password for this account');
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await fastify.prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });
}

export async function refreshTokens(fastify: FastifyInstance, refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  const userId = await fastify.redis.get(`refresh:${tokenHash}`);
  if (!userId) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Rotate: delete old token
  await fastify.redis.del(`refresh:${tokenHash}`);

  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isAdmin: true },
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Retroactive admin promotion on token refresh
  let { isAdmin } = user;
  if (!isAdmin) {
    const adminExists = await fastify.prisma.user.findFirst({ where: { isAdmin: true } });
    if (!adminExists) {
      const firstUser = await fastify.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
      if (firstUser && firstUser.id === user.id) {
        await fastify.prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
        isAdmin = true;
      }
    }
  }

  return generateTokens(fastify, user.id, user.email, isAdmin);
}

export async function logoutUser(fastify: FastifyInstance, refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await fastify.redis.del(`refresh:${tokenHash}`);
}

export async function findOrCreateOAuthUser(
  fastify: FastifyInstance,
  email: string,
  displayName: string | null,
  avatarUrl: string | null,
  oauthProviderId: string,
  authProvider: 'GOOGLE' | 'GITHUB' | 'SAML' | 'OIDC' = 'GOOGLE',
) {
  let user = await fastify.prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isAdmin: true },
  });

  if (!user) {
    // First user becomes admin
    const userCount = await fastify.prisma.user.count();
    const isAdmin = userCount === 0;

    // Guard: if signups are disabled and users exist, reject new registrations
    // SSO (SAML/OIDC) users bypass this check — they are authenticated by a trusted identity provider
    if (!isAdmin && authProvider !== 'SAML' && authProvider !== 'OIDC') {
      const { signupsEnabled } = await getAppSettings(fastify);
      if (!signupsEnabled) {
        throw new ForbiddenError('Registration is currently disabled. Contact your administrator.');
      }
    }

    user = await fastify.prisma.user.create({
      data: {
        email,
        displayName,
        avatarUrl,
        authProvider,
        oauthProviderId,
        isAdmin,
        profile: { create: {} },
        settings: { create: {} },
      },
      select: { id: true, email: true, isAdmin: true },
    });
  }

  return generateTokens(fastify, user.id, user.email, user.isAdmin);
}

export async function generateTokensForPasskey(fastify: FastifyInstance, userId: string, email: string, isAdmin: boolean) {
  return generateTokens(fastify, userId, email, isAdmin);
}

async function generateTokens(fastify: FastifyInstance, userId: string, email: string, isAdmin: boolean, rememberMe?: boolean) {
  const accessToken = fastify.jwt.sign({ sub: userId, email, isAdmin });

  const ttl = rememberMe ? REFRESH_TOKEN_TTL_REMEMBER : REFRESH_TOKEN_TTL;
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(refreshToken);
  await fastify.redis.set(`refresh:${tokenHash}`, userId, 'EX', ttl);

  return { accessToken, refreshToken };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const AUTH_CODE_TTL = 60; // 1 minute

export async function createAuthCode(fastify: FastifyInstance, tokens: { accessToken: string; refreshToken: string }): Promise<string> {
  const code = crypto.randomBytes(32).toString('hex');
  await fastify.redis.set(`authcode:${code}`, JSON.stringify(tokens), 'EX', AUTH_CODE_TTL);
  return code;
}

export async function exchangeAuthCode(fastify: FastifyInstance, code: string) {
  const key = `authcode:${code}`;
  const data = await fastify.redis.get(key);
  if (!data) {
    throw new UnauthorizedError('Invalid or expired authorization code');
  }
  await fastify.redis.del(key);
  return JSON.parse(data) as { accessToken: string; refreshToken: string };
}
