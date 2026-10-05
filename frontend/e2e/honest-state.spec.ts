/**
 * Honest-state suite: the UI must not state something more confident than the
 * underlying truth.
 *
 * Each test below fails against the current code and passes after its fix.
 * Conventions mirror live-api.spec.ts / failure-paths.spec.ts: pressables are
 * div[tabindex="0"] (not <button>), and inactive tab screens stay mounted, so
 * every query goes through `active(page)`.
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

function apiTask(status: string) {
  const now = new Date().toISOString();
  return {
    id: "e2e-honest-task",
    user_id: "e2e-user",
    title: "E2E honest reminder states",
    notes: null,
    status,
    priority: "medium",
    due_at: now,
    estimated_duration_minutes: null,
    created_at: now,
    updated_at: now,
  };
}

function apiReminder(id: string, status: string) {
  const now = new Date().toISOString();
  return {
    id,
    task_id: "e2e-honest-task",
    task_calendar_block_id: null,
    type: "due_date",
    scheduled_for: now,
    status,
    sent_at: status === "sent" ? now : null,
    created_at: now,
    updated_at: now,
  };
}

test.describe("reminder rows report their real delivery state", () => {
  test("failed and canceled reminders are not rendered in success green", async ({ page }) => {
    await ensureSignedIn(page);

    // A due-now task whose reminders span the delivery vocabulary. The list
    // read is intercepted; the create POST passes through untouched.
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([apiTask("due_now")]),
      });
    });
    await page.route("**/api/v1/tasks/*/reminders*", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          apiReminder("rem-failed", "failed"),
          apiReminder("rem-canceled", "canceled"),
          apiReminder("rem-sent", "sent"),
        ]),
      }),
    );

    await page.reload();
    await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();

    const failedRow = active(page).getByText(/· failed/);
    const canceledRow = active(page).getByText(/canceled/);
    const sentRow = active(page).getByText(/· sent/);
    await expect(failedRow).toBeVisible();
    await expect(canceledRow).toBeVisible();
    await expect(sentRow).toBeVisible();

    // A failed delivery is an error, not a success. Before the fix every row
    // carries text-successtext (#355B22), so a reminder that never arrived
    // looks exactly like one that did.
    await expect(failedRow).toHaveClass(/text-redtext/);
    await expect(failedRow).not.toHaveClass(/text-successtext/);
    // A canceled reminder is inert history, not an achievement: muted, not green.
    await expect(canceledRow).toHaveClass(/text-sandmuted/);
    await expect(canceledRow).not.toHaveClass(/text-successtext/);
    // A delivered reminder keeps the success treatment; the fix must not
    // overcorrect into painting everything an error.
    await expect(sentRow).toHaveClass(/text-successtext/);
  });
});

test.describe("a failed remote logout is not reported as signed out", () => {
  test("a 500 on POST /auth/v1/logout keeps the session and says why", async ({ page }) => {
    await ensureSignedIn(page);

    await page.route("**/auth/v1/logout", async (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "deliberate e2e failure" }),
      }),
    );

    await taskAction(page, /^Sign out$/).click();

    // Before the fix signOut swallows the failure (it does not even check
    // response.ok) and the UI drops the session, so the server session stays
    // live while the app claims to be signed out. After the fix the user is
    // still signed in and is told the sign-out did not go through.
    await expect(page.getByText(`Signed in as ${SIGN_IN_EMAIL}`)).toBeVisible();
    await expect(active(page).getByText(/still signed in/)).toBeVisible();
  });
});

test.describe("calendar notices get their own banner, not the Reminders one", () => {
  test("a synced calendar renders a Calendar success banner", async ({ page }) => {
    await ensureSignedIn(page);

    await page.route("**/api/v1/calendar/google/status", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "active" }),
      }),
    );
    await page.route("**/api/v1/calendar/google/sync", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ synced: 3 }),
      }),
    );

    await page.reload();
    await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();
    await taskAction(page, /^Sync calendar$/).click();

    const message = "Calendar synced — 3 events cached for 7 days";
    // The notice fired (this passes with and without the fix); the title is
    // the assertion that separates them.
    await expect(active(page).getByText(message)).toBeVisible();
    await expect(active(page).getByText("Calendar", { exact: true })).toBeVisible();
  });

  test("the finish-connecting notice is a Calendar banner, and not a success", async ({ page }) => {
    // Linking.openURL would leave the test page, so stub the new-tab open.
    // The app code awaits it and then posts the notice, which is what runs.
    //
    // Returns null, and also swallows location assignment, because
    // react-native-web's Linking.openURL reaches window.open on some builds and
    // navigates the current frame on others. A bare `open = () => null` was
    // enough locally against system Chrome but let the frame navigate on CI's
    // bundled Chromium, which then never rendered the notice at all.
    await page.addInitScript(() => {
      (window as unknown as { open: unknown }).open = () => null;
    });
    // Block the consent URL itself, so neither open path can navigate this frame
    // away even if the browser ignores the window.open stub.
    await page.route("https://calendar.example.test/**", (route) => route.abort());
    await ensureSignedIn(page);

    await page.route("**/api/v1/calendar/google/authorize", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authorization_url: "https://calendar.example.test/consent" }),
      }),
    );

    await page.reload();
    await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();
    await taskAction(page, /^Connect calendar$/).click();

    const message = active(page).getByText("Finish connecting in the Google window");
    await expect(message).toBeVisible();
    await expect(active(page).getByText("Calendar", { exact: true })).toBeVisible();

    // "Finish connecting" is an instruction, not a success. The banner behind
    // it must be the info treatment (slate-50, rgb 248,250,252), not the
    // success treatment (successbg, rgb 229,241,222). The message Text sits in
    // an inner View inside the banner root, hence the two levels up.
    const banner = message.locator("xpath=../..");
    await expect(banner).toHaveCSS("background-color", "rgb(248, 250, 252)");
  });
});
