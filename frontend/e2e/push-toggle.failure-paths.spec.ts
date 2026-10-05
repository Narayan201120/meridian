/**
 * E2E coverage for turning reminders OFF when the server disagrees.
 *
 * The bug this pins: `disablePush` in `src/lib/push.ts` fired
 * `DELETE /devices/{id}` without ever inspecting the responses (`fetch`
 * resolves on 401/403/500), and `usePushNotifications` then unconditionally
 * rendered "Reminders will only appear while the app is open." The Device row
 * survived server-side, the server sweep kept fanning reminders out to it, and
 * the user read a message saying reminders were off when they were not.
 *
 * Technique mirrors `failure-paths.spec.ts`: intercept the failing response
 * and assert the app does NOT render the misleading copy. The positive half
 * asserts an honest error is shown instead.
 *
 * Why the browser is faked: real push needs Notification permission (a user
 * gesture the test cannot perform) plus VAPID keys the E2E backend
 * deliberately does not configure. So `page.addInitScript` stubs a
 * push-capable browser (granted permission, one live subscription) and routes
 * `GET /push/config` + `GET /devices` to match. The code under test is still
 * the real `disablePush`/`usePushNotifications` in the app bundle; only the
 * platform layer and the network answers are staged.
 */

import { expect, test, type Page } from "@playwright/test";

const SIGN_IN_EMAIL = "e2e@meridian.test";
const SIGN_IN_PASSWORD = "E2eTest1234!Test1234!";

function active(page: Page) {
  return page.locator(':not([aria-hidden="true"] *)');
}

function taskAction(page: Page, label: string | RegExp) {
  return active(page).locator('div[tabindex="0"]').filter({ hasText: label });
}

async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();

  if (await page.getByText(`Signed in as ${SIGN_IN_EMAIL}`).isVisible().catch(() => false)) return;

  await page.getByPlaceholder("you@example.com").fill(SIGN_IN_EMAIL);
  await page.getByPlaceholder("••••••••").fill(SIGN_IN_PASSWORD);
  await taskAction(page, /^Sign in$/).click();
  await expect(page.getByText(`Signed in as ${SIGN_IN_EMAIL}`)).toBeVisible();
}

/**
 * Stages a browser that looks subscribed: permission already granted and one
 * live push subscription, so the app renders "Turn off reminders" and the
 * click drives the REAL disablePush. Must be installed before goto().
 */
async function stubSubscribedBrowser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = { subscribed: true };
    const subscription = {
      endpoint: "https://push.e2e.invalid/sub",
      toJSON: () => ({ endpoint: "https://push.e2e.invalid/sub" }),
      unsubscribe: async () => {
        store.subscribed = false;
        return true;
      },
    };
    const pushManager = {
      getSubscription: async () => (store.subscribed ? subscription : null),
      subscribe: async () => {
        store.subscribed = true;
        return subscription;
      },
    };
    const registration = { pushManager };
    Object.defineProperty(window.navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve(registration),
        register: async () => registration,
      },
      configurable: true,
    });
    if (!("PushManager" in window)) {
      Object.defineProperty(window, "PushManager", {
        value: function PushManager() {},
        configurable: true,
      });
    }
    try {
      Object.defineProperty(window.Notification, "permission", {
        value: "granted",
        configurable: true,
      });
    } catch {
      Object.defineProperty(window, "Notification", {
        value: Object.assign(function Notification() {}, {
          permission: "granted",
          requestPermission: async () => "granted" as NotificationPermission,
        }),
        configurable: true,
      });
    }
  });
}

test.describe("turning off reminders when the server disagrees", () => {
  test("a 500 on DELETE /devices/{id} is not reported as success", async ({ page }) => {
    await stubSubscribedBrowser(page);

    // Push keys are unset in E2E on purpose; claim they exist so readPushState
    // reports supported, and claim one server-side device with a push token so
    // disablePush has something to DELETE.
    await page.route("**/api/v1/push/config", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, public_key: "dGVzdA" }),
      }),
    );
    await page.route("**/api/v1/devices", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "e2e-device-1", has_push_token: true }]),
      });
    });
    await page.route("**/api/v1/devices/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "deliberate e2e failure" }),
      });
    });

    await ensureSignedIn(page);

    // The Home tab hosts ModeStatus, which owns the toggle.
    await expect(taskAction(page, /^Turn off reminders$/)).toBeVisible();
    await taskAction(page, /^Turn off reminders$/).click();

    // Wait for the round-trip to settle before asserting anything. An
    // absence assertion on its own is racy: it passes while the request is
    // still in flight, before the app has said anything at all. Either the
    // toggle flips to "Enable reminders" (the request resolved) or an honest
    // error lands; only then does "no success copy" mean something.
    await expect(active(page).getByText(/Enable reminders|may still be on/i)).toBeVisible();

    // THE LIE THIS TEST EXISTS TO PREVENT: this is the copy shown when the
    // toggle worked, and it must not render when the DELETE failed.
    await expect(page.getByText("Reminders will only appear while the app is open.")).toHaveCount(0);

    // The honest half: the failure must be said out loud, not swallowed.
    await expect(active(page).getByText(/may still be on/i)).toBeVisible();
  });
});
