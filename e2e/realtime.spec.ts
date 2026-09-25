/**
 * Cross-user realtime state: unread counters stay right while events arrive (chat:upsert
 * before message:new, deletes of unread mentions). A peer's account deletion turning the chat
 * read-only live is covered in contacts.spec.ts.
 */
import { expect, test } from '@playwright/test';
import { apiAs, makeContacts, openAs, registerUser, sendAs } from './helpers';

test('the first message of a new direct chat is counted once', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice First' });
  const bob = await registerUser({ displayName: 'Bob First' });
  await makeContacts(alice, bob);

  const { page, context } = await openAs(browser, alice, '/chats');
  await expect(page.getByTestId('chat-list')).toBeVisible();
  // Bob opens a new chat with Alice and writes: Alice gets chat:upsert (already counting
  // the message), then message:new.
  const chat = await apiAs<{ id: string }>(bob, 'POST', '/api/chats/direct', {
    userId: alice.user.id,
  });
  await sendAs(bob, chat.id, { type: 'text', text: 'Hi Alice, long time!' });

  const row = page.getByTestId('chat-row').filter({ hasText: 'Bob First' });
  await expect(row).toContainText('Hi Alice, long time!');
  await expect(row.getByLabel('1 unread message', { exact: true })).toBeVisible();
  await expect(row.getByLabel('2 unread messages')).toHaveCount(0);
  await context.close();
});

test('deleting an unread @mention for everyone clears the mention badge', async ({
  browser,
}) => {
  const alice = await registerUser({ displayName: 'Alice Badge' });
  const carol = await registerUser({ displayName: 'Carol Badge' });
  await makeContacts(alice, carol);
  const { chat } = await apiAs<{ chat: { id: string } }>(carol, 'POST', '/api/groups', {
    name: 'Badge Squad',
    memberIds: [alice.user.id],
  });

  const { page, context } = await openAs(browser, alice, '/chats');
  const row = page.getByTestId('chat-row').filter({ hasText: 'Badge Squad' });
  await expect(row).toBeVisible();
  const m = await sendAs(carol, chat.id, {
    type: 'text',
    text: `@{${alice.user.id}} are you there?`,
  });
  await expect(row.getByLabel('You were mentioned')).toBeVisible();

  await apiAs(carol, 'DELETE', `/api/messages/${m.id}?for=everyone`);
  await expect(row.getByLabel('You were mentioned')).toHaveCount(0);
  await context.close();
});
