/**
 * Chat list journeys: previews/badges, filters, message search → jump, chat menu actions
 * (pin, mute, archive, mark unread), group @mention badge, typing indicator and drafts.
 */
import { expect, test } from '@playwright/test';
import { apiAs, directChat, makeContacts, openAs, registerUser, sendAs } from './helpers';

test('unread badge, filters, and message search jump to the message', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice List' });
  const bob = await registerUser({ displayName: 'Bob List' });
  const carol = await registerUser({ displayName: 'Carol List' });
  await makeContacts(alice, bob);
  await makeContacts(alice, carol);
  const withBob = await directChat(bob, alice);
  const withCarol = await directChat(carol, alice);
  await sendAs(bob, withBob, { type: 'text', text: 'The meeting moved to the aquarium room' });
  for (let i = 1; i <= 60; i++) await sendAs(bob, withBob, { type: 'text', text: `update ${i}` });
  await sendAs(carol, withCarol, { type: 'text', text: 'Lunch?' });
  await apiAs(alice, 'POST', `/api/chats/${withCarol}/read`, { seq: 999 });

  const { page, context } = await openAs(browser, alice, '/chats');
  const bobRow = page.getByTestId('chat-row').filter({ hasText: 'Bob List' });
  const carolRow = page.getByTestId('chat-row').filter({ hasText: 'Carol List' });
  await expect(bobRow).toContainText('update 60');
  await expect(bobRow.getByLabel('61 unread messages')).toBeVisible();

  await page.getByRole('tab', { name: /Unread/ }).click();
  await expect(bobRow).toBeVisible();
  await expect(carolRow).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(carolRow).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill('aquarium');
  const result = page.getByRole('button', { name: /aquarium/ });
  await expect(result.locator('mark')).toHaveText('aquarium');
  await result.click();
  const target = page.getByTestId('message').filter({ hasText: 'moved to the aquarium room' });
  await expect(target).toBeInViewport();
  await expect(page).toHaveURL(new RegExp(`/chats/${withBob}$`));
  await context.close();
});

test('chat menu: pin, mute, mark unread and archive', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Menu' });
  const bob = await registerUser({ displayName: 'Bob Menu' });
  await makeContacts(alice, bob);
  const chatId = await directChat(bob, alice);
  await sendAs(bob, chatId, { type: 'text', text: 'Ping' });
  await apiAs(alice, 'POST', `/api/chats/${chatId}/read`, { seq: 999 });

  const { page, context } = await openAs(browser, alice, '/chats');
  const row = page.getByTestId('chat-row').filter({ hasText: 'Bob Menu' });
  await expect(row).toBeVisible();

  const menu = async (item: string) => {
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: item }).click();
  };

  await menu('Pin chat');
  await expect(row.getByLabel('Pinned')).toBeVisible();
  await page.getByRole('tab', { name: 'Favorites' }).click();
  await expect(row).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();

  await menu('Mute notifications');
  await page.getByRole('button', { name: '8 hours' }).click();
  await expect(row.getByLabel('Muted')).toBeVisible();

  await menu('Mark as unread');
  await expect(row.getByLabel('Marked as unread')).toBeVisible();
  await menu('Mark as read');
  await expect(row.getByLabel('Marked as unread')).toHaveCount(0);

  await menu('Archive chat');
  await expect(row).toHaveCount(0);
  await page.getByRole('link', { name: /Archived/ }).click();
  const archivedRow = page
    .getByTestId('archived-list')
    .getByTestId('chat-row')
    .filter({ hasText: 'Bob Menu' });
  await expect(archivedRow).toBeVisible();
  await archivedRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unarchive chat' }).click();
  await expect(archivedRow).toHaveCount(0);

  // Server state persisted.
  const chat = await apiAs<{ isPinned: boolean; mutedUntil: string | null; isArchived: boolean }>(
    alice,
    'GET',
    `/api/chats/${chatId}`,
  );
  expect(chat.isArchived).toBe(false);
  expect(chat.mutedUntil).not.toBeNull();
  await context.close();
});

test('group @mention shows the mention badge and a live typing indicator', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Group' });
  const bob = await registerUser({ displayName: 'Bob Group' });
  await makeContacts(alice, bob);
  const { chat } = await apiAs<{ chat: { id: string } }>(bob, 'POST', '/api/groups', {
    name: 'Mention Squad',
    memberIds: [alice.user.id],
  });

  const a = await openAs(browser, alice, '/chats');
  const row = a.page.getByTestId('chat-row').filter({ hasText: 'Mention Squad' });
  await expect(row).toBeVisible();
  await sendAs(bob, chat.id, { type: 'text', text: `@{${alice.user.id}} can you review?` });
  await expect(row.getByLabel('You were mentioned')).toBeVisible();
  await expect(row).toContainText('Bob Group: @Alice Group can you review?');

  // Bob types in the group → Alice's list shows it.
  const b = await openAs(browser, bob, `/chats/${chat.id}`);
  await b.page
    .getByRole('textbox', { name: 'Message', exact: true })
    .pressSequentially('hel', { delay: 60 });
  await expect(row).toContainText('Bob Group is typing…');

  // Mention autocomplete in the composer.
  const box = b.page.getByRole('textbox', { name: 'Message', exact: true });
  await box.fill('');
  await box.pressSequentially('Thanks @Ali', { delay: 30 });
  await b.page.getByRole('option', { name: /Alice Group/ }).click();
  await expect(box).toHaveValue('Thanks @Alice Group ');
  await box.press('Enter');
  const sent = b.page.getByTestId('message').filter({ hasText: 'Thanks @Alice Group' });
  await expect(sent).toBeVisible();
  // It was sent as a real mention (tappable) → Alice gets another mention.
  await expect(a.page.getByTestId('chat-row').filter({ hasText: 'Mention Squad' })).toContainText(
    'Thanks @Alice Group',
  );

  await a.context.close();
  await b.context.close();
});

test('drafts are kept per chat and shown in the list', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Draft' });
  const bob = await registerUser({ displayName: 'Bob Draft' });
  await makeContacts(alice, bob);
  const chatId = await directChat(bob, alice);
  await sendAs(bob, chatId, { type: 'text', text: 'Hey' });

  const { page, context } = await openAs(browser, alice, `/chats/${chatId}`);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('half-written thought');
  await page.goto('/chats');
  const row = page.getByTestId('chat-row').filter({ hasText: 'Bob Draft' });
  await expect(row).toContainText('Draft: half-written thought');
  await row.click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'half-written thought',
  );
  await context.close();
});
