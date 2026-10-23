/**
 * The expressions wave: a sticker picked from the composer, a message with several photos
 * (mosaic + gallery viewer), a group DM made from the "Select Friends" popout, the Stage lobby
 * and Streamer Mode's bar.
 */
import { expect, test, type Page } from '@playwright/test';
import type { SpaceDetail } from '@enbox/shared';
import {
  apiAs,
  makeContacts,
  openAs,
  pngFixture,
  registerUser,
  sendAs,
  uniqueName,
  uploadAs,
  type E2EUser,
} from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[], name = `Club ${uniqueName('x')}`) {
  const detail = await apiAs<SpaceDetail>(owner, 'POST', '/api/spaces', { name });
  const invite = await apiAs<{ code: string }>(owner, 'POST', `/api/spaces/${detail.space.id}/invites`, {});
  for (const m of members) await apiAs(m, 'POST', `/api/invites/${invite.code}/join`);
  const general = detail.channels.find((c) => c.type === 'space_text')!.id;
  return { detail, spaceId: detail.space.id, general };
}

const row = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

test('a sticker picked from the composer arrives as a sticker', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const media = await uploadAs(
    ann,
    { name: 'wave.png', mimeType: 'image/png', buffer: await pngFixture(160, 160, [240, 180, 40]) },
    { kind: 'image' },
  );
  await apiAs(ann, 'POST', `/api/spaces/${spaceId}/stickers`, { name: 'Wave', emoji: '👋', mediaId: media.id });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  await B.page.getByRole('button', { name: 'Stickers' }).first().click();
  await B.page.getByRole('button', { name: 'Wave', exact: true }).click();
  await expect(B.page.getByRole('img', { name: 'Wave' }).last()).toBeVisible();
  const page = await apiAs<{ messages: { sticker?: { name: string } | null }[] }>(
    ann,
    'GET',
    `/api/chats/${general}/messages`,
  );
  expect(page.messages.at(-1)?.sticker?.name).toBe('Wave');
  await B.context.close();
});

test('several photos make one message: a mosaic, browsed in the viewer', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const ids: string[] = [];
  for (const rgb of [
    [200, 60, 60],
    [60, 200, 60],
    [60, 60, 200],
  ] as [number, number, number][])
    ids.push((await uploadAs(ann, { name: 'p.png', mimeType: 'image/png', buffer: await pngFixture(120, 90, rgb) }, { kind: 'image' })).id);
  await sendAs(ann, general, {
    type: 'image',
    mediaId: ids[0],
    extraMediaIds: ids.slice(1),
    descriptions: ['red square', null, null],
    text: 'three photos',
  });

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  const message = row(B.page, 'three photos');
  await expect(message.getByRole('button', { name: 'Open photo 2 of 3' })).toBeVisible();
  await message.getByRole('button', { name: /red square/ }).click();
  const viewer = B.page.getByRole('dialog', { name: 'Media viewer' });
  await expect(viewer.getByTestId('viewer-counter')).toHaveText('1 / 3');
  await B.page.keyboard.press('ArrowRight');
  await expect(viewer.getByTestId('viewer-counter')).toHaveText('2 / 3');
  await B.page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await B.context.close();
});

test('a group DM from the Select Friends popout', async ({ browser }) => {
  const [ann, bob, cat] = await Promise.all([
    registerUser({ displayName: 'Ann Group' }),
    registerUser({ displayName: 'Bob Group' }),
    registerUser({ displayName: 'Cat Group' }),
  ]);
  await makeContacts(ann, bob);
  await makeContacts(ann, cat);

  const A = await openAs(browser, ann, '/chats');
  await A.page.getByRole('button', { name: 'Create DM' }).click();
  const picker = A.page.getByRole('dialog', { name: 'Select Friends' });
  await picker.getByRole('checkbox', { name: /Bob Group/ }).click();
  await expect(picker.getByRole('button', { name: 'Create DM' })).toBeVisible();
  await picker.getByRole('checkbox', { name: /Cat Group/ }).click();
  await picker.getByRole('button', { name: 'Create Group DM' }).click();
  // Unnamed: titled with the other members' names.
  await expect(A.page.locator('header').getByText(/^(Bob Group, Cat Group|Cat Group, Bob Group)$/)).toBeVisible();

  const chats = await apiAs<{ id: string; isGroupDm?: boolean; memberCount: number }[]>(bob, 'GET', '/api/chats');
  expect(chats.find((c) => c.isGroupDm)?.memberCount).toBe(3);
  await A.context.close();
});

test('a Stage channel shows its lobby; Streamer Mode shows its bar', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId } = await spaceWith(ann, [bob]);
  const stage = await apiAs<{ id: string }>(ann, 'POST', `/api/spaces/${spaceId}/channels`, {
    type: 'space_stage',
    name: 'town-hall',
  });
  const B = await openAs(browser, bob, `/spaces/${spaceId}/${stage.id}`);
  await expect(B.page.getByRole('button', { name: 'Join Stage' })).toBeVisible();

  await B.page.goto('/settings/streamer');
  await B.page.getByRole('switch', { name: /Enable Streamer Mode/ }).click();
  // The bar sits on top of the app, behind the settings layer: close settings first.
  await B.page.keyboard.press('Escape');
  const bar = B.page.getByTestId('streamer-banner');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Disable' }).click();
  await expect(bar).toBeHidden();
  await B.context.close();
});
