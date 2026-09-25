/**
 * Communities (agent 3): create a community (announcement group), link a group, members
 * join groups from the community page.
 */
import { expect, test } from '@playwright/test';
import { apiAs, createGroupAs, openAs, registerUser, uniqueName } from './helpers';

test('create a community with an existing group; the announcement group is ready', async ({
  browser,
}) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const groupName = `Hikers ${uniqueName('g')}`;
  const group = await createGroupAs(alice, groupName, [bob]);
  const name = `Outdoors ${uniqueName('c')}`;

  const a = await openAs(browser, alice, '/communities');
  await a.page.getByRole('link', { name: 'New community' }).first().click();
  await expect(a.page).toHaveURL(/\/communities\/new$/);
  await a.page.getByLabel('Community name').fill(name);
  await a.page.getByLabel('Description').fill('Everything outdoors');
  await a.page.getByRole('button', { name: 'Next' }).click();

  await a.page.getByRole('checkbox', { name: groupName }).click();
  await a.page.getByLabel('New group name').fill('General');
  await a.page.getByRole('button', { name: 'Add', exact: true }).click();
  await a.page.getByRole('button', { name: 'Create community' }).click();

  await expect(a.page).toHaveURL(/\/communities\/[0-9a-f-]{36}$/);
  const main = a.page.getByRole('main');
  await expect(main.getByRole('heading', { name, level: 2 })).toBeVisible();
  await expect(main.getByText('Everything outdoors')).toBeVisible();
  const mine = main.getByRole('region', { name: "Groups you're in" });
  await expect(mine.getByText(groupName)).toBeVisible();
  await expect(mine.getByText('General', { exact: true })).toBeVisible();

  // The linked group got the system message and Bob became a community member.
  const bobCommunities = await apiAs<{ name: string }[]>(bob, 'GET', '/api/communities');
  expect(bobCommunities.map((c) => c.name)).toContain(name);
  await a.page.goto(`/chats/${group.id}`);
  await expect(
    a.page.getByRole('main').getByText(`You added this group to the community "${name}"`),
  ).toBeVisible();

  // Announcements open the announcement group with its first message.
  await a.page.goto('/communities');
  await a.page
    .getByRole('region', { name })
    .getByRole('link', { name: /Announcements/ })
    .click();
  await expect(a.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
  await expect(a.page.getByRole('main').getByText(`You created community "${name}"`)).toBeVisible();

  await a.context.close();
});

test('add an existing group from the community page', async ({ browser }) => {
  const alice = await registerUser();
  const community = await apiAs<{ id: string; name: string }>(alice, 'POST', '/api/communities', {
    name: `Makers ${uniqueName('c')}`,
  });
  const groupName = `Woodwork ${uniqueName('g')}`;
  const group = await createGroupAs(alice, groupName);

  const a = await openAs(browser, alice, `/communities/${community.id}`);
  await a.page.getByRole('button', { name: 'Add groups' }).first().click();
  await a.page.getByRole('button', { name: /Add existing groups/ }).click();
  await a.page.getByRole('checkbox', { name: groupName }).click();
  await a.page.getByRole('button', { name: 'Add group', exact: true }).click();

  const mine = a.page.getByRole('region', { name: "Groups you're in" });
  await expect(mine.getByText(groupName)).toBeVisible();
  const chat = await apiAs<{ communityId: string }>(alice, 'GET', `/api/chats/${group.id}`);
  expect(chat.communityId).toBe(community.id);

  await a.context.close();
});

test('a community member joins a group from the community page', async ({ browser }) => {
  const [alice, erin] = await Promise.all([registerUser(), registerUser()]);
  const community = await apiAs<{ id: string; name: string }>(alice, 'POST', '/api/communities', {
    name: `Garden ${uniqueName('c')}`,
  });
  const groupName = `Tomatoes ${uniqueName('g')}`;
  const created = await apiAs<{ chat: { id: string } }>(
    alice,
    'POST',
    `/api/communities/${community.id}/groups`,
    {
      name: groupName,
    },
  );
  await apiAs(alice, 'POST', `/api/communities/${community.id}/members`, {
    userIds: [erin.user.id],
  });

  const a = await openAs(browser, alice, `/chats/${created.chat.id}`);
  const e = await openAs(browser, erin, `/communities/${community.id}`);

  const joinable = e.page.getByRole('region', { name: 'Groups you can join' });
  await expect(joinable.getByText(groupName)).toBeVisible();
  await joinable.getByRole('button', { name: `Join ${groupName}` }).click();

  const mine = e.page.getByRole('region', { name: "Groups you're in" });
  await expect(mine.getByText(groupName)).toBeVisible();
  await expect(e.page.getByRole('region', { name: 'Groups you can join' })).toHaveCount(0);

  // Alice sees the join in realtime; Erin can open the group.
  await expect(a.page.getByRole('main').getByText(/joined from the community/)).toBeVisible();
  await mine.getByRole('link', { name: new RegExp(groupName) }).click();
  await expect(e.page).toHaveURL(new RegExp(`/chats/${created.chat.id}$`));
  await expect(e.page.getByRole('main').getByText('You joined from the community')).toBeVisible();

  await Promise.all([a.context.close(), e.context.close()]);
});

test('community admins manage members and leaving removes the community', async ({ browser }) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const community = await apiAs<{ id: string; name: string }>(alice, 'POST', '/api/communities', {
    name: `Chess ${uniqueName('c')}`,
  });
  await apiAs(alice, 'POST', `/api/communities/${community.id}/members`, {
    userIds: [bob.user.id],
  });

  const a = await openAs(browser, alice, `/communities/${community.id}`);
  const b = await openAs(browser, bob, `/communities/${community.id}`);
  await expect(b.page.getByRole('heading', { name: community.name, level: 2 })).toBeVisible();

  await a.page.getByRole('button', { name: 'Members' }).first().click();
  const sheet = a.page.getByRole('dialog', { name: 'Community' });
  await expect(sheet.getByTestId(`member-${bob.user.username}`)).toBeVisible();
  await sheet.getByTestId(`member-${bob.user.username}`).click();
  await a.page.getByRole('menuitem', { name: 'Make community admin' }).click();
  await expect(sheet.getByTestId(`member-${bob.user.username}`).getByText('Admin')).toBeVisible();

  // Bob (now an admin) leaves.
  await b.page.getByRole('button', { name: 'Exit community' }).click();
  await b.page
    .getByRole('dialog', { name: /^Exit / })
    .getByRole('button', { name: 'Exit community' })
    .click();
  await expect(b.page).toHaveURL(/\/communities$/);
  await expect(b.page.getByRole('region', { name: community.name })).toHaveCount(0);
  await expect(sheet.getByTestId(`member-${bob.user.username}`)).toHaveCount(0);

  await Promise.all([a.context.close(), b.context.close()]);
});
