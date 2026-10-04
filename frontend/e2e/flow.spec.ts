import { expect, test as base, type Page } from "@playwright/test";

/**
 * Failure modes this suite exists to catch, in the order they actually bit us:
 *
 *  1. Blank render. Tab chrome is static HTML, so it survives a dead JS bundle.
 *     Assert real content, not just a mounted root.
 *  2. Unstyled render. NativeWind v4 requires Tailwind v3; a v4 stylesheet
 *     compiles to nothing and the app looks plain rather than broken.
 *  3. Lost font tokens. If the theme loses its fontFamily block the text still
 *     renders, just in the fallback face.
 *  4. Silent module-eval throw. One bad import blanks every route.
 *  5. Demo mode not announced, so a dead backend looks like a working app.
 *  6. A created task that never appears, because nothing re-reads the list.
 *  7. Slot suggestions ignoring the task's estimated duration.
 *  8. Scheduling not moving the task, or Scheduled not ordered by time.
 *
 * Every test also fails on any console error or uncaught exception, because a
 * swallowed module-eval throw is exactly how the blank screen presented.
 */

const CANVAS_RGB = "rgb(253, 251, 247)"; // #FDFBF7
const HERO_RGB = "rgb(9, 38, 30)"; // #09261E
const DISPLAY_FONT = "SpaceGrotesk_700Bold";

/** Distinctive copy per screen, used to wait out the tab transition. */
const SCREEN_COPY: Record<string, RegExp> = {
  Home: /The most urgent work, inline/,
  Inbox: /New and reopened work lands here first/,
  Scheduled: /Calendar-aware work, ordered by activation time/,
  "Due now": /Activated work that needs a decision right now/,
  Completed: /Finished work, kept visible until archived/,
};

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
 * transition settles, so every query has to skip them. Home's due-now card has
 * its own "Suggest times" button: a bare text match resolves to that off-screen
 * copy, and the click then lands on nothing.
 */
function active(page: Page) {
  return page.locator(':not([aria-hidden="true"] *)');
}

/** Clicks a task-row action button by label, on the visible screen only. */
function taskAction(page: Page, label: string) {
  return active(page).locator('div[tabindex="0"]').filter({ hasText: label });
}

/** Switches tab and waits for that screen's content, not just aria-selected. */
async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(active(page).getByText(SCREEN_COPY[name]!)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // The font gate holds the tree empty for up to 3s by design.
  await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toBeVisible();
});

test("1. renders content, not just tab chrome", async ({ page }) => {
  await expect(page.getByRole("tab")).toHaveCount(5);
  for (const name of ["Home", "Inbox", "Scheduled", "Due now", "Completed"]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
});

test("2. paints the canvas and hero with design tokens, so NativeWind compiled", async ({ page }) => {
  const canvas = page.locator(".bg-canvas").first();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCSS("background-color", CANVAS_RGB);

  // A dead stylesheet leaves the hero transparent instead of forest green.
  await expect(page.locator(".bg-primary").first()).toHaveCSS("background-color", HERO_RGB);
});

test("3. applies the display font token to the hero headline", async ({ page }) => {
  await expect(page.getByText("Capture a task, then give it somewhere real to go.")).toHaveCSS(
    "font-family",
    new RegExp(DISPLAY_FONT),
  );
});

test("4. announces demo mode instead of pretending the backend is live", async ({ page }) => {
  await expect(page.getByText("Demo mode")).toBeVisible();
  await expect(page.getByText(/local demo data until Supabase auth is configured/)).toBeVisible();
});

test("5. navigates all five tabs", async ({ page }) => {
  for (const name of ["Inbox", "Scheduled", "Due now", "Completed", "Home"]) {
    await openTab(page, name);
  }
});

test("6. creates an inbox task and it shows up without a reload", async ({ page }) => {
  const title = "Verify Meridian end to end";
  await page.getByPlaceholder("Task title").fill(title);
  await page.getByPlaceholder("Notes (optional)").fill("Created by the e2e suite.");
  await active(page).locator('div[tabindex="0"]').filter({ hasText: /^Add task$/ }).click();

  await openTab(page, "Inbox");
  await expect(active(page).getByText(title)).toBeVisible();
});

/**
 * These three load /inbox directly rather than switching tabs. Demo state lives
 * in memory, so a full load is fine at the start, and it guarantees a single
 * mounted screen to click on. They must switch to Scheduled with openTab, since
 * navigating there by URL would discard the task they just scheduled.
 */
test.describe("scheduling from the inbox", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.getByText(SCREEN_COPY.Inbox!)).toBeVisible();
  });

  test("7. suggests three slots sized to the task duration", async ({ page }) => {
    await taskAction(page, "Suggest times").first().click();
    await expect(taskAction(page, "Schedule here")).toHaveCount(3);

    // The inbox task is 45 minutes, so each suggestion must span 45 minutes.
    const spans = await page.evaluate(() =>
      Array.from(
        document.body.innerText.matchAll(
          /(\w+ \d+, \d{4}, \d{1,2}:\d{2} [AP]M)\s*→\s*(\w+ \d+, \d{4}, \d{1,2}:\d{2} [AP]M)/g,
        ),
      )
        .map((m) => [m[1], m[2]] as const)
        .filter((p): p is readonly [string, string] => p[0] !== undefined && p[1] !== undefined)
        .map(([start, end]) => (new Date(end).getTime() - new Date(start).getTime()) / 60_000),
    );
    expect(spans).toHaveLength(3);
    for (const minutes of spans) expect(minutes).toBe(45);
  });

  test("8. scheduling clears the task from Inbox and lands it in Scheduled", async ({ page }) => {
    const taskTitle = "Wire Expo task list to FastAPI";
    await expect(page.getByText(taskTitle)).toBeVisible();

    await taskAction(page, "Suggest times").first().click();
    await taskAction(page, "Schedule here").first().click();
    await expect(page.getByText("Inbox is clear")).toBeVisible();

    await openTab(page, "Scheduled");
    await expect(active(page).getByText(taskTitle)).toBeVisible();
  });

  test("9. orders Scheduled by activation time, ascending", async ({ page }) => {
    await taskAction(page, "Suggest times").first().click();
    await taskAction(page, "Schedule here").first().click();
    await openTab(page, "Scheduled");

    const stamps = await page.evaluate(() =>
      Array.from(document.body.innerText.matchAll(/Scheduled for:\s*(.+)/g))
        .map((m) => m[1])
        .filter((s): s is string => s !== undefined)
        .map((text) => new Date(text).getTime())
        .filter((t) => !Number.isNaN(t)),
    );
    expect(stamps.length).toBeGreaterThanOrEqual(2);
    expect(
      stamps,
      `unsorted: ${stamps.map((t) => new Date(t).toISOString()).join(", ")}`,
    ).toEqual([...stamps].sort((a, b) => a - b));
  });
});