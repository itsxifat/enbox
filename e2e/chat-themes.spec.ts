/**
 * Chat themes (P2): the device preset persists across reloads; a shared theme reaches the
 * other member live with its system message; a private wallpaper stays on my side only.
 */
import { expect, test, type Page } from '@playwright/test';
import type { ChatSummary } from '@enbox/shared';
import { apiAs, directChat, makeContacts, openAs, registerUser, sendAs } from './helpers';

async function openThemeSheet(page: Page) {
  await page.getByRole('button', { name: 'Chat menu' }).click();
  await page.getByRole('menuitem', { name: 'Chat theme' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chat theme' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('chat themes', () => {
  test('device chat theme preset persists across reloads', async ({ browser }) => {
    const user = await registerUser({ displayName: 'Theme Device' });
    const { page, context } = await openAs(browser, user, '/settings/chats/theme');
    const grid = page.getByRole('radiogroup', { name: 'Chat theme' });
    await grid.getByRole('radio', { name: 'Ocean' }).click();
    await expect(grid.getByRole('radio', { name: 'Ocean' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.reload();
    await expect(
      page.getByRole('radiogroup', { name: 'Chat theme' }).getByRole('radio', { name: 'Ocean' }),
    ).toHaveAttribute('aria-checked', 'true');
    // The device preset's variables sit on <html> (lists and previews follow them too).
    const bubble = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--bubble-out'),
    );
    expect(bubble).not.toBe('');
    await context.close();
  });

  test('a shared theme reaches the other member with a system message', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Avery Theme' });
    const b = await registerUser({ displayName: 'Blake Theme' });
    await makeContacts(a, b);
    const chatId = await directChat(a, b);
    await sendAs(a, chatId, { type: 'text', text: 'Let me pick a theme' });

    const B = await openAs(browser, b, `/chats/${chatId}`);
    await expect(B.page.getByTestId('message').filter({ hasText: 'pick a theme' })).toBeVisible();
    const A = await openAs(browser, a, `/chats/${chatId}`);

    const dialog = await openThemeSheet(A.page);
    await dialog.getByRole('radio', { name: 'For everyone' }).click();
    await dialog
      .getByRole('radiogroup', { name: 'Chat theme' })
      .getByRole('radio', { name: 'Ocean' })
      .click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    // B sees the system message live and renders the shared preset.
    const pill = B.page
      .getByTestId('message')
      .filter({ hasText: 'Avery Theme changed the chat theme to Ocean' });
    await expect(pill).toBeVisible();
    await expect
      .poll(() =>
        B.page.evaluate(() =>
          getComputedStyle(document.querySelector('[data-testid="conversation"]')!)
            .getPropertyValue('--bubble-out')
            .trim(),
        ),
      )
      .not.toBe('');
    const seenByB = await apiAs<ChatSummary>(b, 'GET', `/api/chats/${chatId}`);
    expect(seenByB.sharedTheme?.preset).toBe('ocean');

    await A.context.close();
    await B.context.close();
  });

  test('a private wallpaper preset is mine only', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Avery Wall' });
    const b = await registerUser({ displayName: 'Blake Wall' });
    await makeContacts(a, b);
    const chatId = await directChat(a, b);
    await sendAs(a, chatId, { type: 'text', text: 'Wallpaper time' });

    const A = await openAs(browser, a, `/chats/${chatId}`);
    const B = await openAs(browser, b, `/chats/${chatId}`);
    await expect(B.page.getByTestId('message').filter({ hasText: 'Wallpaper time' })).toBeVisible();

    const dialog = await openThemeSheet(A.page);
    await dialog
      .getByRole('radiogroup', { name: 'Wallpaper' })
      .getByRole('radio', { name: 'Mint' })
      .click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect(A.page.getByTestId('conversation')).toHaveAttribute(
      'data-wallpaper-preset',
      'mint',
    );
    const mine = await apiAs<ChatSummary>(a, 'GET', `/api/chats/${chatId}`);
    expect(mine.theme?.wallpaper).toEqual({ kind: 'preset', id: 'mint' });
    // Nothing shared: B keeps the default and no system message was posted.
    await expect(B.page.getByTestId('conversation')).toHaveAttribute(
      'data-wallpaper-preset',
      'default',
    );
    const theirs = await apiAs<ChatSummary>(b, 'GET', `/api/chats/${chatId}`);
    expect(theirs.sharedTheme).toBeNull();
    expect(theirs.theme).toBeNull();
    await expect(B.page.getByTestId('message').filter({ hasText: 'chat theme' })).toHaveCount(0);

    await A.context.close();
    await B.context.close();
  });
});
