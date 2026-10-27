import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ColorScheme = "light" | "dark";

const storageKey = "meridian.theme.scheme";

type ThemeContextValue = {
  scheme: ColorScheme;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({ scheme: "light", toggle: () => {} });

async function loadStored(): Promise<ColorScheme | null> {
  try {
    const raw =
      Platform.OS === "web"
        ? typeof localStorage !== "undefined"
          ? localStorage.getItem(storageKey)
          : null
        : await SecureStore.getItemAsync(storageKey);
    return raw === "dark" || raw === "light" ? raw : null;
  } catch {
    return null;
  }
}

async function store(scheme: ColorScheme) {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, scheme);
    } else {
      await SecureStore.setItemAsync(storageKey, scheme);
    }
  } catch {
    // Persistence is best-effort; theme still applies in memory.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setScheme] = useState<ColorScheme>("light");

  useEffect(() => {
    let mounted = true;
    void loadStored().then((stored) => {
      if (!mounted) return;
      if (stored !== null) {
        setScheme(stored);
      } else {
        const system = Appearance.getColorScheme();
        if (system === "dark" || system === "light") setScheme(system);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = useCallback(() => {
    setScheme((prev) => {
      const next: ColorScheme = prev === "dark" ? "light" : "dark";
      void store(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ scheme, toggle }), [scheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
