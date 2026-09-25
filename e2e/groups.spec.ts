/**
 * Groups (agent 3): create with members, add/remove members, admin-only sending, invite links.
 * Two or three signed-in browser contexts verify realtime fan-out.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  apiAs,
  createGroupAs,
  makeContacts,
  openAs,
  openChatInfo,
  registerUser,
  uniqueName,
} from './helpers';

const composer = (page: Page) => page.getByRole('main').getByRole('textbox', { name: /message/i });
/** The conversation pane (the chat list also previews system messages). */
const conv = (page: Page) => page.getByRole('main');
const infoPanel = (page: Page) => page.getByTestId('group-info');

test('create a group with two members: everyone sees it and the system messages', async ({
  browser,
}) => {
  const [alice, bob, carol] = await Promise.all([registerUser(), registerUser(), registerUser()]);
  await makeContacts(alice, bob);
  await makeContacts(alice, carol);
  const name = `Trip ${uniqueName('g')}`;

  const b = await openAs(browser, bob, '/chats');
  const a = await openAs(browser, alice, '/new/group');

  await a.page.getByRole('checkbox', { name: bob.user.displayName }).click();
  await a.page.getByRole('checkbox', { name: carol.user.displayName }).click();
  await expect(a.page.getByText('2 of 1023 selected')).toBeVisible();
  await a.page.getByRole('button', { name: 'Next' }).click();
  await a.page.getByLabel('Group name').fill(name);
  await a.page.getByLabel('Description (optional)').fill('Planning the summer trip');
  await a.page.getByRole('button', { name: 'Create group' }).click();

  await expect(a.page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
  await expect(conv(a.page).getByText(`You created group "${name}"`)).toBeVisible();

  // Bob gets the group in realtime and sees who created it and who was added.
  await b.page.getByText(name).first().click();
  await expect(
    conv(b.page).getByText(`${alice.user.displayName} created group "${name}"`),
  ).toBeVisible();
  await expect(
    conv(b.page).getByText(
      new RegExp(`${alice.user.displayName} added .*${carol.user.displayName}`),
    ),
  ).toBeVisible();

  // Info panel: 3 members, Alice is the owner.
  await openChatInfo(b.page, name);
  const panel = infoPanel(b.page);
  await expect(panel.getByText('Group · 3 members')).toBeVisible();
  await expect(panel.getByText('Planning the summer trip')).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Members' }).getByText('Owner')).toBeVisible();

  await Promise.all([a.context.close(), b.context.close()]);
});

test('admins add and remove members; the removed member becomes read-only', async ({ browser }) => {
  const [alice, bob, dave] = await Promise.all([registerUser(), registerUser(), registerUser()]);
  await makeContacts(alice, bob);
  await makeContacts(alice, dave);
  const name = `Crew ${uniqueName('g')}`;
  const group = await createGroupAs(alice, name, [bob]);

  const a = await openAs(browser, alice, `/chats/${group.id}`);
  const d = await openAs(browser, dave, '/chats');

  // Add Dave from the info panel.
  await openChatInfo(a.page, name);
  const panel = infoPanel(a.page);
  await panel.getByRole('button', { name: 'Add members' }).click();
  await panel.getByRole('checkbox', { name: dave.user.displayName }).click();
  await panel
    .getByRole('button', { name: new RegExp(`^Add ${dave.user.displayName.split(' ')[0]}`) })
    .click();
  await expect(panel.getByText('Group · 3 members')).toBeVisible();

  // Dave sees the group and can write.
  await d.page.getByText(name).first().click();
  await expect(
    conv(d.page).getByText(new RegExp(`${alice.user.displayName} added you`, 'i')),
  ).toBeVisible();
  await expect(composer(d.page)).toBeVisible();

  // Alice removes Dave.
  await panel.getByTestId(`member-${dave.user.username}`).click();
  await a.page.getByRole('menuitem', { name: new RegExp(`^Remove`) }).click();
  await a.page
    .getByRole('dialog', { name: /^Remove / })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(panel.getByText('Group · 2 members')).toBeVisible();

  // Dave: read-only, with the reason in the info panel.
  await expect(
    conv(d.page).getByText(new RegExp(`${alice.user.displayName} removed you`, 'i')),
  ).toBeVisible();
  await expect(composer(d.page)).toHaveCount(0);
  await openChatInfo(d.page, name);
  await expect(infoPanel(d.page).getByText(/You were removed from this group/)).toBeVisible();
  await expect(infoPanel(d.page).getByRole('button', { name: 'Delete group' })).toBeVisible();

  await Promise.all([a.context.close(), d.context.close()]);
});

test('"only admins can send" hides the composer for members in realtime', async ({ browser }) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const name = `Announce ${uniqueName('g')}`;
  const group = await createGroupAs(alice, name, [bob]);

  const a = await openAs(browser, alice, `/chats/${group.id}`);
  const b = await openAs(browser, bob, `/chats/${group.id}`);
  await expect(composer(b.page)).toBeVisible();

  await openChatInfo(a.page, name);
  const panel = infoPanel(a.page);
  await panel.getByRole('button', { name: 'Group settings' }).click();
  await panel.getByRole('switch', { name: 'Only admins can send messages' }).click();
  await expect(
    panel.getByRole('switch', { name: 'Only admins can send messages' }),
  ).toHaveAttribute('aria-checked', 'true');

  await expect(
    conv(b.page).getByText(
      `${alice.user.displayName} changed settings so only admins can send messages`,
    ),
  ).toBeVisible();
  await expect(composer(b.page)).toHaveCount(0);
  await expect(
    conv(b.page)
      .getByText(/only admins can send/i)
      .last(),
  ).toBeVisible();
  // The admin can still write.
  await expect(composer(a.page)).toBeVisible();

  // Turning it off gives the composer back.
  await panel.getByRole('switch', { name: 'Only admins can send messages' }).click();
  await expect(composer(b.page)).toBeVisible();

  await Promise.all([a.context.close(), b.context.close()]);
});

test('a third user joins with the invite link', async ({ browser }) => {
  const [alice, bob, frank] = await Promise.all([registerUser(), registerUser(), registerUser()]);
  const name = `Open ${uniqueName('g')}`;
  const group = await createGroupAs(alice, name, [bob]);

  const a = await openAs(browser, alice, `/chats/${group.id}`);
  await openChatInfo(a.page, name);
  const panel = infoPanel(a.page);
  await panel.getByRole('button', { name: 'Invite via link' }).first().click();
  const link = await panel.getByTestId('invite-link').textContent();
  expect(link).toMatch(/\/join\/[A-Za-z0-9]{22}$/);
  const path = new URL(link!).pathname;

  const f = await openAs(browser, frank, path);
  await expect(f.page.getByTestId('invite-preview').getByText(name)).toBeVisible();
  await expect(conv(f.page).getByText('Group · 2 members')).toBeVisible();
  await f.page.getByRole('button', { name: 'Join group' }).click();
  await expect(f.page).toHaveURL(new RegExp(`/chats/${group.id}$`));
  await expect(conv(f.page).getByText("You joined using this group's invite link")).toBeVisible();
  await expect(composer(f.page)).toBeVisible();

  // Alice sees it live.
  // (the sender's name may still be resolving, so match the event text)
  await expect(conv(a.page).getByText(/joined using this group's invite link/)).toBeVisible();

  // Resetting the link invalidates the old one.
  await panel.getByRole('button', { name: 'Reset link' }).click();
  await a.page
    .getByRole('dialog', { name: 'Reset link?' })
    .getByRole('button', { name: 'Reset link' })
    .click();
  await expect(panel.getByTestId('invite-link')).not.toHaveText(link!);
  const other = await registerUser();
  const o = await openAs(browser, other, path);
  await expect(o.page.getByText("This invite link isn't valid")).toBeVisible();
  const chat = await apiAs<{ memberCount: number }>(alice, 'GET', `/api/chats/${group.id}`);
  expect(chat.memberCount).toBe(3);

  await Promise.all([a.context.close(), f.context.close(), o.context.close()]);
});
