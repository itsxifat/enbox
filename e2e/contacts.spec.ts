import { expect, test, type Page } from '@playwright/test';
import type { ChatSummary, Contact } from '@enbox/shared';
import { apiAs, makeContacts, openAs, registerUser, uniqueName } from './helpers';

/** Open the contact info panel from the conversation header. */
async function openContactInfo(page: Page, name: string | RegExp) {
  await page.locator('main').getByRole('button', { name }).first().click();
  await expect(page.getByTestId('contact-info')).toBeVisible();
}

test.describe('contacts & new chat', () => {
  test('add a contact by username, then start a chat from /new', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Ari Adder' });
    const b = await registerUser({ displayName: 'Bea Found' });
    const { page, context } = await openAs(browser, a, '/new');

    await expect(page.getByText('No contacts yet')).toBeVisible();
    await page.getByTestId('new-contact').click();
    const dialog = page.getByRole('dialog', { name: 'New contact' });
    await dialog.getByLabel('Username', { exact: true }).fill(`@${b.user.username}`);
    await dialog.getByLabel('Save as').fill('Bea from work');
    await dialog.getByRole('button', { name: 'Add contact' }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('button', { name: 'Chat with Bea from work' });
    await expect(row).toBeVisible();
    await expect(page.getByText('1 contact', { exact: true })).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    const contacts = await apiAs<Contact[]>(a, 'GET', '/api/contacts');
    expect(contacts.map((c) => [c.user.id, c.name])).toEqual([[b.user.id, 'Bea from work']]);
    await context.close();
  });

  test('unknown username shows a helpful error', async ({ browser }) => {
    const a = await registerUser();
    const { page, context } = await openAs(browser, a, '/new');
    await page.getByTestId('new-contact').click();
    const dialog = page.getByRole('dialog', { name: 'New contact' });
    await dialog.getByLabel('Username', { exact: true }).fill(uniqueName('nobody'));
    await dialog.getByRole('button', { name: 'Add contact' }).click();
    await expect(dialog.getByRole('alert')).toContainText('No one on Enbox uses');
    await context.close();
  });

  test('search finds someone by exact username and opens the chat; message yourself', async ({
    browser,
  }) => {
    const a = await registerUser({ displayName: 'Searcher' });
    const b = await registerUser({ displayName: 'Hidden Gem' });
    const { page, context } = await openAs(browser, a, '/new');

    await page.getByRole('searchbox').fill(b.user.username);
    await expect(page.getByText('Other people on Enbox')).toBeVisible();
    await page.getByRole('button', { name: 'Chat with Hidden Gem' }).click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);

    await page.goto('/new');
    await page.getByRole('button', { name: /Message yourself/ }).click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    const selfId = page.url().split('/').pop()!;
    const chat = await apiAs<ChatSummary>(a, 'GET', `/api/chats/${selfId}`);
    expect(chat.peer?.id).toBe(a.user.id);
    await context.close();
  });

  test('rename and delete a contact from the list menu', async ({ browser }) => {
    const a = await registerUser();
    const b = await registerUser({ displayName: 'Rory Rename' });
    await apiAs(a, 'POST', '/api/contacts', { userId: b.user.id });
    const { page, context } = await openAs(browser, a, '/new');

    await page.getByRole('button', { name: 'More options for Rory Rename' }).click();
    await page.getByRole('menuitem', { name: 'Edit name' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit contact' });
    await dialog.getByLabel('Name').fill('Rory (climbing)');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Chat with Rory (climbing)' })).toBeVisible();

    await page.getByRole('button', { name: 'More options for Rory (climbing)' }).click();
    await page.getByRole('menuitem', { name: 'Delete contact' }).click();
    await page
      .getByRole('dialog', { name: /from your contacts/ })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page.getByRole('button', { name: /Chat with Rory/ })).toHaveCount(0);
    await expect(page.getByText('No contacts yet')).toBeVisible();
    await context.close();
  });

  test('blocking from contact info disables the composer; unblocking restores it', async ({
    browser,
  }) => {
    const a = await registerUser({ displayName: 'Blocker Bo' });
    const b = await registerUser({ displayName: 'Pesky Pat' });
    await makeContacts(a, b);
    const chat = await apiAs<ChatSummary>(a, 'POST', '/api/chats/direct', { userId: b.user.id });
    await apiAs(b, 'POST', '/api/chats/direct', { userId: a.user.id });
    await apiAs(b, 'POST', `/api/chats/${chat.id}/messages`, {
      clientId: uniqueName('c'),
      type: 'text',
      text: 'hello?',
    });

    const { page, context } = await openAs(browser, a, `/chats/${chat.id}`);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await openContactInfo(page, /Pesky Pat/);

    await page.getByTestId('block-contact').click();
    await page
      .getByRole('dialog', { name: 'Block Pesky Pat?' })
      .getByRole('button', { name: 'Block', exact: true })
      .click();
    await expect(page.getByTestId('unblock-contact')).toBeVisible();

    // The composer is replaced by the blocked notice (permissions.canSend = false).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    await expect(page.getByText(/unblock/i).first()).toBeVisible();

    // The block is listed in Settings → Privacy → Blocked contacts, and can be undone there.
    await page.goto('/settings/privacy/blocked');
    const blocked = page.getByTestId('blocked-list');
    await expect(blocked.getByText('Pesky Pat')).toBeVisible();
    await blocked.getByRole('button', { name: 'Unblock Pesky Pat' }).click();
    await page
      .getByRole('dialog', { name: 'Unblock Pesky Pat?' })
      .getByRole('button', { name: 'Unblock', exact: true })
      .click();
    await expect(page.getByText('No blocked contacts')).toBeVisible();

    await page.goto(`/chats/${chat.id}`);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await context.close();
  });

  test('contact info shows media, mute and disappearing messages', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Mia Media' });
    const b = await registerUser({ displayName: 'Nico Notes' });
    await makeContacts(a, b);
    const chat = await apiAs<ChatSummary>(a, 'POST', '/api/chats/direct', { userId: b.user.id });
    await apiAs(a, 'POST', `/api/chats/${chat.id}/messages`, {
      clientId: uniqueName('c'),
      type: 'text',
      text: 'Docs are at https://example.com/docs',
    });

    const { page, context } = await openAs(browser, a, `/chats/${chat.id}`);
    await openContactInfo(page, /Nico Notes/);
    await expect(page.getByTestId('media-row')).toContainText('1');

    // Mute for 8 hours.
    await page.getByRole('switch', { name: 'Mute notifications' }).click();
    await page
      .getByRole('dialog', { name: 'Mute notifications' })
      .getByRole('button', { name: '8 hours' })
      .click();
    await expect(page.getByText(/Muted until/)).toBeVisible();

    // Disappearing messages → 24 hours (system message + chat:updated).
    await page.getByRole('button', { name: /Disappearing messages/ }).click();
    await page
      .getByRole('dialog', { name: 'Disappearing messages' })
      .getByRole('button', { name: '24 hours' })
      .click();
    await expect(page.getByRole('button', { name: /Disappearing messages/ })).toContainText(
      '24 hours',
    );
    const updated = await apiAs<ChatSummary>(a, 'GET', `/api/chats/${chat.id}`);
    expect(updated.disappearingSeconds).toBe(86_400);
    expect(updated.mutedUntil).not.toBeNull();

    // Gallery → Links tab lists the shared link.
    await page.getByTestId('media-row').click();
    await page.getByRole('tab', { name: 'Links' }).click();
    await expect(page.getByRole('link', { name: /example\.com/ })).toBeVisible();
    await context.close();
  });
});
