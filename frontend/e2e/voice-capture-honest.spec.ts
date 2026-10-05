/**
 * Voice-capture honest-copy suite: the card takes text the user pastes and
 * structures it into a task. No audio is transcribed, so neither the card
 * copy nor the success message may claim transcription happened.
 *
 * Conventions mirror honest-state.spec.ts: pressables are div[tabindex="0"]
 * (not <button>), and inactive tab screens stay mounted, so every query goes
 * through `active(page)`.
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

test.describe("voice capture copy describes pasting, not transcribing", () => {
  test("the card says pasted text is structured and no audio is transcribed", async ({ page }) => {
    await ensureSignedIn(page);

    // The honest body keeps the "(future: mic)" note and adds what actually
    // happens: pasted text is structured, and no audio is transcribed.
    await expect(active(page).getByText(/No audio is transcribed/)).toBeVisible();
    await expect(active(page).getByText(/Paste text \(future: mic\)/)).toBeVisible();
  });

  test("a successful capture reports structuring, not transcription", async ({ page }) => {
    await ensureSignedIn(page);

    const title = `E2E pasted-not-transcribed ${Date.now().toString(36)}`;
    await active(page)
      .getByPlaceholder("Voice transcript (e.g., Urgent: record demo video, needs 30 minutes)")
      .fill(`${title}\nNeeds 10 minutes`);
    await taskAction(page, /Capture voice/).click();

    // The success message must describe what happened (pasted text structured
    // into a task), not claim audio was transcribed.
    await expect(active(page).getByText(new RegExp(`Structured "${title}"`))).toBeVisible();
    await expect(active(page).getByText(/Captured "/)).toHaveCount(0);
  });
});
