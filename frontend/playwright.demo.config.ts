import { defineConfig, devices } from "@playwright/test";

/**
 * Meridian demo-mode verification.
 *
 * This is the styling and navigation suite, and it keeps running with no
 * backend at all. Do not merge it into `playwright.config.ts`.
 *
 * It caught the blank-screen regression twice, when a Tailwind v4 rewrite left
 * the compiler with no `@tailwind` directives and no theme. Both times the
 * symptom was "the app renders nothing on web" and the cause was the styling
 * pipeline, not any data path. Demo mode is the correct environment for that
 * class of bug: it isolates presentation from the network so a failure means the
 * stylesheet broke, not that an API call 500ed.
 *
 * It is NOT the right environment for anything involving data. Every polling
 * hook in this app returns early when `isApiMode` is false, so a reminder
 * system driven only by a `setInterval` cannot fail here no matter how broken
 * it is. That is why the live suite is a separate config rather than extra tests
 * in this file: mixing the two modes in one run would let the demo assertions
 * quietly define what "working" means.
 */
const PORT = 8097;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  /**
   * Only the styling and navigation specs. `live-api.spec.ts` needs a real
   * backend and real sign-in, neither of which exists in this mode, and running
   * it here would fail for reasons that have nothing to do with what it tests.
   */
  testMatch: /flow\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Reveal animates translateY over 220ms, which makes elements "not stable"
    // to Playwright. The app already honours prefers-reduced-motion, so this
    // renders instantly instead of adding arbitrary sleeps to every test.
    reducedMotion: "reduce",
  },

  /**
   * Browser selection.
   *
   * Locally we drive the Chrome already installed on the machine, because
   * cdn.playwright.dev is unreachable from this network and the bundled
   * Chromium cannot be downloaded. In CI the bundled build is installed by the
   * workflow, so use it there and get hermetic, version-pinned behaviour.
   *
   * E2E_BROWSER_CHANNEL overrides both; pass "chromium" to force the bundled
   * build, or "chrome" to force system Chrome.
   */
  projects: [
    (() => {
      const requested = process.env.E2E_BROWSER_CHANNEL;
      const channel = requested ?? (process.env.CI ? "chromium" : "chrome");
      return {
        name: channel,
        use: {
          ...devices["Desktop Chrome"],
          // `chromium` here means Playwright's own build, which has no channel.
          ...(channel === "chromium" ? {} : { channel }),
        },
      };
    })(),
  ],

  webServer: {
    command: `bun run start -- --web --port ${PORT} --localhost`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    /**
     * Empty values keep the app in demo mode. This is deliberate and load
     * bearing, not a leftover. Expo's dotenv does not override vars already
     * present in the process environment, so these blanks win over `frontend/.env`
     * and over whatever real Supabase project the developer has configured.
     */
    env: {
      EXPO_PUBLIC_SUPABASE_URL: "",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    },
  },
});