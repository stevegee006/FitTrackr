'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { apiFetch, setAccessToken, setRefreshToken, getRefreshToken } from '@/lib/api-client';
import type { User } from '@fittrackr/shared';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  mustChangePassword?: boolean;
}

interface LoginResult {
  mustChangePassword: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<LoginResult>;
  loginWithTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: User }>('/users/me');
      setUser(res.data);
    } catch {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
  }, []);

  useEffect(() => {
    // Try to refresh token on mount if we have a stored refresh token
    (async () => {
      const storedRefreshToken = getRefreshToken();
      if (!storedRefreshToken) {
        setIsLoading(false);
        return;
      }
      try {
        const res = await apiFetch<{ data: AuthTokens }>('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: storedRefreshToken }),
        });
        setAccessToken(res.data.accessToken);
        setRefreshToken(res.data.refreshToken);
        await refreshUser();
      } catch {
        // Invalid or expired refresh token
        setRefreshToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshUser]);

  const login = async (email: string, password: string, rememberMe?: boolean): Promise<LoginResult> => {
    const res = await apiFetch<{ data: AuthTokens }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe }),
    });
    setAccessToken(res.data.accessToken);
    setRefreshToken(res.data.refreshToken);

    if (res.data.mustChangePassword) {
      return { mustChangePassword: true };
    }

    await refreshUser();
    return { mustChangePassword: false };
  };

  const loginWithTokens = async (accessToken: string, refreshToken: string) => {
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    await refreshUser();
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const res = await apiFetch<{ data: AuthTokens }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
    setAccessToken(res.data.accessToken);
    setRefreshToken(res.data.refreshToken);
    await refreshUser();
  };

  const logout = async () => {
    const refreshToken = getRefreshToken();
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // ignore
    }
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginWithTokens, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
