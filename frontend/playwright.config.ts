import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Meridian end-to-end verification.
 *
 * The suite runs against a REAL backend, not demo fixtures.
 *
 * This was not always true. The config used to blank the Supabase env vars so
 * `authRuntime.isConfigured` was false, which put the app in demo mode, which
 * made `tasksRuntime.isApiMode` false, which returned early at the first line of
 * every polling hook in the app. No backend was ever started. Every test passed
 * against in-memory fixtures, which is why a reminder system whose only trigger
 * was a `setInterval` in a React hook could sit on `main` unnoticed: in demo
 * mode that interval never runs, so no test could ever have caught it.
 *
 * `backend/e2e_server.py` now boots the real `create_application()` with a
 * file-backed SQLite database and a GoTrue-compatible auth stub on the same
 * origin, so signing in works with no Supabase project and no secrets in CI.
 * The real JWT verification path in `backend/app/core/auth.py` is exercised,
 * which is deliberate: it is the only place a signing-key change can break
 * sign-in for every user at once.
 *
 * VAPID is intentionally left unset. With no keys, `dispatch_due_reminders`
 * leaves reminders PENDING, which is the honest state and is what the reminder
 * tests assert against. Generating a private key here would mean committing one
 * to the repo, and real delivery belongs to the push suite, not this config.
 */
const BACKEND_PORT = 8098;
const FRONTEND_PORT = 8099;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

/**
 * A throwaway Fernet key for token encryption.
 *
 * Fernet keys are 32 random bytes in base64url, so `randomBytes(32)` is
 * already the right encoding. Generated per config load rather than committed:
 * a fixed key in a public repo teaches the wrong habit, and nothing encrypted
 * with it is worth decrypting later. It changes on every run, which is correct,
 * because the E2E database is deleted with the server.
 */
const FERNET_KEY = randomBytes(32).toString("base64url");

/**
 * Which Python runs the harness.
 *
 * Prefer the backend venv when it exists. The system interpreter on this
 * machine has FastAPI 0.115 while the venv has 0.142, so falling back to bare
 * `python` locally would test against different dependency versions than CI and
 * produce failures that exist nowhere else. In CI there is no venv, so it falls
 * through to `python` from setup-python, which is the intended path.
 *
 * E2E_PYTHON overrides both.
 */
const BACKEND_DIR = resolve(__dirname, "..", "backend");
const VENV_PYTHON =
  process.platform === "win32"
    ? resolve(BACKEND_DIR, ".venv", "Scripts", "python.exe")
    : resolve(BACKEND_DIR, ".venv", "bin", "python");
const PYTHON = process.env.E2E_PYTHON ?? (existsSync(VENV_PYTHON) ? VENV_PYTHON : "python");

export default defineConfig({
  testDir: "./e2e",
  /**
   * Only the live data-path specs. `flow.spec.ts` deliberately runs with no
   * backend and lives in `playwright.demo.config.ts`; see that file for why the
   * two modes must not share a run.
   */
  /**
   * Everything except the demo suite.
   *
   * An allowlist had to be edited every time a spec was added, and a spec that
   * silently did not run is worse than no spec: it looked like coverage. Naming
   * the one file that genuinely belongs to the other config means a new live
   * spec runs by default and the exclusion stays visible.
   *
   * `flow.spec.ts` runs under playwright.demo.config.ts with no backend at all.
   */
  testIgnore: /flow\.spec\.ts$/,
  /**
   * Serial by necessity, not by accident. Every spec shares one SQLite file and
   * one seeded user, so two specs creating tasks at once would interleave. If
   * this ever needs to become parallel the database has to become per-worker
   * first, not the test runner.
   */
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

  /**
   * Two servers, in dependency order.
   *
   * The backend comes first because Playwright starts these in array order and
   * the frontend bundle reads the API base URL at build time. The auth stub
   * lives on the backend origin rather than being a separate service, so
   * `EXPO_PUBLIC_SUPABASE_URL` points at 8098 and both the login request and the
   * API request are same-origin. That removes CORS from the picture entirely,
   * which matters because CORS misconfiguration is an easy way to make an E2E
   * suite fail for reasons that have nothing to do with the app.
   */
  webServer: [
    {
      command: `"${PYTHON}" e2e_server.py --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: "../backend",
      url: `${BACKEND_URL}/api/v1/health`,
      /**
       * Never reused. A stale backend would mean a stale SQLite file, and a
       * suite that asserts on reminder state needs to start from a known
       * database every time. Failing loudly on a busy port beats silently
       * testing yesterday's leftovers.
       */
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        MERIDIAN_DATABASE_URL: "sqlite+aiosqlite:///./e2e.db",
        // The auth stub serves `/auth/v1/*` from this origin, and
        // `supabase_jwt_issuer` derives `{url}/auth/v1` from this value.
        MERIDIAN_SUPABASE_URL: BACKEND_URL,
        MERIDIAN_TOKEN_ENCRYPTION_KEY: FERNET_KEY,
        MERIDIAN_CORS_ORIGINS: `${BASE_URL},http://127.0.0.1:${FRONTEND_PORT}`,
        /**
         * The sweep interval is configurable, so the test can use two seconds
         * rather than the production default of thirty. A test that has to wait
         * out the real interval is a test people stop running.
         */
        MERIDIAN_REMINDER_DISPATCH_INTERVAL_SECONDS: "2",
      },
    },
    {
      command: `bun run start -- --web --port ${FRONTEND_PORT} --localhost`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      /**
       * Non-empty values put the app in API mode, which is the whole point.
       * The publishable key is not secret and is not checked by the auth stub,
       * but it must be non-empty because `authRuntime.isConfigured` requires
       * both fields.
       */
      env: {
        EXPO_PUBLIC_API_BASE_URL: `${BACKEND_URL}/api/v1`,
        EXPO_PUBLIC_SUPABASE_URL: BACKEND_URL,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-local-publishable-key",
      },
    },
  ],
});