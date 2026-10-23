/**
 * The community wave: scheduled events (sidebar row, Interested), a forum post from the
 * New Post composer, an AutoMod keyword block, joining a Space from Discover, the settings
 * overlay over the page it came from, the pins popout and a slash command.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SpaceDetail } from '@enbox/shared';
import { apiAs, openAs, registerUser, sendAs, uniqueName, type E2EUser } from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[], name = `Club ${uniqueName('c')}`) {
  const detail = await apiAs<SpaceDetail>(owner, 'POST', '/api/spaces', { name });
  const invite = await apiAs<{ code: string }>(owner, 'POST', `/api/spaces/${detail.space.id}/invites`, {});
  for (const m of members) await apiAs(m, 'POST', `/api/invites/${invite.code}/join`);
  const general = detail.channels.find((c) => c.type === 'space_text')!.id;
  return { detail, spaceId: detail.space.id, general };
}

const row = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

test('an event shows in the sidebar; a member marks themselves interested', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const startAt = new Date(Date.now() + 2 * 3600_000).toISOString();
  const endAt = new Date(Date.now() + 4 * 3600_000).toISOString();
  await apiAs(ann, 'POST', `/api/spaces/${spaceId}/events`, {
    name: 'Picnic in the park',
    entityType: 'external',
    location: 'Central Park',
    startAt,
    endAt,
  });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  const sidebarRow = B.page.getByTestId('sidebar-events-row');
  await expect(sidebarRow).toContainText('1 Event');
  await sidebarRow.click();
  const card = B.page.getByTestId('event-card').filter({ hasText: 'Picnic in the park' });
  await expect(card).toContainText('Central Park');
  await expect(card.getByTestId('event-interested-count')).toContainText('1 Interested');
  await card.getByRole('button', { name: 'Interested' }).click();
  await expect(card.getByTestId('event-interested-count')).toContainText('2 Interested');
  await expect(card.getByRole('button', { name: 'Interested' })).toHaveAttribute('aria-pressed', 'true');
  await B.context.close();
});

test('a forum post from the New Post composer appears in the forum and opens beside it', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId } = await spaceWith(ann, [bob]);
  const forum = await apiAs<{ id: string }>(ann, 'POST', `/api/spaces/${spaceId}/channels`, {
    type: 'space_forum',
    name: 'ideas',
  });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${forum.id}`);
  await expect(B.page.getByTestId('forum-view')).toBeVisible();
  await B.page.getByTestId('forum-new-post-button').click();
  await B.page.getByTestId('forum-post-title').fill('Dark mode for the docs');
  await B.page.getByTestId('forum-post-text').fill('It would be easier on the eyes at night.');
  await B.page.getByTestId('forum-post-submit').click();
  const panel = B.page.getByTestId('thread-panel');
  await expect(panel).toContainText('Dark mode for the docs');
  await expect(panel.getByTestId('message').filter({ hasText: 'easier on the eyes' })).toBeVisible();
  await expect(B.page.getByTestId('forum-post-card').filter({ hasText: 'Dark mode for the docs' })).toBeVisible();
  await B.context.close();
});

test('AutoMod blocks a message with a blocked word: only the sender sees the notice', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await apiAs(ann, 'POST', `/api/spaces/${spaceId}/automod/rules`, {
    name: 'No spoilers',
    triggerType: 'keyword',
    triggerMetadata: { keywords: ['spoiler*'] },
    actions: [{ type: 'block', customMessage: 'Keep it spoiler-free!' }],
  });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  const box = B.page.getByRole('textbox', { name: 'Message', exact: true });
  await box.fill('huge spoilers ahead: the butler did it');
  await box.press('Enter');
  const notice = B.page.getByTestId('automod-blocked-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Keep it spoiler-free!');
  await expect(row(B.page, 'the butler did it')).toHaveCount(0);
  await box.fill('see you all tonight');
  await box.press('Enter');
  await expect(row(B.page, 'see you all tonight')).toBeVisible();
  await B.context.close();
});

test('a discoverable Space is found in Discover and joined without an invite', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const name = `Stargazers ${uniqueName('d')}`;
  const detail = await apiAs<SpaceDetail>(ann, 'POST', '/api/spaces', { name });
  await apiAs(ann, 'PATCH', `/api/spaces/${detail.space.id}`, { description: 'Telescopes, comets and night skies.' });
  await apiAs(ann, 'PATCH', `/api/spaces/${detail.space.id}/community`, {
    discoveryCategory: 'science',
    discoveryTags: ['astronomy'],
  });
  await apiAs(ann, 'PATCH', `/api/spaces/${detail.space.id}/community`, { isDiscoverable: true });

  const B = await openAs(browser, bob, '/discover');
  await B.page.getByRole('searchbox', { name: 'Search Spaces' }).or(B.page.getByLabel('Search Spaces')).fill(name);
  const card = B.page.getByTestId('discover-card').filter({ hasText: name });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: `Join ${name}` }).click();
  await expect(B.page).toHaveURL(new RegExp(`/spaces/${detail.space.id}`));
  await B.context.close();
});

test('settings open over the page and Esc returns to it', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser({ displayName: 'Ann Settings' }), registerUser({ displayName: 'Bob Settings' })]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await sendAs(bob, general, { type: 'text', text: 'still here behind the settings' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await expect(row(A.page, 'still here behind the settings')).toBeVisible();
  await A.page.getByRole('button', { name: 'User Settings' }).click();
  const layer = A.page.getByRole('dialog', { name: 'User Settings' });
  await expect(layer).toBeVisible();
  await expect(A.page).toHaveURL(/\/settings/);
  await A.page.keyboard.press('Escape');
  await expect(layer).toBeHidden();
  await expect(A.page).toHaveURL(new RegExp(`/spaces/${spaceId}/${general}$`));
  await expect(row(A.page, 'still here behind the settings')).toBeVisible();
  await A.context.close();
});

test('the pins popout lists a pinned message; /shrug sends the shrug', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const m = await sendAs<{ id: string }>(bob, general, { type: 'text', text: 'the meeting moved to Friday' });
  await apiAs(ann, 'POST', `/api/chats/${general}/pins`, { messageId: m.id });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  await B.page.getByTestId('pins-button').click();
  const pins = B.page.getByTestId('pins-popout');
  await expect(pins.getByTestId('pin-card')).toContainText('the meeting moved to Friday');
  await B.page.keyboard.press('Escape');

  const box = B.page.getByRole('textbox', { name: 'Message', exact: true });
  await box.fill('/shrug no idea');
  await box.press('Enter');
  await expect(row(B.page, 'no idea')).toContainText('¯\\_(ツ)_/¯');
  await B.context.close();
});
