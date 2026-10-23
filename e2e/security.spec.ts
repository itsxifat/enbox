import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, openAs, registerUser } from './helpers';

/** RFC 4648 base32 (no padding) → bytes. */
function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=-]/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit TOTP (RFC 6238, SHA-1, 30 s) of `secret` at `step`. */
function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1e6).padStart(6, '0');
}

const step = () => Math.floor(Date.now() / 30_000);

test.describe('two-factor sign-in', () => {
  test('turn it on in Settings: scan or type the key, confirm a code, save the backup codes', async ({
    browser,
  }) => {
    const user = await registerUser({ displayName: 'Mfa Setup' });
    const { context, page } = await openAs(browser, user, '/settings/account');
    await page.getByText('Enable Authenticator App', { exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account\/two-factor$/);
    await expect(page.getByText('Download an authenticator app').first()).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    const secret = (await page.getByLabel('Setup key').innerText()).replace(/\s/g, '');
    await page.getByRole('button', { name: 'Next' }).click();

    // The code is sent as soon as it has 6 digits (Activate is for a retry).
    await page.getByRole('textbox', { name: '6-digit code' }).fill(totp(secret, step()));
    const codes = page.getByRole('list', { name: 'Backup codes' });
    await expect(codes).toBeVisible();
    await expect(codes.getByRole('listitem')).toHaveCount(10);
    await page.getByRole('button', { name: "I've saved them" }).click();

    const me = await apiAs<{ mfaEnabled?: boolean }>(user, 'GET', '/api/me');
    expect(me.mfaEnabled).toBe(true);
    await context.close();
  });

  test('log in with the code step, after a wrong code', async ({ page }) => {
    const user = await registerUser({ displayName: 'Mfa Login' });
    const setup = await apiAs<{ secret: string }>(user, 'POST', '/api/me/mfa/totp/setup');
    const now = step();
    await apiAs(user, 'POST', '/api/me/mfa/totp/enable', { code: totp(setup.secret, now) });

    await page.goto('/login');
    await page.getByLabel('Username or phone').fill(user.user.username);
    await page.getByLabel('Password', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Multi-Factor Authentication')).toBeVisible();

    // The code that turned it on is used up; the next step's code works (±1 step window).
    await page.getByLabel('Authentication code').fill(totp(setup.secret, now));
    await expect(page.getByText('Invalid two-factor code')).toBeVisible();
    await page.getByLabel('Authentication code').fill(totp(setup.secret, now + 1));
    await expect(page).toHaveURL(/\/chats$/);
  });
});
