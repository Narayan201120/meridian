import { expect, test as base, type Page } from "@playwright/test";

/**
 * Session expiry and recovery.
 *
 * A Supabase access token lives one hour. This app stores that token in
 * localStorage, sends it as a bearer token, and then never refreshes it.
 * `refreshToken` is read out of the sign-in response, written to storage, and
 * then never used by anything: `grant_type=refresh_token` appears nowhere in
 * `frontend/src`.
 *
 * So one hour after signing in, every single API call returns 401 and stays
 * 401 forever, because a rejected token can only be replaced by signing in
 * again. Meanwhile the UI keeps rendering "Signed in as ...", the task list
 * reads empty, and reminder controls stay enabled. The app looks alive and is
 * doing nothing.
 *
 * That is the exact defect class this project exists to eliminate, in the one
 * place it is hardest to notice: no error, no crash, just a working-looking
 * app that has quietly stopped talking to its server. It survived because every
 * previous test signed in and finished inside the hour.
 *
 * `POST /_e2e/expire-access-token` mints a session whose access token expired an
 * hour ago and whose refresh token is valid. Planting that in localStorage
 * reproduces the state on demand, which is what turns an untestable timer into
 * a test.
 */

const HARNESS = "http://127.0.0.1:8098";
const SIGN_IN_EMAIL = "e2e@meridian.test";
const SIGN_IN_PASSWORD = "E2eTest1234!Test1234!";

const test = base.extend<{ pageErrors: string[]; httpFailures: string[] }>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    await use(errors);
  },
  /**
   * Records every 4xx/5xx the page receives from the API.
   *
   * The browser logs a bare "Failed to load resource: 401" for every rejected
   * call, which is easy to scroll past and impossible to assert on. Counting
   * them turns "the console had some noise" into a number that must be zero.
   */
  httpFailures: async ({ page }, use) => {
    const failures: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    await use(failures);
  },
});

/**
 * A 401 on the very first load is expected and is the thing under test, so the
 * blanket assertion cannot simply be "no bad responses". What must never happen
 * is a 401 that the app does nothing about, which shows up as a 401 still
 * failing at the end of the test.
 */
test.afterEach(async ({ httpFailures }) => {
  expect(
    httpFailures.filter((f) => f.startsWith("401")),
    `unrecovered 401s:\n${httpFailures.join("\n")}`,
  ).toEqual([]);
});

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

/** Creates a task through the API so recovery has something real to fetch. */
async function seedTask(page: Page, request: import("@playwright/test").APIRequestContext): Promise<string> {
  const title = `E2E session-expiry ${Date.now().toString(36)}`;
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem("meridian.auth.session");
    return raw ? (JSON.parse(raw) as { accessToken: string }).accessToken : null;
  });
  expect(token).toBeTruthy();
  const created = await request.post(`${HARNESS}/api/v1/tasks`, {
    headers: { Authorization: `Bearer ${token!}` },
    data: { title },
  });
  expect(created.ok()).toBe(true);
  return title;
}

/**
 * THE BUG.
 *
 * Plant an hour-old session and reload. Before the fix: the app calls
 * `GET /api/v1/tasks` with a dead token, gets a 401, has no refresh to fall
 * back on, and renders an empty Inbox while the header still says signed in.
 *
 * After the fix it exchanges the refresh token, retries, and the seeded task is
 * simply there. No sign-in, no error, no user action.
 */
test("an expired access token is refreshed, so the app keeps working", async ({ page, request }) => {
  await ensureSignedIn(page);
  const title = await seedTask(page, request);

  // Age the session by a day. The refresh token in the same payload stays valid,
  // which is what a real one-hour-old session looks like.
  const aged = await request.post(`${HARNESS}/_e2e/expire-access-token`);
  expect(aged.ok()).toBe(true);
  const session = (await aged.json()) as {
    access_token: string;
    expires_at: number;
    refresh_token: string;
    user: { id: string; email: string };
  };

  await page.evaluate((next) => {
    localStorage.setItem(
      "meridian.auth.session",
      JSON.stringify({
        accessToken: next.access_token,
        refreshToken: next.refresh_token,
        expiresAt: next.expires_at,
        user: { id: next.user.id, email: next.user.email },
      }),
    );
  }, session);

  await page.reload();
  await expect(page.getByRole("tablist")).toBeVisible();

  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(active(page).getByText("New and reopened work lands here first")).toBeVisible();

  // The seeded task existing after a reload is the whole assertion. An empty
  // Inbox here is indistinguishable from "the user has no tasks", which is how
  // a dead session came to look like a working app.
  await expect(active(page).getByText(title)).toBeVisible({ timeout: 30_000 });

  // Still signed in, and the header is not lying about it.
  await expect(page.getByText(`Signed in as ${SIGN_IN_EMAIL}`)).toBeVisible();
});

/**
 * The half of the fix that users actually notice.
 *
 * When the refresh token is also dead there is nothing left to try. The honest
 * outcome is a signed-out app that says so, because the alternative is a header
 * claiming a session the server has already rejected.
 */
test("a session that cannot be refreshed ends up signed out, not silently broken", async ({ page, request }) => {
  await ensureSignedIn(page);

  const aged = await request.post(`${HARNESS}/_e2e/expire-access-token`);
  const session = (await aged.json()) as { access_token: string; expires_at: number; user: { id: string; email: string } };

  await page.evaluate((next) => {
    localStorage.setItem(
      "meridian.auth.session",
      JSON.stringify({
        accessToken: next.access_token,
        // Structurally valid, cryptographically meaningless. The stub verifies
        // the signature, so this is rejected the way a revoked token would be.
        refreshToken: "not-a-real-refresh-token",
        expiresAt: next.expires_at,
        user: { id: next.user.id, email: next.user.email },
      }),
    );
  }, session);

  await page.reload();
  await expect(page.getByRole("tablist")).toBeVisible();

  // The app must fall back to the sign-in form. Asserting on the absence of
  // "Signed in as" is the point: a header that keeps claiming a live session
  // after the server rejected it is the original defect, unchanged.
  await expect(page.getByText(`Signed in as ${SIGN_IN_EMAIL}`)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
});
