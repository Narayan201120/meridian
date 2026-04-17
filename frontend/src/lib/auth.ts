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

function persistSession(session: AuthSession | null) {
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

export function getCurrentSession(): AuthSession | null {
  if (inMemorySession !== null) {
    return inMemorySession;
  }

  const storage = getWebStorage();
  if (storage === null) {
    return null;
  }

  const rawSession = storage.getItem(sessionStorageKey);
  if (rawSession === null) {
    return null;
  }

  try {
    inMemorySession = JSON.parse(rawSession) as AuthSession;
    return inMemorySession;
  } catch {
    storage.removeItem(sessionStorageKey);
    return null;
  }
}

export function clearCurrentSession() {
  inMemorySession = null;
  persistSession(null);
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
  persistSession(session);
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

  clearCurrentSession();
}
