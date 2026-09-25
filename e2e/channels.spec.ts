/**
 * Channels (agent 3): create → another user discovers & follows → sees posts, can react and
 * vote but not post; realtime both ways.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, openAs, registerUser, uniqueName } from './helpers';

test('create a channel; a follower discovers it, reads posts and reacts but cannot post', async ({
  browser,
}) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const name = `News ${uniqueName('ch')}`;

  // Alice creates the channel in the UI and posts.
  const a = await openAs(browser, alice, '/updates/channels/new');
  await a.page.getByLabel('Channel name').fill(name);
  await a.page.getByLabel('Description').fill('Daily product news');
  await a.page.getByRole('button', { name: 'Create channel' }).click();
  await expect(a.page).toHaveURL(/\/updates\/channels\/[0-9a-f-]{36}$/);
  const channelId = a.page.url().split('/').pop()!;
  await expect(a.page.getByRole('main').getByText(`You created channel "${name}"`)).toBeVisible();
  await a.page.getByRole('textbox', { name: 'Write a post' }).fill('Hello followers 👋');
  await a.page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(
    a.page.getByTestId('channel-post').filter({ hasText: 'Hello followers' }),
  ).toBeVisible();

  // Bob finds it in discovery and follows.
  const b = await openAs(browser, bob, '/updates/channels/discover');
  await b.page.getByRole('searchbox', { name: 'Search channels' }).fill(name);
  const results = b.page.getByRole('list', { name: 'Channels' });
  await expect(results.getByText(name)).toBeVisible();
  await results.getByRole('link', { name: new RegExp(name) }).click();
  // Non-follower preview with the latest posts.
  await expect(b.page.getByRole('main').getByText('Hello followers 👋')).toBeVisible();
  await b.page
    .getByRole('main')
    .getByRole('button', { name: `Follow ${name}` })
    .click();

  // Follower view: no composer, read-only footer, posts visible.
  await expect(b.page.getByTestId('channel-readonly')).toBeVisible();
  await expect(b.page.getByRole('textbox', { name: 'Write a post' })).toHaveCount(0);
  await expect(b.page.getByRole('main').getByText('2 followers')).toBeVisible();

  // React to Alice's post.
  const post = b.page.getByTestId('channel-post').filter({ hasText: 'Hello followers' });
  await post.hover();
  await post.getByRole('button', { name: 'React', exact: true }).click();
  await b.page.getByRole('button', { name: 'React 👍' }).click();
  await expect(post.getByRole('button', { name: /1 reactions, you reacted 👍/ })).toBeVisible();

  // Alice sees the reaction count (anonymous) and her follower count live.
  const alicePost = a.page.getByTestId('channel-post').filter({ hasText: 'Hello followers' });
  await expect(alicePost.getByText('👍')).toBeVisible();
  await expect(a.page.getByRole('main').getByText('2 followers')).toBeVisible();

  // New posts reach Bob in realtime.
  await a.page.getByRole('textbox', { name: 'Write a post' }).fill('Second update');
  await a.page.keyboard.press('Enter');
  await expect(
    b.page.getByTestId('channel-post').filter({ hasText: 'Second update' }),
  ).toBeVisible();

  // The channel shows up in Bob's Updates tab.
  await b.page.goto('/updates');
  await expect(
    b.page.getByRole('list', { name: 'Followed channels' }).getByText(name),
  ).toBeVisible();

  // Server agrees Bob can't post.
  await expect(
    apiAs(bob, 'POST', `/api/chats/${channelId}/messages`, {
      type: 'text',
      text: 'nope',
      clientId: randomUUID(),
    }),
  ).rejects.toThrow(/403/);

  await Promise.all([a.context.close(), b.context.close()]);
});

test('followers vote in polls; quick-only reactions and unfollow', async ({ browser }) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const channel = await apiAs<{ id: string; name: string }>(alice, 'POST', '/api/channels', {
    name: `Polls ${uniqueName('ch')}`,
    reactions: 'quick',
  });
  await apiAs(alice, 'POST', `/api/chats/${channel.id}/messages`, {
    type: 'poll',
    clientId: randomUUID(),
    poll: { question: 'Best season?', options: ['Spring', 'Autumn'], allowMultiple: false },
  });
  await apiAs(bob, 'PUT', `/api/channels/${channel.id}/follow`);

  const a = await openAs(browser, alice, `/updates/channels/${channel.id}`);
  const b = await openAs(browser, bob, `/updates/channels/${channel.id}`);

  const poll = b.page.getByRole('group', { name: 'Poll: Best season?' });
  await poll.getByRole('radio', { name: /^Autumn/ }).click();
  await expect(poll.getByRole('radio', { name: 'Autumn, 1 vote' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    a.page
      .getByRole('group', { name: 'Poll: Best season?' })
      .getByRole('radio', { name: 'Autumn, 1 vote' }),
  ).toBeVisible();

  // Quick-only channel: no "more reactions" button.
  const post = b.page.getByTestId('channel-post').first();
  await post.hover();
  await post.getByRole('button', { name: 'React', exact: true }).click();
  await expect(b.page.getByRole('button', { name: 'React 🙏' })).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'More reactions' })).toHaveCount(0);
  await b.page.keyboard.press('Escape');

  // Unfollow from the channel menu.
  await b.page.getByRole('button', { name: 'Channel options' }).click();
  await b.page.getByRole('menuitem', { name: 'Unfollow' }).click();
  await b.page
    .getByRole('dialog', { name: /^Unfollow/ })
    .getByRole('button', { name: 'Unfollow' })
    .click();
  await expect(b.page).toHaveURL(/\/updates$/);
  await expect(a.page.getByRole('main').getByText('1 follower', { exact: true })).toBeVisible();

  await Promise.all([a.context.close(), b.context.close()]);
});
