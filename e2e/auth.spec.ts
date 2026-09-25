import { expect, test } from '@playwright/test';
import { apiAs, registerUser, uniqueName } from './helpers';

test.describe('auth', () => {
  test('register via the UI → onboarding → lands in chats', async ({ page }) => {
    const username = uniqueName('reg');
    await page.goto('/register');
    await page.getByLabel('Your name', { exact: true }).fill('Riley Quinn');
    await page.getByLabel('Username', { exact: true }).fill(username.toUpperCase()); // normalised to lowercase
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue(username);
    await page.getByLabel('Password', { exact: true }).fill('correct horse 42');
    await expect(page.getByText(/Good|Strong/)).toBeVisible();
    await page.getByRole('button', { name: 'Create account' }).click();

    // Optional onboarding: update about, then continue.
    await expect(page).toHaveURL(/\/welcome/);
    await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Available', exact: true }).click();
    await expect(page.getByLabel('About', { exact: true })).toHaveValue('Available');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/chats$/);

    // The profile was saved on the server.
    const token = await page.evaluate(() => localStorage.getItem('enbox.token'));
    const me = await apiAs<{ username: string; about: string; displayName: string }>(
      { token: token! },
      'GET',
      '/api/me',
    );
    expect(me).toMatchObject({ username, about: 'Available', displayName: 'Riley Quinn' });
  });

  test('register shows server errors (username taken)', async ({ page }) => {
    const existing = await registerUser();
    await page.goto('/register');
    await page.getByLabel('Your name', { exact: true }).fill('Someone');
    await page.getByLabel('Username', { exact: true }).fill(existing.user.username);
    await page.getByLabel('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('This username is taken')).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test('login with username, wrong password error, then log out', async ({ page }) => {
    const user = await registerUser({ displayName: 'Login Tester' });
    await page.goto('/login');
    await page.getByLabel('Username or phone').fill(user.user.username);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect/i);

    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/chats$/);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Log out' }).click();
    await page
      .getByRole('dialog', { name: 'Log out of Enbox?' })
      .getByRole('button', { name: 'Log out', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('login with a phone number honours ?next=', async ({ page }) => {
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const user = await registerUser({ phone });
    await page.goto('/settings/privacy');
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprivacy/);
    await page.getByLabel('Username or phone').fill(phone.replace('+1555', '+1 555 '));
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/settings\/privacy$/);
    await expect(page.getByRole('link', { name: /Last seen and online/ })).toBeVisible();
  });
});
