import { defineConfig, devices } from "@playwright/test";

/**
 * Meridian end-to-end verification.
 *
 * These specs run against the Expo web dev server in demo mode: the Supabase
 * env vars are cleared so `authRuntime.isConfigured` is false and the app uses
 * local data. That keeps the suite hermetic, no cloud project required, and it
 * is exactly how the real regression showed up.
 */
const PORT = 8099;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
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
    // Empty values keep the app in demo mode. Expo's dotenv does not override
    // vars already present in the process environment.
    env: {
      EXPO_PUBLIC_SUPABASE_URL: "",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    },
  },
});