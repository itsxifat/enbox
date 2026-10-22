/**
 * Spaces (docs/design/spaces-at-scale.md): create a Space, invite someone, chat in #general
 * in real time, a private channel shows up once a role grants access, @role mentions.
 */
import { expect, test } from '@playwright/test';
import { apiAs, openAs, registerUser, sendAs, uniqueName } from './helpers';

interface Detail {
  space: { id: string; name: string; roles: { id: string; isDefault: boolean }[] };
  channels: { id: string; name: string; type: string }[];
}

test('create a Space, invite a friend, and chat in #general', async ({ browser }) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const name = `Guild ${uniqueName('s')}`;

  const a = await openAs(browser, alice, '/spaces');
  await a.page.getByTestId('create-space').click();
  await a.page.getByLabel('Space name').fill(name);
  await a.page.getByTestId('create-space-submit').click();
  await expect(a.page).toHaveURL(/\/spaces\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  const spaceId = a.page.url().split('/').at(-2)!;
  await expect(a.page.getByTestId('space-header')).toContainText(name);
  const channels = a.page.getByRole('navigation', { name: `${name} channels` });
  await expect(channels.getByText('general', { exact: true })).toBeVisible();

  const invite = await apiAs<{ code: string }>(alice, 'POST', `/api/spaces/${spaceId}/invites`, {});
  const b = await openAs(browser, bob, `/join/${invite.code}`);
  await b.page.getByRole('button', { name: 'Join space' }).click();
  await expect(b.page).toHaveURL(new RegExp(`/spaces/${spaceId}/[0-9a-f-]{36}$`));

  await a.page.getByRole('textbox', { name: 'Message' }).fill('hello from alice');
  await a.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(b.page.getByRole('main').getByText('hello from alice').first()).toBeVisible();

  await b.page.getByRole('textbox', { name: 'Message' }).fill('hey alice');
  await b.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(a.page.getByRole('main').getByText('hey alice').first()).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('a private channel appears when a role grants access; @role mentions render', async ({
  browser,
}) => {
  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const detail = await apiAs<Detail>(alice, 'POST', '/api/spaces', { name: `Club ${uniqueName('s')}` });
  const spaceId = detail.space.id;
  const general = detail.channels.find((c) => c.type === 'space_text')!;
  const invite = await apiAs<{ code: string }>(alice, 'POST', `/api/spaces/${spaceId}/invites`, {});
  await apiAs(bob, 'POST', `/api/invites/${invite.code}/join`);

  const role = await apiAs<{ id: string }>(alice, 'POST', `/api/spaces/${spaceId}/roles`, {
    name: 'mods',
    mentionable: true,
  });
  const secret = await apiAs<{ id: string }>(alice, 'POST', `/api/spaces/${spaceId}/channels`, {
    type: 'space_text',
    name: 'mod-chat',
    privateRoleIds: [role.id],
  });

  const b = await openAs(browser, bob, `/spaces/${spaceId}/${general.id}`);
  const channels = b.page.getByRole('navigation', { name: /channels$/ });
  await expect(channels.getByText('general', { exact: true })).toBeVisible();
  await expect(channels.getByText('mod-chat', { exact: true })).toHaveCount(0);

  await apiAs(alice, 'PUT', `/api/spaces/${spaceId}/members/${bob.user.id}/roles/${role.id}`);
  await expect(channels.getByText('mod-chat', { exact: true })).toBeVisible();

  await sendAs(alice, secret.id, { type: 'text', text: `ping @{role:${role.id}}` });
  await channels.getByText('mod-chat', { exact: true }).click();
  await expect(b.page.getByRole('main').getByText('@mods')).toBeVisible();

  await b.context.close();
});
