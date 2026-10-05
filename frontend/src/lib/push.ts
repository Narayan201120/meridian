/**
 * Browser push subscription.
 *
 * Everything platform-specific about Web Push lives here so the UI can ask a
 * single question: is this browser able to receive reminders, and is it already
 * subscribed? Native platforms report false, which keeps the enable button
 * hidden instead of offering something that cannot work.
 */

import { buildApiHeaders, tasksRuntime } from "./tasks";

export type PushState =
  | { supported: false; reason: string }
  | { supported: true; subscribed: boolean; permission: NotificationPermission };

type PushConfig = { enabled: boolean; public_key: string | null };

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getPushConfig(): Promise<PushConfig> {
  if (!tasksRuntime.isApiMode) {
    return { enabled: false, public_key: null };
  }
  const response = await fetch(`${tasksRuntime.apiBaseUrl}/push/config`, {
    headers: buildApiHeaders(),
  });
  if (!response.ok) {
    return { enabled: false, public_key: null };
  }
  return (await response.json()) as PushConfig;
}

export async function readPushState(): Promise<PushState> {
  if (!isSupported()) {
    return { supported: false, reason: "This browser cannot receive push notifications." };
  }
  const config = await getPushConfig();
  if (!config.enabled || !config.public_key) {
    return { supported: false, reason: "The server has no push keys configured." };
  }
  const permission = Notification.permission;
  if (permission !== "granted") {
    return { supported: true, subscribed: false, permission };
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return { supported: true, subscribed: Boolean(existing), permission };
}

/**
 * Ask for permission and register the subscription with the backend.
 *
 * Browsers only allow this from a user gesture, so it must be called directly
 * from a click handler rather than from an effect.
 */
export async function enablePush(deviceName?: string): Promise<PushState> {
  if (!isSupported()) {
    return { supported: false, reason: "This browser cannot receive push notifications." };
  }
  const config = await getPushConfig();
  if (!config.enabled || !config.public_key) {
    return { supported: false, reason: "The server has no push keys configured." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      supported: true,
      subscribed: false,
      permission,
    };
  }

  const registration = await navigator.serviceWorker.ready;
  // A browser can hold a stale subscription after the server's keys change, and
  // an unsubscribed-then-resubscribed browser can hold a dead one. Always clear
  // so we register against the current key pair.
  const stale = await registration.pushManager.getSubscription();
  if (stale) {
    await stale.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.public_key),
  });

  const response = await fetch(`${tasksRuntime.apiBaseUrl}/devices`, {
    method: "POST",
    headers: buildApiHeaders("application/json"),
    body: JSON.stringify({
      platform: "web",
      device_name: deviceName ?? defaultDeviceName(),
      push_subscription: subscription.toJSON(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to register this device for push (${response.status}).`);
  }

  return { supported: true, subscribed: true, permission };
}

export async function disablePush(): Promise<void> {
  if (!isSupported()) {
    return;
  }
  const devices = await fetch(`${tasksRuntime.apiBaseUrl}/devices`, {
    headers: buildApiHeaders(),
  });
  if (!devices.ok) {
    // The server would not even say which devices hold push tokens, so
    // nothing was deleted. Throw before touching the local subscription: the
    // browser stays subscribed, the UI keeps offering "Turn off reminders",
    // and the user can retry instead of reading a success that never happened.
    throw new Error(`Could not turn off reminders (server said ${devices.status}). They may still be on.`);
  }
  const rows = (await devices.json()) as { id: string; has_push_token: boolean }[];
  const targets = rows.filter((r) => r.has_push_token);
  const results = await Promise.all(
    targets.map((r) => fetch(`${tasksRuntime.apiBaseUrl}/devices/${r.id}`, { method: "DELETE", headers: buildApiHeaders() })),
  );
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    // Same rule: report the failure and leave the local subscription alone.
    // Unsubscribing here would stop this browser while the surviving Device
    // rows kept the server sweeping reminders at a dead endpoint.
    const status = failed[0]?.status ?? "unknown";
    if (failed.length === targets.length) {
      throw new Error(`Could not turn off reminders (server said ${status}). They may still be on.`);
    }
    throw new Error(
      `Reminders were only partly turned off (${targets.length - failed.length} of ${targets.length} devices removed; server said ${status}). The rest may still be on.`,
    );
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  await existing?.unsubscribe();
}

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") {
    return "Browser";
  }
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Chrome\//.test(agent)
      ? "Chrome"
      : /Safari\//.test(agent)
        ? "Safari"
        : /Firefox\//.test(agent)
          ? "Firefox"
          : "Browser";
  return `${browser} on ${navigator.platform || "web"}`;
}

/** VAPID keys arrive base64url encoded; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Return an ArrayBuffer rather than a Uint8Array: the DOM lib types
  // applicationServerKey against ArrayBufferView<ArrayBuffer>, which a
  // Uint8Array backed by ArrayBufferLike does not satisfy.
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    view[i] = raw.charCodeAt(i);
  }
  return buffer;
}