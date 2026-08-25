import { test as setup, expect } from '@playwright/test';
import globalENV from '../../config.env';

const authFile = './auth/cms.json';

/**
 * Logs into the CMS edit mode once and stores the session (cookies) for all
 * `cms` project tests. Credentials come from .env (CMS_EMAIL / CMS_PASSWORD).
 * Adjust the URL and the success marker to the project's CMS login form.
 */
setup('@CMS - authenticate for CMS edit mode', async ({ page }) => {
  const cmsUrl = `${globalENV.TEST_BASE_URL.replace(/\/+$/, '')}/EPiServer/CMS`;

  await page.goto(cmsUrl);

  // Adjust these selectors to the project's CMS login form.
  await page.fill('input#UserName', globalENV.CMS_EMAIL);
  await page.fill('input#Password', globalENV.CMS_PASSWORD);
  await page.click('input#Submit');

  // A marker that edit mode loaded — adjust to the project (e.g. '#epi-quickNavigator').
  await expect(page.locator('#epi-quickNavigator')).toBeVisible({ timeout: 30000 });

  await page.context().storageState({ path: authFile });
  await page.close();
});
