import { deflateSync } from 'node:zlib';
import { expect, request as pwRequest, test } from '@playwright/test';
import type { AuthResponse, ChatSummary, UserSelf } from '@enbox/shared';
import { API_URL, apiAs, makeContacts, openAs, registerUser, uniqueName } from './helpers';

/** A small RGB gradient PNG (fixture for the avatar upload). */
function makePng(width: number, height: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = 109 + x;
      raw[o + 1] = 93 + y;
      raw[o + 2] = 200;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Log in again through the API: a second session ("linked device") for the same user. */
async function secondSession(
  username: string,
  password: string,
  deviceName: string,
): Promise<string> {
  const ctx = await pwRequest.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/auth/login', {
    data: { identifier: username, password, deviceName },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as AuthResponse;
  await ctx.dispose();
  return body.token;
}

/** A direct chat between a and b that is visible to both (a sends the first message). */
async function directChat(a: { token: string }, b: { user: { id: string } }): Promise<ChatSummary> {
  const chat = await apiAs<ChatSummary>(a, 'POST', '/api/chats/direct', { userId: b.user.id });
  await apiAs(a, 'POST', `/api/chats/${chat.id}/messages`, {
    clientId: uniqueName('c'),
    type: 'text',
    text: 'Hi there 👋',
  });
  return chat;
}

test.describe('settings', () => {
  test('profile name change is reflected live for a contact viewing the chat', async ({
    browser,
  }) => {
    const a = await registerUser({ displayName: 'Avery Stone' });
    const b = await registerUser({ displayName: 'Blake Hart' });
    await makeContacts(a, b);
    const chat = await directChat(a, b);

    // B looks at A's contact info.
    const B = await openAs(browser, b, `/chats/${chat.id}`);
    await B.page
      .locator('main')
      .getByRole('button', { name: /Avery Stone/ })
      .first()
      .click();
    await expect(B.page.getByTestId('contact-name')).toHaveText('Avery Stone');

    // A renames themself in Settings → Profile.
    const A = await openAs(browser, a, '/settings/profile');
    await A.page.getByTestId('profile-name').click();
    const dialog = A.page.getByRole('dialog', { name: 'Edit name' });
    await dialog.getByLabel('Your name').fill('Avery Stone-Ray');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(A.page.getByTestId('profile-name')).toContainText('Avery Stone-Ray');

    // B sees it without reloading (user:changed → refetch → chat peer patched).
    await expect(B.page.getByTestId('contact-name')).toHaveText('Avery Stone-Ray');

    // About presets also save.
    await A.page.getByTestId('profile-about').click();
    await A.page.getByRole('button', { name: 'At the gym' }).click();
    await expect(A.page.getByTestId('current-about')).toHaveText('At the gym');
    await expect(B.page.getByTestId('contact-about')).toHaveText('At the gym');

    await A.context.close();
    await B.context.close();
  });

  test('profile photo: upload with crop, then remove', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Photo Person' });
    const { page, context } = await openAs(browser, user, '/settings/profile');
    await page.getByTestId('avatar-file-input').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: makePng(120, 90),
    });
    const crop = page.getByRole('dialog', { name: 'Crop your photo' });
    await expect(crop.getByRole('button', { name: 'Set photo' })).toBeEnabled();
    await crop.getByRole('slider', { name: 'Zoom' }).fill('1.5');
    await crop.getByRole('button', { name: 'Set photo' }).click();
    await expect(crop).toBeHidden();

    await expect
      .poll(async () => (await apiAs<UserSelf>(user, 'GET', '/api/me')).avatarUrl)
      .toMatch(/^\/uploads\/.+\.jpe?g$/);
    await expect(
      page.getByRole('button', { name: 'Change profile photo' }).locator('img'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Change profile photo' }).click();
    await page.getByRole('menuitem', { name: 'Remove photo' }).click();
    await page
      .getByRole('dialog', { name: 'Remove profile photo?' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByRole('button', { name: 'Add profile photo' })).toBeVisible();
    expect((await apiAs<UserSelf>(user, 'GET', '/api/me')).avatarUrl).toBeNull();
    await context.close();
  });

  test('username change shows live availability', async ({ browser }) => {
    const taken = await registerUser();
    const user = await registerUser();
    const { page, context } = await openAs(browser, user, '/settings/profile');
    await page.getByTestId('profile-username').click();
    const dialog = page.getByRole('dialog', { name: 'Edit username' });
    const input = dialog.getByLabel('Username');
    await input.fill(taken.user.username);
    await expect(dialog.getByTestId('username-availability')).toHaveText(/is taken/);
    const fresh = uniqueName('free');
    await input.fill(fresh);
    await expect(dialog.getByTestId('username-availability')).toHaveText(/is available/);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('profile-username')).toContainText(`@${fresh}`);
    await context.close();
  });

  test('hiding last seen & online removes presence for the other user', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Casey Private' });
    const b = await registerUser({ displayName: 'Dana Viewer' });
    await makeContacts(a, b);
    const chat = await directChat(a, b);

    // A is online in a browser.
    const A = await openAs(browser, a, '/settings/privacy');
    const B = await openAs(browser, b, `/chats/${chat.id}`);
    await B.page
      .locator('main')
      .getByRole('button', { name: /Casey Private/ })
      .first()
      .click();
    await expect(B.page.getByTestId('contact-presence')).toHaveText('online');

    // A: Privacy → Last seen and online → Nobody + Same as last seen.
    await A.page.getByTestId('privacy-last-seen').click();
    await A.page
      .getByRole('group', { name: 'Who can see my last seen' })
      .getByLabel('Nobody')
      .check();
    await A.page
      .getByRole('group', { name: "Who can see when I'm online" })
      .getByLabel('Same as last seen')
      .check();
    await expect
      .poll(
        async () =>
          (
            await apiAs<{ settings: { lastSeenVisibility: string; onlineVisibility: string } }>(
              a,
              'GET',
              '/api/me',
            )
          ).settings,
      )
      .toMatchObject({ lastSeenVisibility: 'nobody', onlineVisibility: 'same_as_last_seen' });

    // B no longer sees any presence (live presence:update with online: null).
    await expect(B.page.getByTestId('contact-presence')).toHaveCount(0);

    await A.context.close();
    await B.context.close();
  });

  test('linked devices lists both sessions and revoking one logs it out', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Multi Device' });
    const otherToken = await secondSession(user.user.username, user.password, 'Second laptop');

    const other = await openAs(browser, { token: otherToken }, '/chats');
    await expect(other.page).toHaveURL(/\/chats/);

    const main = await openAs(browser, user, '/settings/devices');
    const list = main.page.getByTestId('sessions-list');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByText('This device')).toBeVisible();

    await list.getByRole('button', { name: /Second laptop/ }).click();
    await main.page
      .getByRole('dialog', { name: /Log out Second laptop/ })
      .getByRole('button', { name: 'Log out', exact: true })
      .click();
    await expect(list.getByRole('listitem')).toHaveCount(1);

    // The revoked device is signed out in realtime (session:revoked).
    await expect(other.page).toHaveURL(/\/login/);

    await main.context.close();
    await other.context.close();
  });

  test('change password logs out the other devices', async ({ browser }) => {
    const user = await registerUser();
    const otherToken = await secondSession(user.user.username, user.password, 'Tablet');
    const other = await openAs(browser, { token: otherToken }, '/chats');
    await expect(other.page).toHaveURL(/\/chats/);

    const main = await openAs(browser, user, '/settings/account/password');
    await main.page.getByLabel('Current password').fill(user.password);
    await main.page.getByLabel('New password', { exact: true }).fill('a-better-passw0rd!');
    await main.page.getByLabel('Confirm new password').fill('a-better-passw0rd!');
    await main.page.getByRole('button', { name: 'Change password' }).click();
    await expect(main.page).toHaveURL(/\/settings\/account$/);
    await expect(other.page).toHaveURL(/\/login/);

    await main.context.close();
    await other.context.close();
  });

  test('chat preferences persist per device (theme, wallpaper, enter to send)', async ({
    browser,
  }) => {
    const user = await registerUser();
    const { page, context } = await openAs(browser, user, '/settings/chats');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('radio', { name: 'Mint' }).click();
    await expect(page.getByRole('radio', { name: 'Mint' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('switch', { name: 'Enter is send' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('switch', { name: 'Enter is send' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await context.close();
  });

  test('delete account requires the password and signs out', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Leaving Soon' });
    const { page, context } = await openAs(browser, user, '/settings/account');
    await page.getByTestId('delete-account-row').click();
    const submit = page.getByRole('button', { name: 'Delete my account' });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Confirm with your password').fill('wrong-password');
    await page.getByText("I understand this can't be undone").click();
    await submit.click();
    await page
      .getByRole('dialog', { name: 'Delete your account permanently?' })
      .getByRole('button', { name: 'Delete account' })
      .click();
    await expect(page.getByRole('alert')).toContainText(/incorrect password/i);

    await page.getByLabel('Confirm with your password').fill(user.password);
    await submit.click();
    await page
      .getByRole('dialog', { name: 'Delete your account permanently?' })
      .getByRole('button', { name: 'Delete account' })
      .click();
    await expect(page).toHaveURL(/\/login/);

    // The account can no longer log in.
    const res = await pwRequest.newContext({ baseURL: API_URL });
    const login = await res.post('/api/auth/login', {
      data: { identifier: user.user.username, password: user.password },
    });
    expect(login.status()).toBe(401);
    await res.dispose();
    await context.close();
  });
});
