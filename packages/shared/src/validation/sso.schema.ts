import { z } from 'zod';

const samlConfigSchema = z.object({
  entryPoint: z.string().url(),
  issuer: z.string().min(1),
  cert: z.string().min(1),
  callbackUrl: z.string().url(),
});

const oidcConfigSchema = z.object({
  issuerUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  callbackUrl: z.string().url(),
  scopes: z.array(z.string()).optional(),
  // Optional explicit endpoints (override auto-discovery)
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  userinfoEndpoint: z.string().url().optional(),
});

export const createSsoProviderSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['SAML', 'OIDC']),
  enabled: z.boolean().default(false),
  config: z.union([samlConfigSchema, oidcConfigSchema]),
});

export const updateSsoProviderSchema = createSsoProviderSchema.partial();

export type CreateSsoProviderInput = z.infer<typeof createSsoProviderSchema>;
export type UpdateSsoProviderInput = z.infer<typeof updateSsoProviderSchema>;
