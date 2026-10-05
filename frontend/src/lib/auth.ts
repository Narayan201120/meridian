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

// ---------------------------------------------------------------------------
// Token refresh.
//
// A Supabase access token lives one hour. Without this block the app stores a
// refresh token and never uses it, so one hour after sign-in every API call
// returns 401 and keeps returning 401, because the only way to replace a
// rejected token is to sign in again. The UI is the worst part: it renders
// "Signed in as ...", the task list reads empty, and reminder controls stay
// enabled. A dead session that looks like a working one is precisely the defect
// class this codebase keeps fixing, so it gets a real recovery path.
//
// Three rules, each learned the hard way:
//
//   1. Refresh lazily, on the first 401, not on a timer. A timer either fires
//      before expiry and wastes a round trip, or fires late and the user sees a
//      flash of error. Retrying the request that already failed means the
//      refresh happens exactly when it is needed.
//   2. One refresh at a time, shared by every caller. The app fires several reads
//      in parallel on load, so without a single-flight guard each one sees its
//      own 401 and starts its own refresh. Supabase rotates refresh tokens, so
//      the losers present an already-consumed token and get signed out for it.
//   3. A failed refresh ends the session rather than retrying. There is no third
//      thing to try, and leaving a session object in place after the server has
//      rejected it is the lie being fixed.
// ---------------------------------------------------------------------------

/** Notified when the session is gone and cannot be recovered. */
type SessionLostListener = () => void;

const sessionLostListeners = new Set<SessionLostListener>();

/**
 * Subscribe to "the session died and cannot be refreshed".
 *
 * The module that discovers an unusable session is a plain function, not a
 * component, so it cannot set React state. Without a channel out, the app would
 * recover the token silently while the UI kept claiming a session the server had
 * already rejected.
 */
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

function announceSessionLost(): void {
  for (const listener of [...sessionLostListeners]) {
    try {
      listener();
    } catch {
      // A listener that throws must not stop the others, and must not leave the
      // session half-cleared.
    }
  }
}

/** Clears the session and tells the app it has to render a signed-out state. */
export async function expireSession(): Promise<void> {
  await clearCurrentSession();
  announceSessionLost();
}

let inFlightRefresh: Promise<AuthSession | null> | null = null;

/**
 * Exchange the refresh token for a new access token, or return null.
 *
 * Returns null for every unrecoverable case: no session, no refresh token, a
 * rejected token, no network. The caller cannot tell them apart and does not
 * need to, because every one of them ends the same way.
 */
export async function refreshAccessToken(): Promise<AuthSession | null> {
  if (inFlightRefresh) return inFlightRefresh;

  const session = getCurrentSession();
  if (!session) return null;
  if (!session.refreshToken) {
    // A session with no refresh token predates this code, or came from a
    // response that omitted one. Signing out is the only honest state.
    await expireSession();
    return null;
  }
  if (!authRuntime.isConfigured) return null;

  inFlightRefresh = (async (): Promise<AuthSession | null> => {
    try {
      const response = await fetch(`${authRuntime.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: authRuntime.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });

      if (!response.ok) {
        await expireSession();
        return null;
      }

      const refreshed = normalizeSession((await response.json()) as AuthPayload);
      inMemorySession = refreshed;
      await persistSession(refreshed);
      return refreshed;
    } catch {
      // The network failed. The token may still be fine, so the session is left
      // alone and the caller's request simply fails this once. Signing out
      // because a train went into a tunnel would be its own kind of lie.
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
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
    let response: Response;
    try {
      response = await fetch(`${authRuntime.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: authRuntime.publishableKey,
          Authorization: `Bearer ${session.accessToken}`,
        },
      });
    } catch {
      // The request never completed, so the server session is presumably still
      // live. Keep the local session so the UI keeps saying signed in, which
      // is the truth, and let the caller surface this instead of swallowing it.
      throw new Error("Could not reach the server to sign out. You are still signed in — try again.");
    }
    if (!response.ok) {
      // fetch resolves on a 500, so !ok must be checked explicitly: a rejected
      // logout that still clears local state leaves the server session live
      // while the UI claims to be signed out. Same deal as above — stay signed
      // in and say so.
      throw new Error(`Sign-out failed (${response.status}). You are still signed in — try again.`);
    }
  }

  await clearCurrentSession();
}
