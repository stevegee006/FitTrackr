'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  toggle: () => {},
  setDark: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  // Read from localStorage on mount, fall back to system preference
  useEffect(() => {
    const stored = localStorage.getItem('fittrackr-dark-mode');
    if (stored !== null) {
      if (stored === 'true') {
        setIsDark(true);
        document.documentElement.classList.add('dark');
      }
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Sync class to <html>
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('fittrackr-dark-mode', isDark ? 'true' : 'false');
  }, [isDark]);

  const toggle = useCallback(() => setIsDark((prev) => !prev), []);
  const setDark = useCallback((dark: boolean) => setIsDark(dark), []);

  return (
    <ThemeContext.Provider value={{ isDark, toggle, setDark }}>
      {children}
    </ThemeContext.Provider>
  );
}
