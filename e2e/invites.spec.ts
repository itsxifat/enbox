/**
 * Invite links (agent 3): community and channel invites, invalid/reset codes, removed
 * members, and the signed-out redirect through the login page.
 */
import { expect, test } from '@playwright/test';
import { apiAs, createGroupAs, openAs, registerUser, uniqueName } from './helpers';

test('invalid and malformed invite codes are explained', async ({ browser }) => {
  const user = await registerUser();
  const { context, page } = await openAs(browser, user, '/join/ABCDEFGHJKLMNPQRSTUVWX');
  await expect(page.getByText("This invite link isn't valid")).toBeVisible();
  await page.goto('/join/not-a-code');
  await expect(page.getByText("This invite link isn't valid")).toBeVisible();
  await page.getByRole('button', { name: 'Go to chats' }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await context.close();
});

test('join a community and follow a private channel with invite links', async ({ browser }) => {
  const [alice, frank] = await Promise.all([registerUser(), registerUser()]);
  const community = await apiAs<{ id: string; name: string; inviteCode: string }>(
    alice,
    'POST',
    '/api/communities',
    {
      name: `Neighbours ${uniqueName('c')}`,
      description: 'Our street',
    },
  );
  const channel = await apiAs<{ id: string; name: string }>(alice, 'POST', '/api/channels', {
    name: `Secret ${uniqueName('ch')}`,
    isPublic: false,
  });
  const { code: channelCode } = await apiAs<{ code: string }>(
    alice,
    'GET',
    `/api/channels/${channel.id}/invite`,
  );

  const f = await openAs(browser, frank, `/join/${community.inviteCode}`);
  const card = f.page.getByTestId('invite-preview');
  await expect(card.getByText(community.name)).toBeVisible();
  await expect(card.getByText('Community · 1 member')).toBeVisible();
  await card.getByRole('button', { name: 'Join community' }).click();
  await expect(f.page).toHaveURL(new RegExp(`/communities/${community.id}$`));
  await expect(f.page.getByRole('heading', { name: community.name, level: 2 })).toBeVisible();

  // Private channel: not previewable without the link, followable with it.
  await f.page.goto(`/updates/channels/${channel.id}`);
  await expect(f.page.getByText('Channel not available')).toBeVisible();
  await f.page.goto(`/join/${channelCode}`);
  await f.page.getByRole('button', { name: 'Follow channel' }).click();
  await expect(f.page).toHaveURL(new RegExp(`/updates/channels/${channel.id}$`));
  await expect(f.page.getByTestId('channel-readonly')).toBeVisible();

  // Opening the link again offers to open it.
  await f.page.goto(`/join/${channelCode}`);
  await expect(f.page.getByText("You're already following this channel.")).toBeVisible();

  await f.context.close();
});

test('a member removed by an admin cannot rejoin with the link', async ({ browser }) => {
  const [alice, dave] = await Promise.all([registerUser(), registerUser()]);
  const group = await createGroupAs(alice, `Club ${uniqueName('g')}`, [dave]);
  await apiAs(alice, 'DELETE', `/api/groups/${group.id}/members/${dave.user.id}`);

  const d = await openAs(browser, dave, `/join/${group.inviteCode}`);
  await expect(d.page.getByRole('alert')).toHaveText('You were removed by an admin');
  await expect(d.page.getByRole('button', { name: 'Join group' })).toBeDisabled();
  await d.context.close();
});

test('signed-out visitors log in and come back to the invite', async ({ page }) => {
  const [alice, frank] = await Promise.all([registerUser(), registerUser()]);
  const group = await createGroupAs(alice, `Choir ${uniqueName('g')}`);

  await page.goto(`/join/${group.inviteCode}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel(/username or phone/i).fill(frank.user.username);
  await page.getByLabel(/^password/i).fill(frank.password);
  await page.getByRole('button', { name: /log in|sign in/i }).click();

  await expect(page).toHaveURL(new RegExp(`/join/${group.inviteCode}$`));
  await page.getByRole('button', { name: 'Join group' }).click();
  await expect(page).toHaveURL(new RegExp(`/chats/${group.id}$`));
});
