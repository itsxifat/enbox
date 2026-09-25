/**
 * Composer attachments end-to-end: recorded voice note (fake microphone), poll + live vote,
 * manual location, contact card, and a document.
 */
import { expect, test, type Page } from '@playwright/test';
import { directChat, makeContacts, openAs, registerUser, sendAs } from './helpers';

async function attach(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('record and send a voice note (fake microphone)', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Mic' });
  const bob = await registerUser({ displayName: 'Bob Mic' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);
  await sendAs(alice, chatId, { type: 'text', text: 'Listen to this' });

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, '/chats');
  await expect(b.page.getByTestId('chat-row').filter({ hasText: 'Alice Mic' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Record voice message' }).click();
  await expect(a.page.getByTestId('voice-recorder')).toBeVisible();
  // Bob sees "recording audio…" in his chat list.
  await expect(b.page.getByTestId('chat-row').filter({ hasText: 'Alice Mic' })).toContainText(
    'recording audio…',
  );
  await expect(a.page.getByTestId('voice-recorder')).toContainText('0:01', { timeout: 5_000 });
  await a.page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(a.page.getByTestId('voice-note')).toBeVisible();
  await b.page.getByTestId('chat-row').filter({ hasText: 'Alice Mic' }).click();
  const note = b.page.getByTestId('voice-note');
  await expect(note).toBeVisible();
  await expect(note.getByRole('button', { name: 'Play voice message' })).toBeVisible();
  await a.context.close();
  await b.context.close();
});

test('create a poll and see votes live', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Poll' });
  const bob = await registerUser({ displayName: 'Bob Poll' });
  await makeContacts(alice, bob);
  const chatId = await directChat(alice, bob);

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  const b = await openAs(browser, bob, `/chats`);
  await attach(a.page, 'Poll');
  const dialog = a.page.getByRole('dialog', { name: 'Create poll' });
  await dialog.getByLabel('Question').fill('Movie night?');
  await dialog.getByLabel('Option 1').fill('Friday');
  await dialog.getByLabel('Option 2').fill('Saturday');
  await dialog.getByRole('button', { name: 'Send poll' }).click();

  const poll = a.page.getByRole('group', { name: 'Poll: Movie night?' });
  await expect(poll).toBeVisible();

  await b.page.getByTestId('chat-row').filter({ hasText: 'Alice Poll' }).click();
  const bobPoll = b.page.getByRole('group', { name: 'Poll: Movie night?' });
  await bobPoll.getByRole('radio', { name: /Saturday/ }).click();
  await expect(bobPoll.getByRole('radio', { name: /Saturday/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(poll).toContainText('1 voter');
  await poll.getByRole('button', { name: 'View votes' }).click();
  await expect(a.page.getByRole('dialog', { name: 'Poll details' })).toContainText('Bob Poll');
  await a.context.close();
  await b.context.close();
});

test('share a location, a contact card and a document', async ({ browser }) => {
  const alice = await registerUser({ displayName: 'Alice Share' });
  const bob = await registerUser({ displayName: 'Bob Share' });
  const carol = await registerUser({ displayName: 'Carol Card' });
  await makeContacts(alice, bob);
  await makeContacts(alice, carol);
  const chatId = await directChat(alice, bob);

  const a = await openAs(browser, alice, `/chats/${chatId}`);
  await attach(a.page, 'Location');
  const loc = a.page.getByRole('dialog', { name: 'Send location' });
  // Without geolocation permission the manual form opens directly.
  const manual = loc.getByRole('button', { name: 'Enter a place manually' });
  await expect(loc.getByLabel('Place name').or(manual)).toBeVisible();
  if (await manual.isVisible()) await manual.click();
  await loc.getByLabel('Place name').fill('Eiffel Tower');
  await loc.getByLabel('Latitude').fill('48.8584');
  await loc.getByLabel('Longitude').fill('2.2945');
  await loc.getByRole('button', { name: 'Send' }).click();
  await expect(a.page.getByTestId('message').filter({ hasText: 'Eiffel Tower' })).toBeVisible();
  await expect(a.page.getByRole('link', { name: 'Open Eiffel Tower in maps' })).toHaveAttribute(
    'href',
    /openstreetmap\.org/,
  );

  await attach(a.page, 'Contact');
  const pick = a.page.getByRole('dialog', { name: 'Share contact' });
  await pick.getByRole('button', { name: /Carol Card/ }).click();
  const card = a.page.getByTestId('message').filter({ hasText: 'Carol Card' });
  await expect(card).toBeVisible();

  await a.page.locator('input[type="file"]:not([accept])').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Meeting notes\n- ship it\n'),
  });
  const doc = a.page.getByTestId('message').filter({ hasText: 'notes.txt' });
  await expect(doc).toBeVisible();
  await expect(doc.getByRole('link', { name: 'Download notes.txt' })).toBeVisible();

  // Bob receives all three.
  const b = await openAs(browser, bob, `/chats/${chatId}`);
  await expect(b.page.getByTestId('message').filter({ hasText: 'Eiffel Tower' })).toBeVisible();
  await expect(
    b.page
      .getByTestId('message')
      .filter({ hasText: 'Carol Card' })
      .getByRole('button', { name: 'Message', exact: true }),
  ).toBeVisible();
  await expect(b.page.getByTestId('message').filter({ hasText: 'notes.txt' })).toBeVisible();
  await a.context.close();
  await b.context.close();
});
