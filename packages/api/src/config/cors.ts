import type { FastifyCorsOptions } from '@fastify/cors';
import { env } from './env.js';

export const corsOptions: FastifyCorsOptions = {
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return cb(null, true);
    // Allow the configured frontend URL
    if (origin === env.FRONTEND_URL) return cb(null, true);
    // Allow any subdomain of the same base domain
    try {
      const frontendHost = new URL(env.FRONTEND_URL).hostname;
      const requestHost = new URL(origin).hostname;
      // e.g. both end with .geehive.com
      const baseDomain = frontendHost.split('.').slice(-2).join('.');
      if (requestHost.endsWith(baseDomain)) return cb(null, true);
    } catch {
      // invalid URL, reject
    }
    cb(new Error('Not allowed by CORS'), false);
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
