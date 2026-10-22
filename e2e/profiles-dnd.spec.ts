/**
 * Profiles, decorations and drag-and-drop (W3): equipping a decoration from Collectibles is
 * seen by another user on the message avatar; files dropped anywhere on a conversation land
 * in the attachment tray; the Quick Switcher jumps to a channel; a Space moves on the rail
 * from the keyboard and the order is saved for the account.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SpaceDetail, UserSelf } from '@enbox/shared';
import { apiAs, directChat, makeContacts, openAs, registerUser, sendAs, uniqueName } from './helpers';

const me = (u: Parameters<typeof apiAs>[0]) => apiAs<UserSelf>(u, 'GET', '/api/me');

/** Fire an OS-style file drag over the page and, unless `hold`, drop it. */
async function dragFile(page: Page, name: string, opts: { hold?: boolean; shift?: boolean } = {}) {
  await page.evaluate(
    ({ name, hold, shift }) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['dropped text'], name, { type: 'text/plain' }));
      const at = document.querySelector('[data-testid="message"]') ?? document.querySelector('main')!;
      for (const type of ['dragenter', 'dragover'])
        at.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      if (hold) return;
      const target = document.querySelector('[data-testid="drop-overlay"]') ?? at;
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, shiftKey: shift }),
      );
    },
    { name, hold: !!opts.hold, shift: !!opts.shift },
  );
}

test('a decoration equipped in Collectibles shows on my messages for someone else', async ({ browser }) => {
  const [ana, ben] = await Promise.all([
    registerUser({ displayName: 'Ana Deco' }),
    registerUser({ displayName: 'Ben Viewer' }),
  ]);
  await makeContacts(ana, ben);
  const chatId = await directChat(ana, ben);
  await sendAs(ana, chatId, { type: 'text', text: 'look at my halo' });

  const A = await openAs(browser, ana, '/collectibles');
  await A.page.getByRole('button', { name: 'Halo, Avatar Decoration' }).click();
  const details = A.page.getByRole('dialog', { name: 'Halo' });
  await expect(details.getByTestId('try-on')).toBeVisible();
  await details.getByRole('button', { name: 'Equip' }).click();
  await expect(details.getByRole('button', { name: 'Unequip' })).toBeVisible();
  await expect.poll(async () => (await me(ana)).avatarDecoration).toBe('halo');
  await A.page.keyboard.press('Escape');
  await expect(A.page.getByRole('button', { name: 'Halo, Avatar Decoration, equipped' })).toBeVisible();

  // Ben sees it on Ana's message avatar; a nameplate equipped later arrives live too.
  const B = await openAs(browser, ben, `/chats/${chatId}`);
  const row = B.page.getByTestId('message').filter({ hasText: 'look at my halo' });
  await expect(row.locator('svg[data-decoration="halo"]')).toBeAttached();
  await apiAs(ana, 'PATCH', '/api/me', { avatarDecoration: 'crown' });
  await expect(row.locator('svg[data-decoration="crown"]')).toBeAttached();

  await A.context.close();
  await B.context.close();
});

test('files dropped anywhere on a conversation go to the tray; Shift-drop sends at once', async ({ browser }) => {
  const [ana, ben] = await Promise.all([registerUser(), registerUser({ displayName: 'Ben Drop' })]);
  await makeContacts(ana, ben);
  const chatId = await directChat(ben, ana);
  await sendAs(ben, chatId, { type: 'text', text: 'send me the file' });

  const A = await openAs(browser, ana, `/chats/${chatId}`);
  await expect(A.page.getByTestId('message').first()).toBeVisible();

  await dragFile(A.page, 'held.txt', { hold: true });
  const overlay = A.page.getByTestId('drop-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Upload to @Ben Drop');
  await A.page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  // The cancelled drag leaves the window (browsers send dragleave), ending it.
  await A.page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'held.txt', { type: 'text/plain' }));
    document.querySelector('main')!.dispatchEvent(
      new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  });

  await dragFile(A.page, 'report.txt');
  await expect(A.page.getByTestId('attachment-tile')).toContainText('report.txt');
  const box = A.page.getByRole('textbox', { name: 'Message' });
  await box.fill('here it is');
  await box.press('Enter');
  const sent = A.page.getByTestId('message').filter({ hasText: 'report.txt' });
  await expect(sent).toBeVisible();
  await expect(sent).toContainText('here it is');

  await dragFile(A.page, 'direct.txt', { shift: true });
  await expect(A.page.getByTestId('message').filter({ hasText: 'direct.txt' })).toBeVisible();
  await expect(A.page.getByTestId('attachment-tray')).toHaveCount(0);
  await A.context.close();
});

test('Ctrl+K opens the Quick Switcher and jumps to a Space channel', async ({ browser }) => {
  const ana = await registerUser();
  const name = `Switch ${uniqueName('s')}`;
  const detail = await apiAs<SpaceDetail>(ana, 'POST', '/api/spaces', { name });
  const general = detail.channels.find((c) => c.type === 'space_text')!;

  const A = await openAs(browser, ana, '/chats');
  await expect(A.page.getByTestId('home-sidebar')).toBeVisible();
  const input = A.page.getByRole('combobox', { name: 'Where would you like to go?' });
  // The shortcuts load with the app shell's lazy chunks: retry until they are listening.
  await expect(async () => {
    if (!(await input.isVisible())) await A.page.keyboard.press('Control+k');
    await expect(input).toBeFocused({ timeout: 1_500 });
  }).toPass();
  await input.fill(`#${general.name}`);
  const result = A.page.getByTestId('switcher-result').filter({ hasText: name });
  await expect(result).toBeVisible();
  await input.press('Enter');
  await expect(A.page).toHaveURL(new RegExp(`/spaces/${detail.space.id}/${general.id}$`));
  await expect(A.page.getByTestId('quick-switcher')).toHaveCount(0);
  await A.context.close();
});

test('Alt+Shift+Down moves a Space down the rail and the order is saved', async ({ browser }) => {
  const ana = await registerUser();
  const first = await apiAs<SpaceDetail>(ana, 'POST', '/api/spaces', { name: `Alpha ${uniqueName('r')}` });
  const second = await apiAs<SpaceDetail>(ana, 'POST', '/api/spaces', { name: `Beta ${uniqueName('r')}` });

  // Tile names start with the Space's name (badge words may follow).
  const named = (n: string) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const A = await openAs(browser, ana, '/chats');
  const tiles = A.page.getByTestId('space-tile');
  await expect(tiles).toHaveCount(2);
  // Spaces not placed yet show newest first: Beta, then Alpha.
  await expect(tiles.first()).toHaveAccessibleName(named(second.space.name));
  await tiles.first().focus();
  await A.page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(tiles.first()).toHaveAccessibleName(named(first.space.name));
  await expect
    .poll(async () => ((await me(ana)).railLayout ?? []).map((e) => (e.kind === 'space' ? e.id : e.folder.id)))
    .toEqual([first.space.id, second.space.id]);
  // Still in that order after a reload (applied from the account, not this tab).
  await A.page.reload();
  await expect(tiles.first()).toHaveAccessibleName(named(first.space.name));
  await A.context.close();
});
