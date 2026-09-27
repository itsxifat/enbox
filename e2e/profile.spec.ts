/**
 * P1 profiles & presence: banner upload, pronouns / bio, an animated GIF avatar (static poster
 * + the animation), do-not-disturb seen live by another user, and the profile card opened
 * from a group message sender.
 */
import { expect, test } from '@playwright/test';
import type { UserSelf } from '@enbox/shared';
import {
  apiAs,
  createGroupAs,
  directChat,
  gifFixture,
  makeContacts,
  openAs,
  pngFixture,
  registerUser,
  sendAs,
  type E2EUser,
} from './helpers';

const me = (u: E2EUser) => apiAs<UserSelf>(u, 'GET', '/api/me');

test.describe('profile', () => {
  test('banner: upload with crop, shown on the preview card, then remove', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Banner Person' });
    const { page, context } = await openAs(browser, user, '/settings/profile');
    await page.getByTestId('banner-file-input').setInputFiles({
      name: 'banner.png',
      mimeType: 'image/png',
      buffer: await pngFixture(600, 240, [14, 127, 192]),
    });
    const crop = page.getByRole('dialog', { name: 'Crop your banner' });
    await expect(crop.getByRole('button', { name: 'Set banner' })).toBeEnabled();
    await crop.getByRole('button', { name: 'Set banner' }).click();
    await expect(crop).toBeHidden();

    await expect
      .poll(async () => (await me(user)).bannerUrl)
      .toMatch(/^\/uploads\/.+\.(jpe?g|webp|png)$/);
    await expect(
      page.getByTestId('profile-preview').locator('[data-testid="card-banner"] img'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Change banner' }).click();
    await page.getByRole('menuitem', { name: 'Remove banner' }).click();
    await page
      .getByRole('dialog', { name: 'Remove banner?' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByRole('button', { name: 'Add banner' })).toBeVisible();
    await expect.poll(async () => (await me(user)).bannerUrl).toBeNull();
    await context.close();
  });

  test('pronouns and bio persist and show on the profile card', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Pia Person' });
    const { page, context } = await openAs(browser, user, '/settings/profile');
    await page.getByTestId('profile-pronouns').click();
    await page.getByRole('button', { name: 'they/them' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await me(user)).pronouns).toBe('they/them');

    await page.goto('/settings/profile/bio');
    await page.getByTestId('bio-input').fill('Climber.\nCoffee.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await me(user)).bio).toBe('Climber.\nCoffee.');

    await page.goto('/settings/profile');
    await expect(page.getByTestId('profile-pronouns')).toContainText('they/them');
    await expect(page.getByTestId('profile-bio')).toContainText('Climber.');
    const preview = page.getByTestId('profile-preview');
    await expect(preview.getByTestId('card-pronouns')).toHaveText('they/them');
    await expect(preview.getByTestId('card-bio')).toHaveText('Climber.\nCoffee.');
    await context.close();
  });

  test('an animated GIF avatar keeps a static poster and the animation', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Gif Person' });
    const { page, context } = await openAs(browser, user, '/settings/profile');
    await page.getByTestId('avatar-file-input').setInputFiles({
      name: 'me.gif',
      mimeType: 'image/gif',
      buffer: gifFixture(96, 96, 3),
    });
    const crop = page.getByRole('dialog', { name: 'Crop your photo' });
    await expect(crop.getByRole('button', { name: 'Set photo' })).toBeEnabled();
    await crop.getByRole('button', { name: 'Set photo' }).click();
    await expect(crop).toBeHidden();

    // `avatarUrl` is always the static poster; the GIF itself travels separately.
    await expect
      .poll(async () => (await me(user)).avatarUrl)
      .toMatch(/^\/uploads\/.+\.(jpe?g|webp)$/);
    expect((await me(user)).avatarAnimatedUrl).toMatch(/^\/uploads\/.+\.gif$/);
    // The preview card is an `animate: 'always'` surface (poster under reduced motion).
    await expect(
      page.getByTestId('profile-preview').locator('[data-testid="profile-card"] [data-animated]'),
    ).toHaveAttribute('data-animated', /^(playing|poster)$/);
    await context.close();
  });

  test('do not disturb chosen on A shows the red glyph and label in B’s chat', async ({
    browser,
  }) => {
    const a = await registerUser({ displayName: 'Dee Quiet' });
    const b = await registerUser({ displayName: 'Bea Viewer' });
    await makeContacts(a, b);
    const chatId = await directChat(a, b);
    await sendAs(a, chatId, { type: 'text', text: 'hi' });

    const A = await openAs(browser, a, '/chats');
    const B = await openAs(browser, b, `/chats/${chatId}`);
    await expect(B.page.getByTestId('chat-subtitle')).toHaveText('online');
    await expect(B.page.locator('main [data-presence="online"]').first()).toBeVisible();

    // A: nav rail avatar → self card → Do not disturb → until I change it.
    await A.page.getByRole('button', { name: 'Your profile' }).click();
    await A.page.getByRole('button', { name: 'Availability: Online' }).click();
    await A.page.getByRole('menuitem', { name: 'Do not disturb' }).click();
    await A.page.getByRole('menuitem', { name: 'Until I change it' }).click();
    await expect(
      A.page.getByRole('button', { name: 'Availability: Do not disturb' }),
    ).toBeVisible();
    await expect.poll(async () => (await me(a)).availability).toBe('dnd');

    // B sees it live (presence:update): the dnd glyph on the avatar and the subtitle.
    await expect(B.page.locator('main [data-presence="dnd"]').first()).toBeVisible();
    await expect(B.page.getByTestId('chat-subtitle')).toHaveText('do not disturb');

    await A.context.close();
    await B.context.close();
  });

  test('the profile card opens from a group message sender and shows the bio', async ({
    browser,
  }) => {
    const a = await registerUser({ displayName: 'Sam Sender' });
    const b = await registerUser({ displayName: 'Rae Reader' });
    await apiAs(a, 'PATCH', '/api/me', { bio: 'Sends messages for a living.', pronouns: 'he/him' });
    const group = await createGroupAs(a, 'Card group', [b]);
    await sendAs(a, group.id, { type: 'text', text: 'Hello group' });

    const B = await openAs(browser, b, `/chats/${group.id}`);
    await B.page.getByRole('button', { name: 'Profile of Sam Sender' }).first().click();
    const card = B.page.getByRole('dialog', { name: 'Profile' });
    await expect(card.getByTestId('card-name')).toHaveText('Sam Sender');
    await expect(card.getByTestId('card-bio')).toHaveText('Sends messages for a living.');
    await expect(card.getByTestId('card-pronouns')).toHaveText('he/him');
    await expect(card.getByTestId('card-common-groups')).toContainText('Card group');
    await expect(card.getByRole('button', { name: 'Message' })).toBeVisible();
    await B.page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await B.context.close();
  });
});
