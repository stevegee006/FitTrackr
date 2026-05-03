export type SsoType = 'SAML' | 'OIDC';

export interface SsoProvider {
  id: string;
  name: string;
  type: SsoType;
  enabled: boolean;
  createdAt: string;
}

export interface SsoProviderAdmin extends SsoProvider {
  config: SamlConfig | OidcConfig;
}

export interface SamlConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  callbackUrl: string;
}

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes?: string[];
  // Optional explicit endpoints (override auto-discovery)
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
}
