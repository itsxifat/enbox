/**
 * The second community wave: text chat in a voice channel, the Server Guide, Mod View from the
 * Members page, and previewing a discoverable Space before joining.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SpaceDetail } from '@enbox/shared';
import { apiAs, openAs, registerUser, sendAs, uniqueName, type E2EUser } from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[], name = `Club ${uniqueName('k')}`) {
  const detail = await apiAs<SpaceDetail>(owner, 'POST', '/api/spaces', { name });
  const invite = await apiAs<{ code: string }>(
    owner,
    'POST',
    `/api/spaces/${detail.space.id}/invites`,
    {},
  );
  for (const m of members) await apiAs(m, 'POST', `/api/invites/${invite.code}/join`);
  const general = detail.channels.find((c) => c.type === 'space_text')!.id;
  const voice = detail.channels.find((c) => c.type === 'space_voice')!.id;
  return { detail, spaceId: detail.space.id, general, voice, name };
}

const row = (scope: Page | Locator, text: string) =>
  scope.getByTestId('message').filter({ hasText: text });

test('a voice channel has a text chat beside the call', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, voice } = await spaceWith(ann, [bob]);
  await sendAs(bob, voice, { type: 'text', text: 'anyone up for a game?' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${voice}`);
  await A.page.getByRole('button', { name: /^Chat/ }).first().click();
  const panel = A.page.getByTestId('voice-chat-panel');
  await expect(row(panel, 'anyone up for a game?')).toBeVisible();
  await panel.getByRole('textbox').fill('count me in');
  await panel.getByRole('textbox').press('Enter');
  await expect(row(panel, 'count me in')).toBeVisible();
  await A.context.close();
});

test('the Server Guide lists its to-dos for members', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await apiAs(ann, 'PUT', `/api/spaces/${spaceId}/guide`, {
    enabled: true,
    welcome: { title: 'Welcome to the club', subtitle: 'Start here' },
    todos: [{ channelId: general, emoji: null, description: 'Say hello in general' }],
    resources: [],
  });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  await B.page.getByTestId('sidebar-guide-links').getByText('Server Guide').click();
  await expect(B.page.getByText('Welcome to the club')).toBeVisible();
  await expect(B.page.getByTestId('guide-todo')).toContainText('Say hello in general');
  await B.context.close();
});

test('Mod View opens from the Members page with the member’s recent messages', async ({
  browser,
}) => {
  const [ann, bob] = await Promise.all([
    registerUser(),
    registerUser({ displayName: 'Bob Modview' }),
  ]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await sendAs(bob, general, { type: 'text', text: 'something to review' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/settings/members`);
  await A.page
    .getByTestId('mod-member-row')
    .filter({ hasText: 'Bob Modview' })
    .getByTitle('Open Mod View')
    .click();
  const modView = A.page.getByTestId('mod-view');
  await expect(modView).toBeVisible();
  await expect(modView).toContainText('something to review');
  await A.context.close();
});

test('a discoverable Space can be previewed before joining', async ({ browser }) => {
  const [ann, cat] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general, name } = await spaceWith(ann, []);
  await sendAs(ann, general, { type: 'text', text: 'welcome, lurkers' });
  await apiAs(ann, 'PATCH', `/api/spaces/${spaceId}`, {
    description: 'A friendly place to hang out.',
  });
  await apiAs(ann, 'PATCH', `/api/spaces/${spaceId}/community`, { discoveryCategory: 'other' });
  await apiAs(ann, 'PATCH', `/api/spaces/${spaceId}/community`, { isDiscoverable: true });

  const C = await openAs(browser, cat, `/preview/${spaceId}`);
  const preview = C.page.getByTestId('space-preview');
  await expect(preview).toContainText(name);
  await expect(preview.getByText('welcome, lurkers')).toBeVisible();
  const bar = C.page.getByTestId('preview-join-bar');
  await expect(bar).toContainText('Join this Space to start');
  await bar.getByRole('button', { name: 'Join Space' }).click();
  await expect(C.page).toHaveURL(new RegExp(`/spaces/${spaceId}/`));
  await C.context.close();
});
