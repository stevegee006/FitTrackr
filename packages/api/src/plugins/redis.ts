import Redis from 'ioredis';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export default fp(async (fastify: FastifyInstance) => {
  const redis = new Redis(env.REDIS_URL);
  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    redis.disconnect();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}
