import { expect, test } from '@playwright/test';

test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(/Enbox/i);
  await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
});
