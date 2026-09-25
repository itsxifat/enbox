/**
 * Conversation journeys with two (or three) real users against the real server:
 * realtime delivery + ticks, reply/react, edit/delete-for-everyone, image upload, voice
 * notes, forward and pins.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  apiAs,
  directChat,
  makeContacts,
  openAs,
  pngFixture,
  registerUser,
  sendAs,
  uploadAs,
  wavFixture,
} from './helpers';

function bubble(page: Page, text: string | RegExp): Locator {
  return page.getByTestId('message').filter({ hasText: text });
}

async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function openMenu(page: Page, text: string | RegExp): Promise<void> {
  await bubble(page, text).last().getByTestId('bubble').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Message options' })).toBeVisible();
}

test('text arrives in realtime and ticks go sent → delivered → read', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Tick' });
  const bob = await registerUser({ displayName: 'Bob Tick' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  await send(a.page, 'Hello Bob 👋 are you there?');
  const mine = bubble(a.page, 'Hello Bob');
  await expect(mine.locator('[data-status="sent"]')).toBeVisible();

  // Bob comes online (not in the chat): server-driven delivered receipt.
  const b = await openAs(browser, bob, '/chats');
  const row = b.page.getByTestId('chat-row').filter({ hasText: 'Alice Tick' });
  await expect(row).toContainText('Hello Bob');
  await expect(row.getByLabel('1 unread message')).toBeVisible();
  await expect(mine.locator('[data-status="delivered"]')).toBeVisible();

  // Bob opens the chat: read receipt → blue ticks for Alice.
  await row.click();
  await expect(bubble(b.page, 'Hello Bob')).toBeVisible();
  await expect(mine.locator('[data-status="read"]')).toBeVisible();

  // Live message the other way while both are in the chat.
  await send(b.page, 'Yes, here! 🙂');
  await expect(bubble(a.page, 'Yes, here!')).toBeVisible();
  await expect(bubble(b.page, 'Yes, here!').locator('[data-status="read"]')).toBeVisible();

  await a.context.close();
  await b.context.close();
});

test('reply and reaction appear on the other side', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Reply' });
  const bob = await registerUser({ displayName: 'Bob Reply' });
  await makeContacts(alice, bob);
  const chatId = await directChat(bob, alice);
  await sendAs(bob, chatId, { type: 'text', text: 'Pizza or sushi tonight?' });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, `/chats/${chatId}`);
  await expect(bubble(a.page, 'Pizza or sushi')).toBeVisible();

  await openMenu(a.page, 'Pizza or sushi');
  await a.page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  await expect(a.page.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
  await send(a.page, 'Sushi, obviously 🍣');

  const replyOnBob = bubble(b.page, 'Sushi, obviously');
  await expect(replyOnBob).toBeVisible();
  await expect(replyOnBob).toContainText('Pizza or sushi tonight?'); // the quote

  // Bob reacts with a quick reaction from the hover button.
  await replyOnBob.getByTestId('bubble').hover();
  await replyOnBob.getByRole('button', { name: 'React to message' }).click();
  await b.page.getByRole('button', { name: 'React ❤️' }).click();
  await expect(
    bubble(a.page, 'Sushi, obviously').getByRole('button', { name: /Reactions: ❤️ 1/ }),
  ).toBeVisible();

  // Quote tap jumps to the original message.
  await bubble(a.page, 'Sushi, obviously')
    .getByRole('button', { name: /Go to replied message/ })
    .click();
  await expect(bubble(a.page, 'Pizza or sushi tonight?').first()).toBeInViewport();

  await a.context.close();
  await b.context.close();
});

test('edit and delete for everyone propagate', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Edit' });
  const bob = await registerUser({ displayName: 'Bob Edit' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);
  await sendAs(alice, chatId, { type: 'text', text: 'Meet at 7?' });
  await sendAs(alice, chatId, { type: 'text', text: 'Oops, wrong chat' });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, `/chats/${chatId}`);
  await expect(bubble(b.page, 'Meet at 7?')).toBeVisible();

  await openMenu(a.page, 'Meet at 7?');
  await a.page.getByRole('menuitem', { name: 'Edit' }).click();
  const box = a.page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(box).toHaveValue('Meet at 7?');
  await box.fill('Meet at 8?');
  await a.page.getByRole('button', { name: 'Save edit' }).click();
  await expect(bubble(b.page, 'Meet at 8?')).toContainText('Edited');

  await openMenu(a.page, 'Oops, wrong chat');
  await a.page.getByRole('menuitem', { name: 'Delete' }).click();
  await a.page.getByRole('button', { name: 'Delete for everyone' }).click();
  await expect(
    a.page.getByTestId('message-list').getByText('You deleted this message'),
  ).toBeVisible();
  await expect(
    b.page.getByTestId('message-list').getByText('This message was deleted'),
  ).toBeVisible();
  await expect(b.page.getByText('Oops, wrong chat')).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test('image upload shows in both chats', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Photo' });
  const bob = await registerUser({ displayName: 'Bob Photo' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, '/chats');

  await a.page
    .locator('input[type="file"][accept="image/*,video/*"]')
    .first()
    .setInputFiles({
      name: 'sunset.png',
      mimeType: 'image/png',
      buffer: await pngFixture(320, 200),
    });
  const dialog = a.page.getByRole('dialog', { name: 'Send photos and videos' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Caption' }).fill('Look at this sunset');
  await dialog.getByRole('button', { name: 'Send' }).click();

  const photo = bubble(a.page, 'Look at this sunset');
  await expect(photo.getByRole('button', { name: 'Open photo' })).toBeVisible();
  await expect(photo.locator('[data-status="delivered"], [data-status="read"]')).toBeVisible();

  await b.page.getByTestId('chat-row').filter({ hasText: 'Alice Photo' }).click();
  const received = bubble(b.page, 'Look at this sunset');
  await expect(received.getByRole('img', { name: 'Look at this sunset' })).toBeVisible();
  // Opens the lightbox.
  await received.getByRole('button', { name: 'Open photo' }).click();
  await expect(b.page.getByRole('dialog', { name: 'Media viewer' })).toBeVisible();
  await b.page.keyboard.press('Escape');
  await expect(b.page.getByRole('dialog', { name: 'Media viewer' })).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test('voice notes render and play', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Voice' });
  const bob = await registerUser({ displayName: 'Bob Voice' });
  await makeContacts(alice, bob);
  const chatId = await directChat(bob, alice);
  const media = await uploadAs(
    bob,
    { name: 'voice.wav', mimeType: 'audio/wav', buffer: wavFixture(2) },
    { kind: 'voice', durationMs: '2000', waveform: JSON.stringify([0.2, 0.8, 0.5, 1, 0.3]) },
  );
  await sendAs(bob, chatId, { type: 'voice', mediaId: media.id });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const note = a.page.getByTestId('voice-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('0:02');
  await note.getByRole('button', { name: 'Play voice message' }).click();
  await expect(note.getByRole('button', { name: 'Pause voice message' })).toBeVisible();
  await expect(note.getByRole('button', { name: /Playback speed 1×/ })).toBeVisible();
  await note.getByRole('button', { name: /Playback speed/ }).click();
  await expect(note.getByRole('button', { name: /Playback speed 1.5×/ })).toBeVisible();

  // The chat list preview reads "0:02" with a mic icon.
  await expect(a.page.getByTestId('chat-row').filter({ hasText: 'Bob Voice' })).toContainText(
    '0:02',
  );
  await a.context.close();
});

test('forward a message to another chat', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Fwd' });
  const bob = await registerUser({ displayName: 'Bob Fwd' });
  const carol = await registerUser({ displayName: 'Carol Fwd' });
  await makeContacts(alice, bob);
  await makeContacts(alice, carol);
  const withBob = await directChat(bob, alice);
  const withCarol = await directChat(alice, carol);
  await sendAs(alice, withCarol, { type: 'text', text: 'Hi Carol' });
  await sendAs(bob, withBob, { type: 'text', text: 'The wifi password is enbox2026' });

  const a = await openAs(browser, alice, `/chats/${withBob}`);
  const c = await openAs(browser, carol, `/chats/${withCarol}`);
  await openMenu(a.page, 'wifi password');
  await a.page.getByRole('menuitem', { name: 'Forward' }).click();
  const dialog = a.page.getByRole('dialog', { name: /Forward message/ });
  await dialog.getByRole('searchbox').fill('Carol');
  await dialog.getByRole('button', { name: /Carol Fwd/ }).click();
  await dialog.getByRole('button', { name: 'Forward' }).click();

  const fwd = bubble(c.page, 'wifi password');
  await expect(fwd).toBeVisible();
  await expect(fwd).toContainText('Forwarded');
  await a.context.close();
  await c.context.close();
});

test('pinning a message shows the pinned bar for both', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Pin' });
  const bob = await registerUser({ displayName: 'Bob Pin' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);
  await sendAs(alice, chatId, { type: 'text', text: 'Address: 221B Baker Street' });
  await sendAs(bob, chatId, { type: 'text', text: 'Thanks!' });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, `/chats/${chatId}`);
  await openMenu(a.page, '221B Baker Street');
  await a.page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect(a.page.getByTestId('pinned-bar')).toContainText('221B Baker Street');
  await expect(b.page.getByTestId('pinned-bar')).toContainText('221B Baker Street');
  await expect(
    b.page.getByTestId('message-list').getByText('Alice Pin pinned a message'),
  ).toBeVisible();

  await b.page.getByTestId('pinned-bar').getByRole('button', { name: 'Unpin message' }).click();
  await expect(a.page.getByTestId('pinned-bar')).toHaveCount(0);
  await a.context.close();
  await b.context.close();
});

test('search in chat jumps to an older message', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Search' });
  const bob = await registerUser({ displayName: 'Bob Search' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);
  await sendAs(alice, chatId, { type: 'text', text: 'The secret word is pelican' });
  for (let i = 1; i <= 70; i++)
    await sendAs(i % 2 ? bob : alice, chatId, { type: 'text', text: `filler message ${i}` });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  await expect(bubble(a.page, 'filler message 70')).toBeVisible();
  await a.page.getByRole('button', { name: 'Search in chat' }).click();
  await a.page.getByRole('searchbox', { name: 'Search in chat' }).fill('pelican');
  await expect(a.page.getByTestId('chat-search')).toContainText('1 of 1');
  const target = bubble(a.page, 'secret word is pelican');
  await expect(target).toBeInViewport();
  await expect(target.locator('mark')).toHaveText('pelican');
  await a.context.close();
});

test('a message sent while offline arrives after reconnecting', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Offline' });
  const bob = await registerUser({ displayName: 'Bob Offline' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);
  await sendAs(alice, chatId, { type: 'text', text: 'Before going offline' });

  const b = await openAs(browser, bob, `/chats/${chatId}`);
  await expect(bubble(b.page, 'Before going offline')).toBeVisible();
  await b.context.setOffline(true);
  await expect(b.page.getByText("You're offline")).toBeVisible();
  await sendAs(alice, chatId, { type: 'text', text: 'Sent while you were away' });
  await apiAs(alice, 'GET', `/api/chats/${chatId}`);
  await b.context.setOffline(false);
  await expect(bubble(b.page, 'Sent while you were away')).toBeVisible({ timeout: 20_000 });
  await b.context.close();
});

test('messages written offline stay pending and send on reconnect', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Outbox' });
  const bob = await registerUser({ displayName: 'Bob Outbox' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);
  await sendAs(alice, chatId, { type: 'text', text: 'Hello' });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, `/chats/${chatId}`);
  await expect(bubble(a.page, 'Hello')).toBeVisible();
  await a.context.setOffline(true);
  await expect(a.page.getByText("You're offline")).toBeVisible();
  await send(a.page, 'Written in the tunnel 🚇');
  const queued = bubble(a.page, 'Written in the tunnel');
  await expect(queued.locator('[data-status="pending"]')).toBeVisible();
  await expect(a.page.getByText('Not sent. Tap to retry')).toHaveCount(0);

  await a.context.setOffline(false);
  await expect(bubble(b.page, 'Written in the tunnel')).toBeVisible({ timeout: 20_000 });
  await expect(queued.locator('[data-status="read"]')).toBeVisible();
  await a.context.close();
  await b.context.close();
});
