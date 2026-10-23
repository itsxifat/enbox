/**
 * The safety and integrations wave: a webhook post with its APP tag and embed, a Space from a
 * starter template, reporting a message, and an ignored user's message collapsed.
 */
import { expect, request as pwRequest, test, type Page } from '@playwright/test';
import type { SpaceDetail } from '@enbox/shared';
import { API_URL, apiAs, openAs, registerUser, sendAs, uniqueName, type E2EUser } from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[], name = `Club ${uniqueName('p')}`) {
  const detail = await apiAs<SpaceDetail>(owner, 'POST', '/api/spaces', { name });
  const invite = await apiAs<{ code: string }>(owner, 'POST', `/api/spaces/${detail.space.id}/invites`, {});
  for (const m of members) await apiAs(m, 'POST', `/api/invites/${invite.code}/join`);
  const general = detail.channels.find((c) => c.type === 'space_text')!.id;
  return { detail, spaceId: detail.space.id, general };
}

const row = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text });

test('a webhook posts into a channel: its name, the APP tag and a rich embed', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const hook = await apiAs<{ id: string; url: string }>(ann, 'POST', `/api/chats/${general}/webhooks`, {
    name: 'Deploy Bot',
  });
  const token = hook.url.split('/').at(-1)!;
  const ctx = await pwRequest.newContext({ baseURL: API_URL });
  const res = await ctx.post(`/api/webhooks/${hook.id}/${token}`, {
    data: {
      content: 'build finished',
      embeds: [{ title: 'Release 1.2', description: 'All checks passed', color: 0x22c55e, fields: [{ name: 'Tests', value: '94 passed', inline: true }] }],
    },
  });
  expect(res.status()).toBe(204);
  await ctx.dispose();

  const B = await openAs(browser, bob, `/spaces/${spaceId}/${general}`);
  const message = row(B.page, 'build finished');
  await expect(message.getByTestId('override-author')).toContainText('Deploy Bot');
  await expect(message.getByTestId('author-tag')).toHaveText('APP');
  const embed = message.getByTestId('rich-embed');
  await expect(embed).toContainText('Release 1.2');
  await expect(embed).toContainText('94 passed');
  await B.context.close();
});

test('a Space from a starter template has its channels', async ({ browser }) => {
  const ann = await registerUser();
  const name = `Gaming ${uniqueName('g')}`;
  const A = await openAs(browser, ann, '/spaces');
  await A.page.getByTestId('create-space').click();
  await A.page.getByTestId('add-space-starter-gaming').click();
  await A.page.getByText('For me and my friends').click();
  await A.page.getByLabel('Space name').fill(name);
  await A.page.getByTestId('create-space-submit').click();
  await expect(A.page).toHaveURL(/\/spaces\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  const channels = A.page.getByRole('navigation', { name: `${name} channels` });
  await expect(channels.getByText('clips-and-highlights', { exact: true })).toBeVisible();
  await expect(channels.getByText('Lobby', { exact: true })).toBeVisible();
  await A.context.close();
});

test('report a message: category, details, thanks', async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser({ displayName: 'Bob Spammer' })]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  const sent = await sendAs<{ id: string }>(bob, general, { type: 'text', text: 'buy cheap coins now' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await row(A.page, 'buy cheap coins now').click({ button: 'right' });
  await A.page.getByRole('menuitem', { name: 'Report Message' }).click();
  const dialog = A.page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Spam/ }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Details (optional)').fill('bot spam');
  await dialog.getByRole('button', { name: 'Submit Report' }).click();
  await expect(A.page.getByText('Thanks for letting us know')).toBeVisible();

  // The owner moderates: the report is in Space Settings ▸ Reports.
  const page = await apiAs<{ reports: { targetId: string; category: string }[] }>(
    ann,
    'GET',
    `/api/spaces/${spaceId}/reports`,
  );
  expect(page.reports).toEqual(expect.arrayContaining([expect.objectContaining({ targetId: sent.id, category: 'spam' })]));
  await A.context.close();
});

test("an ignored user's message is collapsed until Show", async ({ browser }) => {
  const [ann, bob] = await Promise.all([registerUser(), registerUser()]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await apiAs(ann, 'PUT', `/api/users/${bob.user.id}/ignore`);
  await sendAs(bob, general, { type: 'text', text: 'you cannot see me' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await expect(A.page.getByText('Ignored message').first()).toBeVisible();
  await expect(A.page.getByText('you cannot see me')).toHaveCount(0);
  await A.page.getByRole('button', { name: 'Show ignored message' }).first().click();
  await expect(A.page.getByText('you cannot see me')).toBeVisible();
  await A.context.close();
});
