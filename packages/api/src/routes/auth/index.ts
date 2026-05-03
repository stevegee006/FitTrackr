import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema, changePasswordSchema } from '@fittrackr/shared';
import * as authService from '../../services/auth.service.js';
import * as appConfigService from '../../services/app-config.service.js';
import { AppError, ForbiddenError } from '../../utils/errors.js';
import { env } from '../../config/env.js';

const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export default async function authRoutes(fastify: FastifyInstance) {
  // Public endpoint - no auth required
  fastify.get('/auth/providers', async () => {
    const providers: string[] = ['LOCAL'];
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      providers.push('GOOGLE');
    }
    const ssoProviders = await fastify.prisma.ssoProvider.findMany({
      where: { enabled: true },
      select: { id: true, name: true, type: true },
    });
    // Check if any passkeys exist in the system (passkey login available)
    const passkeyCount = await fastify.prisma.passkey.count();
    if (passkeyCount > 0) {
      providers.push('PASSKEY');
    }
    const { signupsEnabled } = await appConfigService.getAppSettings(fastify);
    return { data: { providers, sso: ssoProviders, signupsEnabled } };
  });

  fastify.post('/auth/register', { ...authRateLimit }, async (request, reply) => {
    const body = registerSchema.parse(request.body);

    // Check if signups are enabled (always allow first user = admin setup)
    const userCount = await fastify.prisma.user.count();
    if (userCount > 0) {
      const { signupsEnabled } = await appConfigService.getAppSettings(fastify);
      if (!signupsEnabled) {
        throw new ForbiddenError('Registration is currently disabled. Contact your administrator.');
      }
    }

    const tokens = await authService.registerUser(fastify, body.email, body.password, body.displayName);
    reply.send({ data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } });
  });

  fastify.post('/auth/login', { ...authRateLimit }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.loginUser(fastify, body.email, body.password, body.rememberMe);
    reply.send({
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        mustChangePassword: result.mustChangePassword,
      },
    });
  });

  fastify.post('/auth/refresh', async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    const refreshToken = body?.refreshToken;
    if (!refreshToken) {
      throw new AppError(401, 'UNAUTHORIZED', 'No refresh token provided');
    }
    const tokens = await authService.refreshTokens(fastify, refreshToken);
    reply.send({ data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } });
  });

  fastify.post('/auth/exchange-code', async (request, reply) => {
    const body = request.body as { code?: string };
    if (!body?.code || typeof body.code !== 'string') {
      throw new AppError(400, 'BAD_REQUEST', 'Authorization code is required');
    }
    const tokens = await authService.exchangeAuthCode(fastify, body.code);
    reply.send({ data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } });
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    const refreshToken = body?.refreshToken;
    if (refreshToken) {
      await authService.logoutUser(fastify, refreshToken);
    }
    reply.send({ data: { success: true } });
  });

  fastify.post('/auth/change-password', { ...authRateLimit }, async (request, reply) => {
    await fastify.authenticate(request, reply);
    const body = changePasswordSchema.parse(request.body);
    await authService.changePassword(fastify, request.user.sub, body.currentPassword, body.newPassword);
    reply.send({ data: { success: true } });
  });
}
