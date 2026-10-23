/**
 * The everyday wave: channel intros, channel mentions and highlighted code, the leaving-Enbox
 * warning, @silent, the user menu's Mention, bookmarks in the Inbox, friend invite links and
 * the title bar's Back.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FriendInvite, Message, SpaceDetail } from '@enbox/shared';
import { apiAs, openAs, registerUser, sendAs, uniqueName, type E2EUser } from './helpers';

async function spaceWith(owner: E2EUser, members: E2EUser[], name = `Club ${uniqueName('e')}`) {
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

test('a channel opens with its intro; channel mentions and code read like the real thing', async ({
  browser,
}) => {
  const ann = await registerUser();
  const { spaceId, general } = await spaceWith(ann, []);
  await sendAs(ann, general, { type: 'text', text: `details in #{${general}}` });
  await sendAs(ann, general, { type: 'text', text: '```js\nconst answer = 42;\n```' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await expect(A.page.getByTestId('channel-intro')).toContainText('Welcome to');
  await expect(
    row(A.page, 'details in').locator(`[data-channel-mention="${general}"]`),
  ).toContainText('general');
  await expect(row(A.page, 'answer').locator('.hljs-keyword').first()).toHaveText('const');
  await A.context.close();
});

test('links to other sites ask first', async ({ browser }) => {
  const ann = await registerUser();
  const { spaceId, general } = await spaceWith(ann, []);
  await sendAs(ann, general, { type: 'text', text: 'look https://example.com/page' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await row(A.page, 'look').getByRole('link', { name: /example\.com/ }).click();
  const dialog = A.page.getByRole('dialog', { name: 'Leaving Enbox' });
  await expect(dialog).toContainText('https://example.com/page');
  await dialog.getByRole('button', { name: 'Go back' }).click();
  await expect(dialog).toBeHidden();
  await A.context.close();
});

test('@silent sends without the prefix', async ({ browser }) => {
  const ann = await registerUser();
  const { spaceId, general } = await spaceWith(ann, []);
  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  const box = A.page.getByRole('textbox', { name: 'Message' });
  await box.fill('@silent quiet hello');
  await expect(A.page.getByRole('img', { name: 'Silent message: no one gets notified' })).toBeVisible();
  await box.press('Enter');
  await expect(row(A.page, 'quiet hello')).toBeVisible();
  await expect(row(A.page, 'quiet hello')).not.toContainText('@silent');
  await A.context.close();
});

test('the user menu mentions someone in the message box', async ({ browser }) => {
  const [ann, bob] = await Promise.all([
    registerUser(),
    registerUser({ displayName: `Bob ${uniqueName('m')}` }),
  ]);
  const { spaceId, general } = await spaceWith(ann, [bob]);
  await sendAs(bob, general, { type: 'text', text: 'mention me please' });

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await row(A.page, 'mention me please')
    .getByRole('button', { name: `Profile of ${bob.user.displayName}` })
    .first()
    .click({ button: 'right' });
  await A.page.getByRole('menuitem', { name: 'Mention' }).click();
  await expect(A.page.getByRole('textbox', { name: 'Message' })).toHaveValue(
    `@${bob.user.displayName} `,
  );
  await A.context.close();
});

test('a bookmarked message shows in the Inbox', async ({ browser }) => {
  const ann = await registerUser();
  const { spaceId, general } = await spaceWith(ann, []);
  const msg = await sendAs<Message>(ann, general, { type: 'text', text: 'save this for later' });
  await apiAs(ann, 'PUT', `/api/messages/${msg.id}/bookmark`, {});

  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await A.page.getByRole('button', { name: 'Inbox' }).first().click();
  await A.page.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(A.page.getByText('save this for later').last()).toBeVisible();
  await A.context.close();
});

test('a friend invite link makes friends', async ({ browser }) => {
  const [ann, bob] = await Promise.all([
    registerUser({ displayName: `Ann ${uniqueName('i')}` }),
    registerUser(),
  ]);
  const invite = await apiAs<FriendInvite>(ann, 'POST', '/api/me/friend-invites');

  const B = await openAs(browser, bob, `/friend/${invite.code}`);
  await expect(B.page.getByText(ann.user.displayName).first()).toBeVisible();
  await B.page.getByRole('button', { name: 'Accept Invite' }).click();
  await expect(B.page.getByRole('button', { name: 'Send Message' })).toBeVisible();
  await B.context.close();
});

test('the title bar goes back', async ({ browser }) => {
  const ann = await registerUser();
  const { spaceId, general } = await spaceWith(ann, []);
  const A = await openAs(browser, ann, `/spaces/${spaceId}/${general}`);
  await expect(A.page.getByTestId('title-bar-place')).toContainText('general');
  await A.page.getByRole('link', { name: 'Browse Channels' }).click();
  await expect(A.page).not.toHaveURL(new RegExp(`/${general}$`));
  await A.page.getByTestId('title-bar').getByRole('button', { name: 'Back' }).click();
  await expect(A.page).toHaveURL(new RegExp(`/spaces/${spaceId}/${general}$`));
  await A.context.close();
});
