import { test, expect } from '@playwright/test';

test.use({ baseURL: 'https://staging.client-site.com' });

test('TC-001: CTA navigates to campaign page', async ({ page }) => {
  await page.goto('/');
  await page.locator('role=button[name=\'Explore now\']').click();
  await expect(page).toHaveURL('/campaign');
});

// TC-002: Manual verification of physical gift card — manual case, not recorded

