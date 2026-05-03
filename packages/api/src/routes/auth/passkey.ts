import type { FastifyInstance } from 'fastify';
import * as passkeyService from '../../services/passkey.service.js';
import * as authService from '../../services/auth.service.js';
import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';

const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

/**
 * Extract the client origin from the request's Origin or Referer header,
 * falling back to FRONTEND_URL. This ensures the rpID matches how the
 * user actually accessed the app (IP, domain, localhost, etc.)
 */
function getClientOrigin(request: { headers: Record<string, string | string[] | undefined> }): string {
  const origin = request.headers['origin'];
  if (origin && typeof origin === 'string') return origin;

  const referer = request.headers['referer'];
  if (referer && typeof referer === 'string') {
    try {
      const url = new URL(referer);
      return url.origin;
    } catch { /* ignore */ }
  }

  return env.FRONTEND_URL;
}

export default async function passkeyRoutes(fastify: FastifyInstance) {
  // ── Registration (authenticated users adding a passkey) ──

  fastify.post('/auth/passkey/register/options', async (request, reply) => {
    try {
      await fastify.authenticate(request, reply);
      if (reply.sent) return; // Auth failed, 401 already sent
      const clientOrigin = getClientOrigin(request);
      request.log.info({ clientOrigin, userId: request.user.sub }, 'passkey register/options');
      const options = await passkeyService.generateRegOptions(fastify, request.user.sub, clientOrigin);
      return reply.send({ data: options });
    } catch (err: any) {
      request.log.error({ err, message: err.message, stack: err.stack, name: err.name }, 'passkey register/options failed');
      if (reply.sent) return;
      return reply.code(err.statusCode || 500).send({
        error: {
          code: err.code || 'PASSKEY_ERROR',
          message: err.message || 'Passkey registration options failed',
        },
      });
    }
  });

  fastify.post('/auth/passkey/register/verify', async (request, reply) => {
    try {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
      const { response, friendlyName } = request.body as {
        response: any;
        friendlyName?: string;
      };
      request.log.info({ userId: request.user.sub }, 'passkey register/verify');
      const result = await passkeyService.verifyRegistration(
        fastify,
        request.user.sub,
        response,
        friendlyName,
      );
      return reply.send({ data: result });
    } catch (err: any) {
      request.log.error({ err, message: err.message, stack: err.stack }, 'passkey register/verify failed');
      if (reply.sent) return;
      return reply.code(err.statusCode || 500).send({
        error: {
          code: err.code || 'PASSKEY_ERROR',
          message: err.message || 'Passkey verification failed',
        },
      });
    }
  });

  // ── Authentication (login with passkey) ──

  fastify.post('/auth/passkey/authenticate/options', { ...authRateLimit }, async (request, reply) => {
    try {
      const { email } = (request.body as { email?: string }) || {};
      const clientOrigin = getClientOrigin(request);
      const options = await passkeyService.generateAuthOptions(fastify, clientOrigin, email);
      return reply.send({ data: options });
    } catch (err: any) {
      request.log.error({ err, message: err.message, stack: err.stack }, 'passkey authenticate/options failed');
      if (reply.sent) return;
      return reply.code(err.statusCode || 500).send({
        error: {
          code: err.code || 'PASSKEY_ERROR',
          message: err.message || 'Passkey auth options failed',
        },
      });
    }
  });

  fastify.post('/auth/passkey/authenticate/verify', { ...authRateLimit }, async (request, reply) => {
    try {
      const { response, challenge } = request.body as {
        response: any;
        challenge: string;
      };
      const user = await passkeyService.verifyAuthentication(fastify, response, challenge);
      const tokens = await authService.generateTokensForPasskey(fastify, user.id, user.email, user.isAdmin);
      return reply.send({ data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken } });
    } catch (err: any) {
      request.log.error({ err, message: err.message, stack: err.stack }, 'passkey authenticate/verify failed');
      if (reply.sent) return;
      return reply.code(err.statusCode || 500).send({
        error: {
          code: err.code || 'PASSKEY_ERROR',
          message: err.message || 'Passkey authentication failed',
        },
      });
    }
  });

  // ── Management (list / delete passkeys) ──

  fastify.get('/auth/passkey/list', async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    const passkeys = await passkeyService.listPasskeys(fastify, request.user.sub);
    reply.send({ data: passkeys });
  });

  fastify.delete('/auth/passkey/:id', async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    const { id } = request.params as { id: string };
    await passkeyService.deletePasskey(fastify, request.user.sub, id);
    reply.send({ data: { success: true } });
  });
}
