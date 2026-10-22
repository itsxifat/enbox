/**
 * The expressions and social wave: several reactions per person with live counts, friend
 * requests through Add Friend and Pending, an @mention in the Inbox with Jump, a thread
 * started from a message, and a custom Space emoji rendered in a message.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SpaceDetail } from '@enbox/shared';
import { apiAs, openAs, pngFixture, registerUser, sendAs, uniqueName, uploadAs, type E2EUser } from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[]): Promise<{ detail: SpaceDetail; general: string }> {
  const detail = await apiAs<SpaceDetail>(owner, 'POST', '/api/spaces', { name: `Club ${uniqueName('x')}` });
  const invite = await apiAs<{ code: string }>(owner, 'POST', `/api/spaces/${detail.space.id}/invites`, {});
  for (const m of members) await apiAs(m, 'POST', `/api/invites/${invite.code}/join`);
  return { detail, general: detail.channels.find((c) => c.type === 'space_text')!.id };
}

const row = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

test('several reactions per person, live counts on both sides', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser({ displayName: 'Ann React' }), registerUser({ displayName: 'Bob React' })]);
  const { detail, general } = await spaceWith(ann, [bob]);
  const msg = await sendAs<{ id: string }>(bob, general, { type: 'text', text: 'react to this' });
  await apiAs(ann, 'PUT', `/api/messages/${msg.id}/reactions/${encodeURIComponent('👍')}/@me`);
  await apiAs(ann, 'PUT', `/api/messages/${msg.id}/reactions/${encodeURIComponent('🎉')}/@me`);

  const B = await openAs(browser, bob, `/spaces/${detail.space.id}/${general}`);
  const reactions = row(B.page, 'react to this').getByTestId('reactions');
  await expect(reactions.getByRole('button', { name: /👍, 1 reaction$/ })).toBeVisible();
  await expect(reactions.getByRole('button', { name: /🎉, 1 reaction$/ })).toBeVisible();
  // Bob joins 👍 by clicking the chip: 2, including his.
  await reactions.getByRole('button', { name: /👍, 1 reaction$/ }).click();
  await expect(reactions.getByRole('button', { name: '👍, 2 reactions, including yours' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Ann (another browser) sees Bob's join live, then removes her 🎉.
  const A = await openAs(browser, ann, `/spaces/${detail.space.id}/${general}`);
  const annReactions = row(A.page, 'react to this').getByTestId('reactions');
  await expect(annReactions.getByRole('button', { name: '👍, 2 reactions, including yours' })).toBeVisible();
  await annReactions.getByRole('button', { name: '🎉, 1 reaction, including yours' }).click();
  await expect(annReactions.getByRole('button', { name: /🎉/ })).toHaveCount(0);
  await expect(reactions.getByRole('button', { name: /🎉/ })).toHaveCount(0);
  await A.context.close();
  await B.context.close();
});

test('a friend request by username, accepted from Pending', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser({ displayName: 'Ann Friend' }), registerUser({ displayName: 'Bob Friend' })]);
  const A = await openAs(browser, ann, '/chats');
  await A.page.getByTestId('add-friend-tab').click();
  await A.page.getByTestId('add-friend-input').fill(bob.user.username.toUpperCase());
  await A.page.getByRole('button', { name: 'Send Friend Request' }).click();
  await expect(A.page.getByTestId('add-friend-result')).toContainText('Success!');

  const B = await openAs(browser, bob, '/chats');
  await B.page.getByTestId('friends-tab-pending').click();
  const incoming = B.page.getByRole('region', { name: 'Incoming friend requests' }).getByTestId('pending-row');
  await expect(incoming).toContainText('Ann Friend');
  await incoming.getByRole('button', { name: 'Accept' }).click();
  await expect(incoming).toHaveCount(0);
  await B.page.getByTestId('friends-tab-all').click();
  await expect(B.page.getByTestId('friend-row').filter({ hasText: 'Ann Friend' })).toBeVisible();
  // Ann's side updates live: Bob is in All.
  await A.page.getByTestId('friends-tab-all').click();
  await expect(A.page.getByTestId('friend-row').filter({ hasText: 'Bob Friend' })).toBeVisible();
  await A.context.close();
  await B.context.close();
});

test('an @mention lands in the Inbox and Jump opens it', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser({ displayName: 'Ann Inbox' }), registerUser({ displayName: 'Bob Inbox' })]);
  const { detail, general } = await spaceWith(ann, [bob]);
  await sendAs(bob, general, { type: 'text', text: `hey @{${ann.user.id}} look at this` });
  for (let i = 0; i < 40; i++) await sendAs(bob, general, { type: 'text', text: `noise ${i}` });

  const A = await openAs(browser, ann, '/chats');
  const inbox = A.page.getByRole('button', { name: /Inbox/ });
  await expect(inbox).toBeVisible();
  await inbox.click();
  const popout = A.page.getByTestId('inbox-popout');
  const mention = popout.getByTestId('inbox-mention').filter({ hasText: 'look at this' });
  await expect(mention).toBeVisible();
  await mention.getByRole('button', { name: 'Jump' }).click();
  await expect(A.page).toHaveURL(new RegExp(`/spaces/${detail.space.id}/${general}`));
  await expect(row(A.page, 'look at this')).toBeInViewport();
  await A.context.close();
});

test('a thread started from a message: the starter card and the panel', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser({ displayName: 'Ann Thread' }), registerUser({ displayName: 'Bob Thread' })]);
  const { detail, general } = await spaceWith(ann, [bob]);
  await sendAs(bob, general, { type: 'text', text: 'shall we plan the trip?' });

  const A = await openAs(browser, ann, `/spaces/${detail.space.id}/${general}`);
  await row(A.page, 'shall we plan the trip?').click({ button: 'right' });
  await A.page.getByRole('menuitem', { name: 'Create Thread' }).click();
  const panel = A.page.getByTestId('thread-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('thread-name-input').fill('Trip planning');
  await panel.getByTestId('thread-first-message').fill('Day one: the coast');
  await panel.getByRole('button', { name: 'Create Thread' }).click();
  await expect(panel.getByTestId('message').filter({ hasText: 'Day one: the coast' })).toBeVisible();

  // Bob sees the card under the starter message and opens the thread beside the channel.
  const B = await openAs(browser, bob, `/spaces/${detail.space.id}/${general}`);
  const card = row(B.page, 'shall we plan the trip?').getByTestId('thread-starter-card');
  await expect(card).toContainText('Trip planning');
  await card.click();
  const bPanel = B.page.getByTestId('thread-panel');
  await expect(bPanel).toContainText('Trip planning');
  await expect(bPanel.getByTestId('message').filter({ hasText: 'Day one: the coast' })).toBeVisible();
  await A.context.close();
  await B.context.close();
});

test('a custom Space emoji renders in a message', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { detail, general } = await spaceWith(ann, [bob]);
  const media = await uploadAs(ann, { name: 'party.png', mimeType: 'image/png', buffer: await pngFixture(64, 64, [236, 72, 153]) }, { kind: 'image' });
  const emoji = await apiAs<{ id: string; name: string }>(ann, 'POST', `/api/spaces/${detail.space.id}/emojis`, {
    name: 'party_blob',
    mediaId: media.id,
  });
  await sendAs(ann, general, { type: 'text', text: `so happy <:party_blob:${emoji.id}> today` });

  const B = await openAs(browser, bob, `/spaces/${detail.space.id}/${general}`);
  const img = row(B.page, 'so happy').getByRole('img', { name: ':party_blob:' });
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', new RegExp(`/api/emojis/${emoji.id}`));
  await B.context.close();
});
