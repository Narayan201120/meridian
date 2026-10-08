/**
 * Prove real Web Push delivery, end to end, with no fake anywhere.
 *
 * What this establishes, and what it deliberately does not:
 *
 *   ESTABLISHED — a real browser mints a real subscription against a real push
 *   service (FCM), the real backend accepts it, the real scheduler picks up a
 *   reminder on its own timer with no client polling, and the server POSTs the
 *   payload to the push service, which accepts it.
 *
 *   NOT ESTABLISHED — that a human saw a notification. Nothing can prove that
 *   over an API. What can be shown is that the push service accepted the
 *   message for the browser's own subscription, which is the last step this
 *   project controls.
 *
 * Why a fixed profile directory: the subscription lives in the browser profile.
 * A fresh profile per run would mint a new subscription every time and there
 * would be no way to re-check the same one. The directory is gitignored.
 *
 * Why headed: push delivery to a headless Chrome is unreliable and the failure
 * looks identical to a product bug, which is the trap this script exists to
 * avoid repeating.
 *
 * Usage (from frontend/):
 *   node scripts/verify-real-push.mjs
 */

import { chromium } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");
const PROFILE = resolve(FRONTEND, ".push-probe-profile");

const APP = "http://localhost:8081";
const API = "http://127.0.0.1:8000/api/v1";
const EMAIL = process.env.PROBE_EMAIL ?? "meridian.tester@gmail.com";
const PASSWORD = process.env.PROBE_PASSWORD ?? "Test1234!Test1234!";
const SWEEP_DEADLINE_MS = 120_000;

/** Reads the same env the app bundle was built from. */
function frontendEnv() {
  const path = resolve(FRONTEND, ".env");
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

const env = frontendEnv();
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in frontend/.env");
  process.exit(1);
}

// --- 1. A real session, minted the same way the app mints one ----------------
const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!tokenResponse.ok) {
  console.error("Sign-in failed:", tokenResponse.status, await tokenResponse.text());
  process.exit(1);
}
const { access_token: token, user } = await tokenResponse.json();
const auth = { Authorization: `Bearer ${token}` };
console.log(`signed in as          : ${EMAIL} (${user.id})`);

// --- 2. A real browser, with the permission a user grants --------------------
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
});
await context.grantPermissions(["notifications"], { origin: APP });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(APP);
await page.waitForTimeout(3000);

const pushConfig = await fetch(`${API}/push/config`, { headers: auth }).then((r) => r.json());
if (!pushConfig.enabled) {
  console.error("Server reports push is not configured:", pushConfig);
  process.exit(1);
}

const subscriptionJson = await page.evaluate(async (applicationServerKey) => {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const padding = "=".repeat((4 - (applicationServerKey.length % 4)) % 4);
    const base64 = (applicationServerKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const buffer = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: buffer,
    });
  }
  return subscription.toJSON();
}, pushConfig.public_key);

console.log(`push permission       : ${await page.evaluate(() => Notification.permission)}`);
console.log(`subscription endpoint : ${subscriptionJson.endpoint}`);
console.log(`push service host     : ${new URL(subscriptionJson.endpoint).host}`);
console.log(`reused subscription   : ${existsSync(PROFILE) ? "profile reused" : "fresh profile"}`);

// --- 3. Instrument the service worker so a received push is observable ------
// Evidence has to be the push arriving in the browser, not the server's opinion
// of it. The service worker records every push event it handles, plus every
// showNotification call, so a decrypt failure (event fires, no data) is
// distinguishable from a message that never arrives (no event at all).
await page.evaluate(() => navigator.serviceWorker.ready);
const workers = context.serviceWorkers();
const sw = workers[0];
if (!sw) {
  console.log("NO SERVICE WORKER — cannot observe arrival");
} else {
  await sw.evaluate(() => {
    self.__meridianPushes = [];
    self.addEventListener("push", (event) => {
      let parsed = null;
      let parseError = null;
      try {
        parsed = event.data ? event.data.json() : null;
      } catch (e) {
        parseError = String(e);
      }
      self.__meridianPushes.push({
        at: new Date().toISOString(),
        hadData: Boolean(event.data),
        text: parsed ? null : event.data ? event.data.text() : null,
        parseError,
        title: parsed?.title ?? null,
        body: parsed?.body ?? null,
      });
    });

    const original = ServiceWorkerRegistration.prototype.showNotification;
    self.__meridianNotifications = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      self.__meridianNotifications.push({ title, body: options?.body ?? "" });
      return original.call(this, title, options);
    };
  });
  console.log("service worker        : instrumented for push + showNotification");
}

// --- 4. Register the device, then create work that becomes due --------------
const deviceResponse = await fetch(`${API}/devices`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    platform: "web",
    device_name: "Real push verification (Chrome)",
    push_subscription: subscriptionJson,
  }),
});
const device = await deviceResponse.json();
console.log(`device registration   : HTTP ${deviceResponse.status} (${device.id ?? "no id"})`);

const title = `Real push proof ${new Date().toISOString()}`;
const dueAt = new Date(Date.now() - 60_000).toISOString();
const taskResponse = await fetch(`${API}/tasks`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ title, status: "scheduled", due_at: dueAt }),
});
const task = await taskResponse.json();
console.log(`task created          : ${task.id} (due ${dueAt})`);

// --- 5. Wait for the SERVER to act, with no client polling -----------------
// The sweep runs on its own timer. Polling the REST API is only observation;
// nothing in the page fetches, and no dispatch endpoint is called.
console.log(`\nwaiting up to ${SWEEP_DEADLINE_MS / 1000}s for the server's own sweep...`);
const deadline = Date.now() + SWEEP_DEADLINE_MS;
let reminder = null;
while (Date.now() < deadline) {
  const list = await fetch(`${API}/tasks/${task.id}/reminders`, { headers: auth }).then((r) => r.json());
  reminder = (list ?? []).find((r) => r.type === "due_date") ?? null;
  if (reminder && reminder.status !== "pending") break;
  await new Promise((r) => setTimeout(r, 3000));
}

if (!reminder) {
  console.log("NO REMINDER WAS CREATED — investigate before reading anything else");
} else {
  console.log(`reminder status       : ${reminder.status}`);
  console.log(`reminder id           : ${reminder.id}`);
}

// Give the browser a moment to receive anything FCM accepted.
await page.waitForTimeout(5000);

console.log("\n--- what the BROWSER saw ---");
if (sw) {
  const pushes = await sw.evaluate(() => self.__meridianPushes ?? []);
  const shown = await sw.evaluate(() => self.__meridianNotifications ?? []);
  console.log(`push events received  : ${pushes.length}`);
  for (const p of pushes) {
    console.log(`  hadData=${p.hadData} title=${JSON.stringify(p.title)} body=${JSON.stringify(p.body)} parseError=${p.parseError}`);
  }
  console.log(`showNotification calls: ${shown.length}`);
  for (const n of shown) console.log(`  "${n.title}" — ${n.body}`);
} else {
  console.log("no service worker handle, nothing observed");
}

const notifications = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.getNotifications();
  return existing.map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
});
console.log(`notifications on screen: ${notifications.length}`);
for (const n of notifications) console.log(`  "${n.title}" — ${n.body}`);

console.log(`\nNOW RUN: backend\\.venv\\Scripts\\python.exe scripts\\check_last_delivery.py`);
console.log("Leave this browser open until that finishes.");

// Keep Chrome alive briefly so the delivery has somewhere to land.
await page.waitForTimeout(20_000);
await context.close();
