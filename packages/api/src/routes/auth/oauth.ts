import type { FastifyInstance } from 'fastify';
import oauthPlugin from '@fastify/oauth2';
import { env } from '../../config/env.js';
import * as authService from '../../services/auth.service.js';

export default async function oauthRoutes(fastify: FastifyInstance) {
  // Only register if Google credentials are configured
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return;

  await fastify.register(oauthPlugin, {
    name: 'googleOAuth2',
    scope: ['openid', 'profile', 'email'],
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    startRedirectPath: '/auth/google',
    callbackUri: `${env.API_BASE_URL}/api/v1/auth/google/callback`,
    discovery: { issuer: 'https://accounts.google.com' },
  });

  fastify.get('/auth/google/callback', async (request, reply) => {
    const { token } = await (fastify as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

    // Fetch user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const userInfo = await userInfoRes.json() as { email: string; name?: string; picture?: string; id: string };

    const tokens = await authService.findOrCreateOAuthUser(
      fastify,
      userInfo.email,
      userInfo.name ?? null,
      userInfo.picture ?? null,
      userInfo.id,
      'GOOGLE',
    );

    // Redirect with a short-lived auth code (not raw tokens)
    const code = await authService.createAuthCode(fastify, tokens);
    reply.redirect(`${env.FRONTEND_URL}/oauth-callback?code=${code}`);
  });
}
