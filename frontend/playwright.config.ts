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

  // `channel: "chrome"` uses the Chrome already installed on the machine.
  // cdn.playwright.dev is unreachable from this network, so `bunx playwright
  // install chromium` cannot fetch the bundled build. Set E2E_BROWSER_CHANNEL=""
  // once the download works and the bundled Chromium will be used instead.
  projects: [
    {
      name: process.env.E2E_BROWSER_CHANNEL === "" ? "chromium" : "chrome",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_BROWSER_CHANNEL === "" ? {} : { channel: "chrome" }),
      },
    },
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