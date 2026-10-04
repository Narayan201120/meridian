import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Live-API suite: the same product paths as flow.spec.ts, but against the
 * real backend that playwright.config.ts boots (backend/e2e_server.py on
 * 127.0.0.1:8098, Expo web on localhost:8099, with a GoTrue-compatible auth
 * stub on the same origin so sign-in works with no Supabase project).
 *
 * Failure modes this suite exists to catch, in the order they matter:
 *
 *  1. Demo mode sneaking back in. flow.spec.ts pins the unconfigured state
 *     and REQUIRES the "Demo mode" banner; this suite asserts the opposite.
 *     If the banner is back, no other test here can pass for the right reason.
 *  2. A created task that vanishes on reload, because a hook mutated local
 *     state and never persisted it.
 *  3. A UI that renders fixtures instead of reading the backend, which only
 *     an API-created task can expose.
 *
 * Every test also fails on any console error or uncaught exception, because a
 * swallowed module-eval throw is exactly how the blank screen presented.
 */

const API_BASE_URL = "http://127.0.0.1:8098/api/v1";
const AUTH_TOKEN_URL = "http://127.0.0.1:8098/auth/v1/token?grant_type=password";

const SIGN_IN_EMAIL = "e2e@meridian.test";
const SIGN_IN_PASSWORD = "E2eTest1234!Test1234!";

const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    await use(errors);
  },
});

test.afterEach(async ({ pageErrors }) => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

/**
 * Inactive tab screens stay mounted and are only marked aria-hidden once the
 * transition settles, so every query has to skip them.
 */
function active(page: Page) {
  return page.locator(':not([aria-hidden="true"] *)');
}

/** Clicks a button by label, on the visible screen only. */
function taskAction(page: Page, label: string | RegExp) {
  return active(page).locator('div[tabindex="0"]').filter({ hasText: label });
}

/** Distinctive copy per screen, used to wait out the tab transition. */
const SCREEN_COPY: Record<string, RegExp> = {
  Home: /The most urgent work, inline/,
  Inbox: /New and reopened work lands here first/,
};

/** Switches tab and waits for that screen's content, not just aria-selected. */
async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(active(page).getByText(SCREEN_COPY[name]!)).toBeVisible();
}

/**
 * Drives the real AuthCard sign-in form, unless a persisted session from a
 * previous test already has us signed in.
 */
async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto("/");
  // The font gate holds the tree empty for up to 3s by design.
  await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();

  if (await page.getByText(`Signed in as ${SIGN_IN_EMAIL}`).isVisible().catch(() => false)) return;

  await page.getByPlaceholder("you@example.com").fill(SIGN_IN_EMAIL);
  await page.getByPlaceholder("••••••••").fill(SIGN_IN_PASSWORD);
  await taskAction(page, /^Sign in$/).click();
  // ModeStatus renders this only once the token round-tripped.
  await expect(page.getByText(`Signed in as ${SIGN_IN_EMAIL}`)).toBeVisible();
}

/** Mints a bearer token through the GoTrue-compatible auth stub. */
async function fetchAccessToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(AUTH_TOKEN_URL, {
    headers: { apikey: "anything" },
    data: { email: SIGN_IN_EMAIL, password: SIGN_IN_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { access_token?: string };
  expect(typeof body.access_token).toBe("string");
  return body.access_token!;
}

/** Timestamped titles so concurrent runs never collide. */
function uniqueTitle(prefix: string): string {
  return `E2E ${prefix} ${Date.now().toString(36)}`;
}

test("1. signs in for real and proves the app is not in demo mode", async ({ page }) => {
  await ensureSignedIn(page);

  // THIS IS THE ASSERTION THAT SEPARATES THIS SUITE FROM THE DEMO SUITE.
  // flow.spec.ts:102 requires "Demo mode" to be VISIBLE, because that suite
  // pins the unconfigured state. Here EXPO_PUBLIC_SUPABASE_URL is set, so
  // tasksRuntime.isApiMode is true and every polling hook in the app fires.
  // In demo mode isApiMode is false and each hook returns early at its first
  // line, so a suite that never checks this can pass against in-memory
  // fixtures while the backend is never touched.
  await expect(page.getByText("Demo mode")).toHaveCount(0);

  // Positive proof of the same fact: ModeStatus renders "API mode" only when
  // isApiMode is true, next to the session the auth stub minted.
  await expect(page.getByText("API mode")).toBeVisible();
  await expect(page.getByText(`Signed in as ${SIGN_IN_EMAIL}`)).toBeVisible();
});

test("2. a task created in the UI survives a full page reload", async ({ page }) => {
  await ensureSignedIn(page);
  const title = uniqueTitle("reload-survivor");

  await page.getByPlaceholder("Task title").fill(title);
  await taskAction(page, /^Add task$/).click();

  await openTab(page, "Inbox");
  await expect(active(page).getByText(title)).toBeVisible();

  // Full reload: fresh JS bundle, fresh context load. The failure mode is a
  // hook that updates local state (or an in-memory list) without persisting
  // anything, so the task flashes into view and is gone after a refresh.
  // flow.spec.ts:123-128 admits demo state is in-memory and discarded on
  // navigation, so this assertion is impossible in demo mode and only
  // meaningful here, against the real backend.
  await page.reload();

  // The app restores the last route, so a reload lands back on Inbox rather
  // than Home. Waiting for the Home hero here would hang for the wrong reason:
  // it is not missing because the app failed to boot, it is on another tab.
  // The tab list is the honest readiness signal that the shell mounted.
  await expect(page.getByRole("tablist")).toBeVisible();

  await openTab(page, "Inbox");
  await expect(active(page).getByText(title)).toBeVisible();
});

test("3. a task created through the API appears in the UI", async ({ page, request }) => {
  const token = await fetchAccessToken(request);
  const title = uniqueTitle("api-created");

  const created = await request.post(`${API_BASE_URL}/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  });
  expect(created.ok()).toBe(true);

  // The UI session belongs to the same seeded user, so a refresh must pick
  // up the server-side row. If the frontend rendered local fixtures instead
  // of reading the backend, this title could never appear.
  await ensureSignedIn(page);
  await page.reload();
  await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();

  await openTab(page, "Inbox");
  await expect(active(page).getByText(title)).toBeVisible();
});

/**
 * THE TEST THIS PROJECT MOST NEEDED.
 *
 * Reminder delivery used to have exactly one trigger: a 30-second setInterval
 * inside a React hook, calling a route that had no other caller. So a reminder
 * was sent only while somebody had the app open in a tab. Close the tab and
 * nothing was ever delivered, which meant a reminder for a 9am task did not
 * arrive at 9am. It shipped because the E2E suite ran in demo mode, where that
 * interval returns before doing anything, so no test could ever see the bug.
 *
 * This closes the browser context completely, then asserts the server reached a
 * device on its own. There is no page, no fetch loop and no client alive while
 * the assertion becomes true.
 *
 * The device endpoint is `https://push.e2e.invalid/...`, which passes the
 * transport's prefix guard and then fails DNS. Delivery is genuinely attempted
 * and genuinely fails, so the evidence is a NotificationDelivery row recording
 * that failure. That is the honest signal: it proves the server acted, without
 * pretending a push reached a human. Asserting a successful delivery would need
 * a real push service and real VAPID keys, which is a different test.
 */
test("4. an overdue reminder is delivered with no browser open at all", async ({ page, request }) => {
  const harness = API_BASE_URL.replace("/api/v1", "");

  await ensureSignedIn(page);
  const seeded = await request.post(`${harness}/_e2e/seed-due-reminder`);
  expect(seeded.ok()).toBe(true);
  const { reminder_id: reminderId } = (await seeded.json()) as { reminder_id: string };

  // Nothing counts if a client is still polling, so stop it before waiting.
  await page.context().close();

  await expect
    .poll(
      async () => {
        const res = await request.get(`${harness}/_e2e/deliveries`);
        const body = (await res.json()) as {
          deliveries: { reminder_id: string; status: string; error_message: string | null }[];
        };
        return body.deliveries.find((d) => d.reminder_id === reminderId)?.status ?? "none";
      },
      {
        message: "the server should attempt delivery on its own, with no client running",
        timeout: 20_000,
        intervals: [500],
      },
    )
    .not.toBe("none");
});
