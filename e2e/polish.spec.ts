/**
 * The polish wave: super reactions, timed polls with End Poll Now, formatting shortcuts,
 * forwarding with a message and its source, the Accessibility page, server tags and pinned
 * forum posts.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ChatSummary, Message, SpaceDetail } from '@enbox/shared';
import {
  apiAs,
  directChat,
  makeContacts,
  openAs,
  registerUser,
  sendAs,
  uniqueName,
  type E2EUser,
} from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[], name = `Club ${uniqueName('p')}`) {
  const detail = await apiAs<SpaceDetail>(owner, 'POST', '/api/spaces', { name });
  const invite = await apiAs<{ code: string }>(
    owner,
    'POST',
    `/api/spaces/${detail.space.id}/invites`,
    {},
  );
  for (const m of members) await apiAs(m, 'POST', `/api/invites/${invite.code}/join`);
  const general = detail.channels.find((c) => c.type === 'space_text')!.id;
  return { spaceId: detail.space.id, general, name };
}

const row = (scope: Page | Locator, text: string) =>
  scope.getByTestId('message').filter({ hasText: text });

test('a super reaction gets its own chip, live for everyone', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const msg = await sendAs<Message>(ann, general, { type: 'text', text: 'super me' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await expect(row(A.page, 'super me')).toBeVisible();
  const fire = encodeURIComponent('🔥');
  await apiAs(bob, 'PUT', `/api/messages/${msg.id}/reactions/${fire}/@me?burst=true`);
  await expect(
    row(A.page, 'super me').getByRole('button', { name: /1 Super Reaction/ }),
  ).toBeVisible();
  await A.context.close();
});

test('a timed poll can be ended early and posts its result', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const poll = await sendAs<Message>(ann, general, {
    type: 'poll',
    poll: { question: 'Pizza or sushi?', options: ['Pizza', 'Sushi'], durationHours: 24 },
  });
  await apiAs(bob, 'PUT', `/api/messages/${poll.id}/vote`, {
    optionIds: [poll.poll!.options[0]!.id],
  });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  const card = A.page.getByRole('group', { name: 'Poll: Pizza or sushi?' });
  await expect(card.getByTestId('poll-status')).toContainText('left');
  await card.click({ button: 'right' });
  await A.page.getByRole('menuitem', { name: 'End Poll Now' }).click();
  await A.page.getByRole('button', { name: 'End Poll Now' }).click();
  await expect(card.getByTestId('poll-status')).toContainText('Poll closed');
  await expect(A.page.getByTestId('poll-result-card')).toContainText('Pizza');
  await A.context.close();
});

test('Ctrl+B wraps the selection in bold', async ({ browser }) => {
  const ann = await registerUser();
  const { spaceId, general } = await spaceWith(ann, []);
  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  const box = A.page.getByRole('textbox', { name: 'Message' });
  await box.fill('hello bold world');
  await box.press('Control+A');
  await box.press('Control+B');
  await expect(box).toHaveValue('**hello bold world**');
  await box.press('Enter');
  await expect(row(A.page, 'hello bold world').locator('strong')).toHaveText('hello bold world');
  await A.context.close();
});

test('forwarding with a message shows where it came from', async ({ browser }) => {
  const [ann, bob] = await Promise.all([
    registerUser(),
    registerUser({ displayName: `Bob ${uniqueName('f')}` }),
  ]);
  await makeContacts(ann, bob);
  const dm = await directChat(ann, bob);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await sendAs(ann, general, { type: 'text', text: 'worth sharing' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await row(A.page, 'worth sharing').click({ button: 'right' });
  await A.page.getByRole('menuitem', { name: 'Forward' }).click();
  const dialog = A.page.getByRole('dialog');
  await dialog.getByLabel('Search chats').fill(bob.user.displayName);
  await dialog.getByText(bob.user.displayName).first().click();
  await dialog.getByLabel('Add an optional message').fill('look at this');
  await dialog.getByRole('button', { name: 'Forward', exact: true }).click();

  await A.page.goto(`/chats/${dm}`);
  await expect(row(A.page, 'worth sharing').getByTestId('forward-source')).toContainText('general');
  await expect(row(A.page, 'look at this')).toBeVisible();
  await A.context.close();
});

test('the Accessibility page underlines links', async ({ browser }) => {
  const ann = await registerUser();
  const A = await openAs(browser, ann, '/settings/accessibility');
  await A.page.getByRole('switch', { name: /Always underline links/ }).click();
  await expect(A.page.locator('html')).toHaveAttribute('data-underline-links', 'true');
  await A.context.close();
});

test('a member wearing the Space tag shows it next to their name', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await apiAs(ann, 'PUT', `/api/spaces/${spaceId}/tag`, {
    tag: 'CLUB',
    badge: 'star',
    color: '#7c6cf8',
  });
  await apiAs(bob, 'PUT', '/api/me/space-tag', { spaceId });
  await sendAs(bob, general, { type: 'text', text: 'tagged hello' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await expect(row(A.page, 'tagged hello').getByTestId('server-tag')).toContainText('CLUB');
  await A.context.close();
});

test('a moderator pins a forum post to the top', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId } = await spaceWith(ann, [bob]);
  const forum = await apiAs<ChatSummary>(ann, 'POST', `/api/spaces/${spaceId}/channels`, {
    type: 'space_forum',
    name: 'ideas',
  });
  for (const name of ['Older idea', 'Newer idea'])
    await apiAs(bob, 'POST', `/api/chats/${forum.id}/posts`, {
      name,
      text: name,
      clientId: uniqueName('post'),
    });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${forum.id}`);
  const older = A.page.getByTestId('forum-post-card').filter({ hasText: 'Older idea' });
  await older.hover();
  await older.getByRole('button', { name: 'Post options' }).click();
  await A.page.getByRole('menuitem', { name: 'Pin Post' }).click();
  await expect(older.getByTestId('post-pinned')).toBeVisible();
  await expect(A.page.getByTestId('forum-post-card').first()).toContainText('Older idea');
  await A.context.close();
});
