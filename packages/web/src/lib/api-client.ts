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

/**
 * Called when the refresh token is definitively rejected, so the app can show
 * the login screen instead of sitting in a logged-in-but-dead state where every
 * request 401s and every mutation fails silently.
 */
type AuthFailureHandler = () => void;
let onAuthFailure: AuthFailureHandler | null = null;
export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  onAuthFailure = handler;
}

/**
 * In-flight refresh, shared by every caller.
 *
 * The server ROTATES refresh tokens: it deletes the presented one and issues a
 * new pair. Without this single-flight guard, a burst of concurrent 401s (the
 * workout logger fires several PATCHes per tap) each fired its own refresh with
 * the same token — the first won, the rest presented an already-deleted token,
 * got rejected, and wiped the refresh token that the winner had just stored.
 * That is the "randomly logged out" bug.
 */
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${getApiUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      // Only a definitive auth rejection means the token is dead. A 500 or a
      // gateway blip must NOT log the user out — it used to clear on any
      // non-2xx, so a momentary server error ended the session.
      if (res.status === 401 || res.status === 403) {
        setAccessToken(null);
        setRefreshToken(null);
        onAuthFailure?.();
      }
      return null;
    }

    const data = await res.json();
    setAccessToken(data.data.accessToken);
    setRefreshToken(data.data.refreshToken);
    return data.data.accessToken;
  } catch {
    // Network failure: keep the token and let the caller surface the error.
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
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

  // A fresh signal per attempt: reusing one across the retry meant a request
  // that had already timed out retried with an aborted signal and died instantly.
  const send = async (): Promise<Response> => {
    const started = Date.now();
    try {
      return await fetch(url, {
        ...fetchOptions,
        headers,
        signal: timeout ? AbortSignal.timeout(timeout) : undefined,
      });
    } catch (err: any) {
      const secs = Math.round((Date.now() - started) / 1000);
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new ApiError(0, 'TIMEOUT', `Request timed out after ${secs}s. Try again with a better connection.`);
      }
      // `fetch` REJECTED, so there was no HTTP response at all — a 4xx/5xx
      // would have come back as a Response and been turned into a typed error
      // below. The elapsed time is the diagnosis and that is why it is in the
      // message: a rejection after ~0s is CORS, DNS or a service-worker
      // strategy giving up, while one after 30-60s is something between the
      // browser and Fastify severing a slow request — a gateway read timeout.
      // Without this number the two are indistinguishable, which cost a wrong
      // diagnosis once already.
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        `Could not reach the server (failed after ${secs}s). Check your connection and try again.`,
      );
    }
  };

  // Remember which token this attempt used, so a 401 can tell "my token is
  // stale" from "someone else already refreshed while I was in flight".
  const tokenUsed = accessToken;
  let res = await send();

  if (res.status === 401 && tokenUsed) {
    if (accessToken && accessToken !== tokenUsed) {
      // Another request refreshed already — just retry with the current token.
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await send();
    } else {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        res = await send();
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
