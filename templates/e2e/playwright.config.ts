import { defineConfig, devices } from '@playwright/test';
import GlobalConstant from './commons/GlobalConstant';
import globalENV from './config.env';

/**
 * E2E configuration. Projects split by purpose so the QA can run a scope with
 * `npx playwright test --project <smoke|regression|cms|visual>`.
 */
export default defineConfig({
  testDir: './e2e_tests',
  timeout: GlobalConstant.testTimeout * 1000,
  expect: {
    timeout: 15 * 1000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0,
      threshold: 0.3,
      animations: 'disabled',
    },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: GlobalConstant.workers,
  reporter: 'html',
  use: {
    actionTimeout: GlobalConstant.mediumTimeout * 1000,
    navigationTimeout: 15 * 1000,
    headless: true,
    contextOptions: {
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
    },
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    video: process.env.CI ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    // CMS edit-mode authentication (runs once, stores storageState)
    {
      name: 'cms_auth',
      testMatch: /.*\.setup\.ts/,
      testDir: './e2e_tests/cms',
    },
    {
      name: 'smoke',
      testDir: './e2e_tests/smoke',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'regression',
      testDir: './e2e_tests/regression',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'visual',
      testDir: './e2e_tests/visual',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    // CMS edit-mode tests — reuse the authenticated session from cms_auth
    {
      name: 'cms',
      testDir: './e2e_tests/cms',
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: './auth/cms.json',
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
      },
      dependencies: globalENV.SKIP_AUTH ? [] : ['cms_auth'],
    },
  ],
});
