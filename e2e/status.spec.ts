/**
 * Status / stories (agent 4): post, realtime feed with unseen ring, view counts, replies as
 * direct messages quoting the status, reactions, and the "only share with" privacy rule.
 */
import { expect, test } from '@playwright/test';
import type { ChatSummary, MessagePage } from '@enbox/shared';
import { apiAs, makeContacts, openAs, registerUser } from './helpers';

test('text status: realtime unseen ring, view count, reply as a direct message, reaction', async ({
  browser,
}) => {
  const a = await registerUser({ displayName: 'Ava Status' });
  const b = await registerUser({ displayName: 'Ben Viewer' });
  await makeContacts(a, b);
  const A = await openAs(browser, a, '/updates');
  const B = await openAs(browser, b, '/updates');
  await expect(B.page.getByTestId('my-status')).toBeVisible();

  // A posts a text status from the composer.
  await A.page.getByRole('button', { name: 'New text status' }).click();
  await A.page.getByLabel('Status text').fill('Hello from my status');
  await A.page.getByRole('button', { name: 'Change background color' }).click();
  await A.page.getByRole('button', { name: /Change font/ }).click();
  await A.page.getByRole('button', { name: 'Send status' }).click();
  await expect(A.page.getByTestId('status-composer')).toBeHidden();
  await expect(A.page.getByTestId('my-status')).toContainText('Just now');

  // B sees it in realtime, with an unseen ring, and opens it.
  const row = B.page.locator(`[data-testid="status-row"][data-user-id="${a.user.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-unseen', '');
  await row.click();
  await expect(B.page.getByTestId('status-text')).toHaveText('Hello from my status');

  // A's own status shows 1 view (live).
  await A.page.getByTestId('my-status').click();
  await A.page.getByRole('button', { name: 'Pause' }).click();
  await expect(A.page.getByTestId('status-views')).toContainText('1 view');

  // B replies (a direct message with the status quote) and reacts.
  await B.page.getByLabel('Reply').fill('Nice status!');
  await B.page.getByRole('button', { name: 'Send reply' }).click();
  await expect(B.page.getByText('Reply sent')).toBeVisible();
  await B.page.getByLabel('Reply').click();
  await B.page.getByRole('button', { name: 'React 😂' }).click();

  const chat = await apiAs<ChatSummary>(a, 'POST', '/api/chats/direct', { userId: b.user.id });
  await expect
    .poll(async () => {
      const page = await apiAs<MessagePage>(a, 'GET', `/api/chats/${chat.id}/messages`);
      const m = page.messages.find((x) => x.text === 'Nice status!');
      return m?.statusReply
        ? {
            author: m.statusReply.authorId,
            text: m.statusReply.text,
            available: m.statusReply.available,
          }
        : null;
    })
    .toEqual({ author: a.user.id, text: 'Hello from my status', available: true });

  // The reaction updates B's existing view (status:viewed firstView=false): still 1 view.
  await expect(A.page.getByTestId('status-views')).toContainText('1 view');
  // A sees the reaction in the viewers list…
  await A.page.getByTestId('status-views').click();
  await expect(A.page.getByTestId('status-viewers')).toContainText('Ben Viewer');
  await expect(A.page.getByLabel('Reacted 😂')).toBeVisible();
  // …and the reply in the chat list, in realtime.
  await A.page.goto('/chats');
  await expect(A.page.getByText('Nice status!')).toBeVisible();

  // After viewing, B's row moves to "Viewed updates" (no unseen ring).
  await B.page.keyboard.press('Escape');
  await expect(row).not.toHaveAttribute('data-unseen', '');
  await A.context.close();
  await B.context.close();
});

test('privacy "only share with" hides a status from other contacts; delete removes it live', async ({
  browser,
}) => {
  const a = await registerUser({ displayName: 'Ava Private' });
  const b = await registerUser({ displayName: 'Ben Chosen' });
  const c = await registerUser({ displayName: 'Cleo Excluded' });
  await makeContacts(a, b);
  await makeContacts(a, c);
  const A = await openAs(browser, a, '/updates');

  // Status privacy → Only share with… → Ben.
  await A.page.getByRole('button', { name: 'Status options' }).click();
  await A.page.getByRole('menuitem', { name: 'Status privacy' }).click();
  await A.page.getByText('Only share with…').click();
  await A.page.getByText('Ben Chosen').click();
  await A.page.getByRole('button', { name: 'Done' }).click();
  await expect(A.page.getByText('1 contact selected')).toBeVisible();
  await A.page.getByRole('button', { name: 'Save' }).click();
  await expect(A.page.getByText('Status privacy updated')).toBeVisible();

  const B = await openAs(browser, b, '/updates');
  const C = await openAs(browser, c, '/updates');
  await expect(C.page.getByTestId('my-status')).toBeVisible();

  const status = await apiAs<{ id: string }>(a, 'POST', '/api/status', {
    type: 'text',
    text: 'Only for Ben',
  });
  await expect(
    B.page.locator(`[data-testid="status-row"][data-user-id="${a.user.id}"]`),
  ).toBeVisible();
  // C never gets it (neither live nor on reload).
  await C.page.reload();
  await expect(C.page.getByTestId('my-status')).toBeVisible();
  await expect(
    C.page.locator(`[data-testid="status-row"][data-user-id="${a.user.id}"]`),
  ).toHaveCount(0);
  const feed = await apiAs<{ updates: { user: { id: string } }[] }>(c, 'GET', '/api/status/feed');
  expect(feed.updates.some((u) => u.user.id === a.user.id)).toBe(false);

  // A deletes it from the viewer → it disappears for B live.
  await A.page.getByTestId('my-status').click();
  await A.page.getByRole('button', { name: 'Status menu' }).click();
  await A.page.getByRole('menuitem', { name: 'Delete' }).click();
  await A.page.getByRole('button', { name: 'Delete' }).click();
  await expect(A.page.getByTestId('status-viewer')).toBeHidden();
  await expect(
    B.page.locator(`[data-testid="status-row"][data-user-id="${a.user.id}"]`),
  ).toHaveCount(0);
  const gone = await apiAs<{ mine: { id: string }[] }>(a, 'GET', '/api/status/feed');
  expect(gone.mine.some((s) => s.id === status.id)).toBe(false);
  await Promise.all([A.context.close(), B.context.close(), C.context.close()]);
});
