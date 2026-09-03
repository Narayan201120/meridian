import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

type RuntimeShape = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  user: {
    id: string;
    email: string | null;
  };
};

type AuthPayload = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  user?: {
    id: string;
    email?: string | null;
  };
};

const runtimeEnv = (globalThis as RuntimeShape).process?.env ?? {};
const sessionStorageKey = "meridian.auth.session";

const supabaseUrl = runtimeEnv.EXPO_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = runtimeEnv.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

let inMemorySession: AuthSession | null = null;

export const authRuntime = {
  supabaseUrl,
  publishableKey,
  isConfigured: supabaseUrl.length > 0 && publishableKey.length > 0,
};

function isNative(): boolean {
  return Platform.OS !== "web";
}

function getWebStorage(): Storage | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  return localStorage;
}

function normalizeSession(payload: AuthPayload): AuthSession {
  if (!payload.access_token || !payload.user?.id) {
    throw new Error("Supabase sign-in response is missing required session fields.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_at ?? null,
    user: {
      id: payload.user.id,
      email: payload.user.email ?? null,
    },
  };
}

function parseStoredSession(raw: string | null): AuthSession | null {
  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function readWebSession(): AuthSession | null {
  const storage = getWebStorage();
  if (storage === null) {
    return null;
  }

  const rawSession = storage.getItem(sessionStorageKey);
  const session = parseStoredSession(rawSession);
  if (session === null && rawSession !== null) {
    storage.removeItem(sessionStorageKey);
  }
  return session;
}

async function persistSession(session: AuthSession | null) {
  if (isNative()) {
    try {
      if (session === null) {
        await SecureStore.deleteItemAsync(sessionStorageKey);
      } else {
        await SecureStore.setItemAsync(sessionStorageKey, JSON.stringify(session));
      }
    } catch {
      // SecureStore may be unavailable (e.g. web fallback); ignore persistence errors.
    }
    return;
  }

  const storage = getWebStorage();

  if (storage === null) {
    return;
  }

  if (session === null) {
    storage.removeItem(sessionStorageKey);
    return;
  }

  storage.setItem(sessionStorageKey, JSON.stringify(session));
}

export async function loadPersistedSession(): Promise<AuthSession | null> {
  if (inMemorySession !== null) {
    return inMemorySession;
  }

  if (isNative()) {
    try {
      const rawSession = await SecureStore.getItemAsync(sessionStorageKey);
      const session = parseStoredSession(rawSession);
      if (session !== null) {
        inMemorySession = session;
        return inMemorySession;
      }
      if (rawSession !== null) {
        try {
          await SecureStore.deleteItemAsync(sessionStorageKey);
        } catch {
          // Ignore cleanup errors for corrupt entries.
        }
      }
    } catch {
      // Fall through to localStorage fallback below.
    }

    const fallback = readWebSession();
    if (fallback !== null) {
      inMemorySession = fallback;
    }
    return inMemorySession;
  }

  const session = readWebSession();
  if (session !== null) {
    inMemorySession = session;
  }
  return inMemorySession;
}

export function getCurrentSession(): AuthSession | null {
  if (inMemorySession !== null) {
    return inMemorySession;
  }

  if (isNative()) {
    // SecureStore is async; call loadPersistedSession() on startup to hydrate.
    // Fall back to a synchronous localStorage read when available.
    const fallback = readWebSession();
    if (fallback !== null) {
      inMemorySession = fallback;
    }
    return inMemorySession;
  }

  const session = readWebSession();
  if (session !== null) {
    inMemorySession = session;
  }
  return inMemorySession;
}

export async function clearCurrentSession() {
  inMemorySession = null;

  if (isNative()) {
    try {
      await SecureStore.deleteItemAsync(sessionStorageKey);
    } catch {
      // Ignore errors when clearing native storage.
    }
  }

  const storage = getWebStorage();
  if (storage !== null) {
    storage.removeItem(sessionStorageKey);
  }
}

export function getAccessToken(): string | null {
  return getCurrentSession()?.accessToken ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  if (!authRuntime.isConfigured) {
    throw new Error("Supabase auth is not configured in the frontend environment.");
  }

  const response = await fetch(`${authRuntime.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: authRuntime.publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email.trim(),
      password,
    }),
  });

  if (!response.ok) {
    let detail = "";

    try {
      detail = JSON.stringify(await response.json());
    } catch {
      detail = await response.text();
    }

    throw new Error(detail || `Failed to sign in (${response.status})`);
  }

  const payload = (await response.json()) as AuthPayload;
  const session = normalizeSession(payload);
  inMemorySession = session;
  await persistSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  const session = getCurrentSession();

  if (session !== null && authRuntime.isConfigured) {
    try {
      await fetch(`${authRuntime.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: authRuntime.publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    } catch {
      // Clear local auth state even if remote logout fails.
    }
  }

  await clearCurrentSession();
}
