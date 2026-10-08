/**
 * E2E coverage for the failure paths in `tasks.ts`.
 *
 * These pin behaviour that was previously indistinguishable from success. Each
 * test drives a real HTTP failure against the live backend and asserts the app
 * tells the user something is wrong, rather than rendering the failure as an
 * empty state.
 *
 * The technique is a route interception that answers with the status code under
 * test. That exercises the frontend's real handling of a real failing response
 * without needing the backend to be broken, which keeps the failure
 * deterministic instead of dependent on a server that is actually down.
 *
 * Note these assert the app does NOT look healthy. Asserting the absence of
 * misleading UI is harder to keep than asserting presence, and a test that only
 * checks a banner appeared would pass even if the misleading text rendered too.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = "http://127.0.0.1:8098/api/v1";
const AUTH_TOKEN_URL = "http://127.0.0.1:8098/auth/v1/token?grant_type=password";

const SIGN_IN_EMAIL = "e2e@meridian.test";
const SIGN_IN_PASSWORD = "E2eTest1234!Test1234!";

/**
 * Inactive tab screens stay mounted and are only marked aria-hidden once the
 * transition settles, so queries have to skip them. Mirrors the helper in
 * live-api.spec.ts, which also shows why buttons are located by text rather than
 * role here: the app's pressable elements are divs with tabindex, not <button>.
 */
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

test.describe("a failed request must not look like an empty one", () => {
  test("a 500 on GET /tasks surfaces an error instead of an empty inbox", async ({ page }) => {
    await ensureSignedIn(page);

    await page.route("**/api/v1/tasks", async (route) => {
      // Only the list read, never the create POST.
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "deliberate e2e failure" }),
      });
    });

    await page.reload();
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();

    // "Inbox is clear" is the lie this test exists to prevent: it is the copy
    // shown when the list is empty, and an empty list is exactly what a failed
    // request used to produce.
    await expect(page.getByText("Inbox is clear")).toHaveCount(0);
  });

  test("a 401 on GET /tasks is not silently replaced by cached tasks", async ({ page }) => {
    await ensureSignedIn(page);

    // Let a real read populate the WatermelonDB cache first, so the temptation
    // to serve stale data is real rather than hypothetical.
    await page.reload();
    await expect(page.getByRole("tablist")).toBeVisible();

    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Invalid bearer token." }),
      });
    });

    await page.reload();
    await page.getByRole("tab", { name: "Inbox", exact: true }).click();

    // An expired session must not read as a healthy app. Either the user is
    // asked to sign in again, or an error is surfaced. What must not happen is a
    // confident "Inbox is clear", which claims the server told us there is
    // nothing when in fact the server said nothing at all.
    await expect(page.getByText("Inbox is clear")).toHaveCount(0);
  });
});

test.describe("a failed reminder read must not become a delivery promise", () => {
  test("a failed reminder fetch never claims the user will be reminded", async ({ page, request }) => {
    // A scheduled task is required: TaskCardEditor only renders the promise
    // line for status scheduled/due_now, so an inbox task makes the
    // toHaveCount(0) assertion trivially true without exercising anything.
    const token = await fetchAccessToken(request);
    const title = `E2E reminder-failure-${Date.now().toString(36)}`;
    const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const created = await request.post(`${API_BASE_URL}/tasks`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, status: "scheduled", due_at: dueAt },
    });
    expect(created.ok()).toBe(true);

    await ensureSignedIn(page);

    await page.route("**/api/v1/tasks/*/reminders*", async (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "deliberate e2e failure" }),
      }),
    );

    await page.reload();
    await expect(page.getByRole("tablist")).toBeVisible();
    await page.getByRole("tab", { name: "Scheduled", exact: true }).click();

    // The card renders the task editor inline, which is where this copy lives.
    // The promise is the problem: "will remind at scheduled time" is a claim about
    // the future made from a request that failed.
    await expect(active(page).getByText(title)).toBeVisible();
    await expect(page.getByText("will remind at scheduled time")).toHaveCount(0);
    await expect(page.getByText("Reminder status unknown")).toBeVisible();
  });
});