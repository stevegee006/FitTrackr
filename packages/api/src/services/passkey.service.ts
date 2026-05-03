import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { AppError, UnauthorizedError } from '../utils/errors.js';

const CHALLENGE_TTL = 300; // 5 minutes

type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

/**
 * Derive rpID and origin from the client's Origin or Referer header.
 * Uses the registrable domain (eTLD+1) as rpID so passkeys work across
 * subdomains and on iOS Safari which is strict about rpID matching.
 *
 * Examples:
 *   macros.geehive.com  → rpID = geehive.com
 *   localhost            → rpID = localhost
 *   192.168.1.50         → rpID = 192.168.1.50
 */
function getRegistrableDomain(hostname: string): string {
  // IP addresses and localhost: use as-is
  if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) {
    return hostname;
  }
  // For domain names with 3+ labels, use the last 2 (eTLD+1 for standard TLDs)
  const parts = hostname.split('.');
  if (parts.length > 2) {
    return parts.slice(-2).join('.');
  }
  return hostname;
}

function getRpConfigFromOrigin(origin: string) {
  const url = new URL(origin);
  return {
    rpName: 'FitTrackr',
    rpID: getRegistrableDomain(url.hostname),
    origin: url.origin,
  };
}

/**
 * Generate registration options for an authenticated user adding a passkey
 */
export async function generateRegOptions(fastify: FastifyInstance, userId: string, clientOrigin: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, passkeys: true },
  });

  if (!user) throw new UnauthorizedError('User not found');

  const { rpName, rpID } = getRpConfigFromOrigin(clientOrigin);

  const existingCredentials = user.passkeys.map((pk) => ({
    id: pk.credentialId,
    transports: pk.transports as AuthenticatorTransport[],
  }));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.displayName || user.email,
    excludeCredentials: existingCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    attestationType: 'none',
  });

  // Store challenge + origin in Redis so verify can use the same rpID/origin
  await fastify.redis.set(
    `webauthn:reg:${userId}`,
    JSON.stringify({ challenge: options.challenge, origin: clientOrigin }),
    'EX',
    CHALLENGE_TTL,
  );

  return options;
}

/**
 * Verify registration and store the new passkey
 */
export async function verifyRegistration(
  fastify: FastifyInstance,
  userId: string,
  response: RegistrationResponseJSON,
  friendlyName?: string,
) {
  const stored = await fastify.redis.get(`webauthn:reg:${userId}`);
  if (!stored) throw new AppError(400, 'BAD_REQUEST', 'Registration challenge expired');

  const { challenge, origin: storedOrigin } = JSON.parse(stored);
  const { rpID, origin } = getRpConfigFromOrigin(storedOrigin);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(400, 'BAD_REQUEST', 'Passkey registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Store the passkey
  await fastify.prisma.passkey.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: BigInt(credential.counter),
      transports: (response.response.transports ?? []) as string[],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      friendlyName: friendlyName || null,
    },
  });

  // Clean up challenge
  await fastify.redis.del(`webauthn:reg:${userId}`);

  return { verified: true };
}

/**
 * Generate authentication options (for login — no user ID needed yet)
 */
export async function generateAuthOptions(fastify: FastifyInstance, clientOrigin: string, email?: string) {
  const { rpID } = getRpConfigFromOrigin(clientOrigin);

  let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;

  // If email is provided, scope to that user's passkeys
  if (email) {
    const user = await fastify.prisma.user.findUnique({
      where: { email },
      select: { passkeys: true },
    });

    if (user && user.passkeys.length > 0) {
      allowCredentials = user.passkeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransport[],
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  // Store challenge + origin keyed by the challenge itself
  await fastify.redis.set(
    `webauthn:auth:${options.challenge}`,
    JSON.stringify({ origin: clientOrigin }),
    'EX',
    CHALLENGE_TTL,
  );

  return options;
}

/**
 * Verify authentication response and return tokens
 */
export async function verifyAuthentication(
  fastify: FastifyInstance,
  response: AuthenticationResponseJSON,
  challenge: string,
) {
  // Validate challenge exists
  const stored = await fastify.redis.get(`webauthn:auth:${challenge}`);
  if (!stored) throw new UnauthorizedError('Authentication challenge expired');

  const { origin: storedOrigin } = JSON.parse(stored);
  const { rpID, origin } = getRpConfigFromOrigin(storedOrigin);

  // Look up the passkey by credential ID
  const passkey = await fastify.prisma.passkey.findUnique({
    where: { credentialId: response.id },
    include: { user: { select: { id: true, email: true, isAdmin: true } } },
  });

  if (!passkey) throw new UnauthorizedError('Passkey not recognized');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: Number(passkey.counter),
      transports: passkey.transports as AuthenticatorTransport[],
    },
  });

  if (!verification.verified) {
    throw new UnauthorizedError('Passkey authentication failed');
  }

  // Update counter and last used
  await fastify.prisma.passkey.update({
    where: { id: passkey.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  // Clean up challenge
  await fastify.redis.del(`webauthn:auth:${challenge}`);

  return passkey.user;
}

/**
 * List passkeys for a user
 */
export async function listPasskeys(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.passkey.findMany({
    where: { userId },
    select: {
      id: true,
      friendlyName: true,
      deviceType: true,
      backedUp: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Delete a passkey
 */
export async function deletePasskey(fastify: FastifyInstance, userId: string, passkeyId: string) {
  const passkey = await fastify.prisma.passkey.findFirst({
    where: { id: passkeyId, userId },
  });

  if (!passkey) throw new AppError(404, 'NOT_FOUND', 'Passkey not found');

  await fastify.prisma.passkey.delete({ where: { id: passkeyId } });
}
