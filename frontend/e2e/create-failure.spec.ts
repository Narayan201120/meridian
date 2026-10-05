/**
 * Create-failure suite: a refused create must not look like a created task.
 *
 * `createTask` in `src/lib/tasks.ts` used to decide "offline, keep it local"
 * by sniffing substrings of error messages (`offline-` prefix, "Failed to"),
 * so a refused create could be returned as a local-only task instead of
 * surfacing as an error. For an empty-body 401 the pre-fix symptom in the
 * browser was a "body stream already read" banner (the error-detail reader
 * consumed the stream twice) rather than the real refusal.
 *
 * The distinction under test: a request that never left the machine (route
 * aborted, fetch throws) SHOULD still produce the offline task; a request
 * the server answered and refused (401/422) MUST surface as an error and
 * must not add any row to the UI.
 *
 * NOTE on running this file: `playwright.config.ts` used to allowlist specs
 * via `testMatch: /(live-api|failure-paths)\.spec\.ts$/`, under which this
 * file did NOT run without a one-line follow-up. The config has since moved
 * to an exclusion model (`testIgnore: /flow\.spec\.ts$/`), so this file now
 * runs by default with `bun run e2e:live` and no follow-up is needed.
 * (This Playwright version has no --test-match CLI flag, and a spec filename
 * passed positionally is still filtered by testMatch, so while the allowlist
 * existed the file could only be run via a throwaway shim config.)
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE_URL = "http://127.0.0.1:8098/api/v1";
const AUTH_TOKEN_URL = "http://127.0.0.1:8098/auth/v1/token?grant_type=password";
const SIGN_IN_EMAIL = "e2e@meridian.test";
const SIGN_IN_PASSWORD = "E2eTest1234!Test1234!";

function active(page: Page) {
  return page.locator(':not([aria-hidden="true"] *)');
}

function taskAction(page: Page, label: string | RegExp) {
  return active(page).locator('div[tabindex="0"]').filter({ hasText: label });
}

const SCREEN_COPY: Record<string, RegExp> = {
  Home: /The most urgent work, inline/,
  Inbox: /New and reopened work lands here first/,
};

async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(active(page).getByText(SCREEN_COPY[name]!)).toBeVisible();
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

function uniqueTitle(prefix: string): string {
  return `E2E ${prefix} ${Date.now().toString(36)}`;
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

test.describe("a refused create must not fabricate a task", () => {
  test("a 401 on POST /tasks shows an error and adds no task", async ({ page, request }) => {
    // Seed one real task through the API, then reload so the live list read
    // populates the WatermelonDB cache. The old buggy branch only returned
    // its fabricated task when the cache had something, so without this the
    // bug would hide behind an empty cache and the test would pass for the
    // wrong reason. Seeding via API keeps the browser on Home throughout,
    // where the create form lives.
    const token = await fetchAccessToken(request);
    const seedTitle = uniqueTitle("create-failure-seed");
    const seeded = await request.post(`${API_BASE_URL}/tasks`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: seedTitle },
    });
    expect(seeded.ok()).toBe(true);

    await ensureSignedIn(page);
    await page.reload();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(active(page).getByText(/The most urgent work, inline/)).toBeVisible();

    // Empty body on purpose: the old code threw
    // `Failed to create task (401)` exactly when the body rendered empty,
    // and that literal string is what the old guard matched on.
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.fulfill({ status: 401, contentType: "application/json", body: "" });
    });

    const refusedTitle = uniqueTitle("create-refused");
    await page.getByPlaceholder("Task title").fill(refusedTitle);
    await taskAction(page, /^Add task$/).click();

    // The user must be told something went wrong: the form surfaces the
    // thrown error in its error banner instead of clearing silently. A 401
    // reads as an expired session via the shared `Loaded` vocabulary.
    await expect(active(page).getByText(/Your session has expired/)).toBeVisible();
    // The form must not clear: the task was never created, so the draft stays.
    await expect(page.getByPlaceholder("Task title")).toHaveValue(refusedTitle);

    await openTab(page, "Inbox");
    await expect(active(page).getByText(refusedTitle)).toHaveCount(0);
  });
});

test.describe("a genuine network failure must still keep the offline task", () => {
  test("an aborted POST clears the form with no error (offline path)", async ({ page }) => {
    await ensureSignedIn(page);

    // Never reaches the server: fetch throws, so there is no status code.
    // That absence of a status is the only signal the offline path may use.
    await page.route("**/api/v1/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      return route.abort();
    });

    const offlineTitle = uniqueTitle("create-offline");
    await page.getByPlaceholder("Task title").fill(offlineTitle);
    await taskAction(page, /^Add task$/).click();

    // Offline create is accepted locally: the form clears and no error
    // banner appears. If this regresses into a throw, the banner shows and
    // the draft is kept, which is exactly the refused-create behaviour and
    // proves the two paths were conflated again.
    await expect(page.getByPlaceholder("Task title")).toHaveValue("");
    await expect(active(page).getByText(/Failed to create task/)).toHaveCount(0);
    await expect(active(page).getByText(/Your session has expired/)).toHaveCount(0);
  });
});
