let apiUrl: string | null = null;

function deriveApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4000/api/v1';

  // Use the build-time env var if set (injected at build in Docker)
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // Derive a single-level subdomain to stay within wildcard SSL certs.
    // e.g. macros.geehive.com  →  macros-api.geehive.com
    //      app.example.com     →  app-api.example.com
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      // Replace the first subdomain segment: "macros" → "macros-api"
      parts[0] = `${parts[0]}-api`;
      return `${protocol}//${parts.join('.')}/api/v1`;
    }
    // Two-part hostname (e.g. example.com) – prepend api-
    return `${protocol}//api.${hostname}/api/v1`;
  }

  return 'http://localhost:4000/api/v1';
}

export function getApiUrl(): string {
  if (apiUrl) return apiUrl;
  apiUrl = deriveApiUrl();
  return apiUrl;
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('refreshToken');
}

export function setRefreshToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('refreshToken', token);
  } else {
    localStorage.removeItem('refreshToken');
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const baseUrl = getApiUrl();
    const res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      setRefreshToken(null);
      return null;
    }
    const data = await res.json();
    setAccessToken(data.data.accessToken);
    setRefreshToken(data.data.refreshToken);
    return data.data.accessToken;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<T> {
  const baseUrl = getApiUrl();
  const url = `${baseUrl}${path}`;
  const { timeout, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Only set Content-Type for requests that have a body (avoids Fastify
  // JSON parse errors when POST/PUT is sent with an empty body)
  if (fetchOptions.body) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Use AbortSignal.timeout for requests that may take long (e.g. AI vision)
  const signal = timeout ? AbortSignal.timeout(timeout) : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchOptions,
      headers,
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'Request timed out. Try again with a better connection.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  // If 401, try refreshing the token
  if (res.status === 401 && accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      try {
        res = await fetch(url, {
          ...fetchOptions,
          headers,
          signal,
        });
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new ApiError(0, 'TIMEOUT', 'Request timed out. Try again with a better connection.');
        }
        throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
      }
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'Request failed' } }));
    throw new ApiError(res.status, body.error?.code || 'ERROR', body.error?.message || 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
