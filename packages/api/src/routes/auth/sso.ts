import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { Issuer } from 'openid-client';
import { SAML } from '@node-saml/node-saml';
import { env } from '../../config/env.js';
import * as authService from '../../services/auth.service.js';
import { getSsoProvider, decryptConfig } from '../../services/sso.service.js';
import { NotFoundError, AppError } from '../../utils/errors.js';

const SSO_STATE_TTL = 300; // 5 minutes

/**
 * Build an OIDC Issuer. If explicit endpoints are provided in config,
 * construct the Issuer manually; otherwise auto-discover from issuerUrl.
 */
async function resolveOidcIssuer(config: Record<string, unknown>): Promise<InstanceType<typeof Issuer>> {
  const issuerUrl = config.issuerUrl as string;
  const authEndpoint = config.authorizationEndpoint as string | undefined;
  const tokenEndpoint = config.tokenEndpoint as string | undefined;
  const userinfoEndpoint = config.userinfoEndpoint as string | undefined;

  if (authEndpoint && tokenEndpoint) {
    // Manual construction — skip discovery
    return new Issuer({
      issuer: issuerUrl,
      authorization_endpoint: authEndpoint,
      token_endpoint: tokenEndpoint,
      userinfo_endpoint: userinfoEndpoint,
    });
  }

  // Auto-discover via .well-known/openid-configuration
  return Issuer.discover(issuerUrl);
}

export default async function ssoRoutes(fastify: FastifyInstance) {
  // Initiate SSO login
  fastify.get('/auth/sso/:providerId', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    const provider = await getSsoProvider(fastify, providerId);
    if (!provider.enabled) {
      throw new NotFoundError('SSO Provider');
    }

    const config = provider.config as Record<string, unknown>;

    if (provider.type === 'OIDC') {
      const issuer = await resolveOidcIssuer(config);
      const callbackUrl = config.callbackUrl as string || `${env.API_BASE_URL}/api/v1/auth/sso/${providerId}/callback`;
      const client = new issuer.Client({
        client_id: config.clientId as string,
        client_secret: config.clientSecret as string,
        redirect_uris: [callbackUrl],
        response_types: ['code'],
      });

      const state = crypto.randomBytes(32).toString('hex');
      const nonce = crypto.randomBytes(32).toString('hex');

      // Store state and nonce in Redis for validation
      await fastify.redis.set(
        `sso:state:${state}`,
        JSON.stringify({ providerId, nonce }),
        'EX',
        SSO_STATE_TTL,
      );

      const scopes = (config.scopes as string[] | undefined) ?? ['openid', 'profile', 'email'];
      const authUrl = client.authorizationUrl({
        scope: scopes.join(' '),
        state,
        nonce,
      });

      reply.redirect(authUrl);
    } else if (provider.type === 'SAML') {
      const saml = new SAML({
        entryPoint: config.entryPoint as string,
        issuer: config.issuer as string,
        idpCert: config.cert as string,
        callbackUrl: config.callbackUrl as string || `${env.API_BASE_URL}/api/v1/auth/sso/${providerId}/callback`,
      });

      const authorizeUrl = await saml.getAuthorizeUrlAsync('', request.hostname, {});
      reply.redirect(authorizeUrl);
    }
  });

  // OIDC callback (GET)
  fastify.get('/auth/sso/:providerId/callback', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const query = request.query as Record<string, string>;

    const provider = await getSsoProvider(fastify, providerId);
    if (provider.type !== 'OIDC') {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid callback type for this provider');
    }

    const config = provider.config as Record<string, unknown>;

    // Validate state
    const stateData = await fastify.redis.get(`sso:state:${query.state}`);
    if (!stateData) {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid or expired SSO state');
    }
    await fastify.redis.del(`sso:state:${query.state}`);

    const { nonce } = JSON.parse(stateData);

    const issuer = await resolveOidcIssuer(config);
    const callbackUrl = config.callbackUrl as string || `${env.API_BASE_URL}/api/v1/auth/sso/${providerId}/callback`;
    const client = new issuer.Client({
      client_id: config.clientId as string,
      client_secret: config.clientSecret as string,
      redirect_uris: [callbackUrl],
      response_types: ['code'],
    });

    const tokenSet = await client.callback(callbackUrl, { code: query.code, state: query.state }, { state: query.state, nonce });
    const claims = tokenSet.claims();

    const email = claims.email as string;
    if (!email) {
      throw new AppError(400, 'BAD_REQUEST', 'No email claim in ID token');
    }

    const tokens = await authService.findOrCreateOAuthUser(
      fastify,
      email,
      (claims.name as string) ?? null,
      (claims.picture as string) ?? null,
      claims.sub,
      'OIDC',
    );

    const code = await authService.createAuthCode(fastify, tokens);
    reply.redirect(`${env.FRONTEND_URL}/oauth-callback?code=${code}`);
  });

  // SAML callback (POST)
  fastify.post('/auth/sso/:providerId/callback', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };

    const provider = await getSsoProvider(fastify, providerId);
    if (provider.type !== 'SAML') {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid callback type for this provider');
    }

    const config = provider.config as Record<string, unknown>;
    const saml = new SAML({
      entryPoint: config.entryPoint as string,
      issuer: config.issuer as string,
      idpCert: config.cert as string,
      callbackUrl: config.callbackUrl as string || `${env.API_BASE_URL}/api/v1/auth/sso/${providerId}/callback`,
    });

    const body = request.body as Record<string, string>;
    const { profile } = await saml.validatePostResponseAsync(body);

    if (!profile) {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid SAML assertion');
    }

    const email = profile.nameID || (profile as any).email;
    if (!email) {
      throw new AppError(400, 'BAD_REQUEST', 'No email in SAML assertion');
    }

    const displayName =
      (profile as any).displayName ??
      (profile as any).firstName
        ? `${(profile as any).firstName} ${(profile as any).lastName ?? ''}`.trim()
        : null;

    const tokens = await authService.findOrCreateOAuthUser(
      fastify,
      email,
      displayName,
      null,
      profile.nameID || email,
      'SAML',
    );

    const code = await authService.createAuthCode(fastify, tokens);
    reply.redirect(`${env.FRONTEND_URL}/oauth-callback?code=${code}`);
  });
}
