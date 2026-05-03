import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export default fp(async (fastify: FastifyInstance) => {
  fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256', expiresIn: '15m' },
    verify: { algorithms: ['HS256'] },
  });

  fastify.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; isAdmin: boolean };
    user: { sub: string; email: string; isAdmin: boolean };
  }
}
