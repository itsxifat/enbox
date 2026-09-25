/**
 * Calls (agent 4): 1:1 voice/video calls, decline/cancel, call log, group mesh call with
 * three browsers. Real server + Chromium fake camera/microphone (see playwright.config.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import type { Call, ChatSummary, MessagePage } from '@enbox/shared';
import { apiAs, makeContacts, openAs, registerUser, type E2EUser } from './helpers';

async function startFromNewCall(page: Page, name: string, type: 'Voice' | 'Video') {
  await page.goto('/calls/new');
  await page
    .getByTestId('new-call')
    .getByRole('button', { name: `${type} call ${name}` })
    .click();
  await expect(page.getByTestId('call-screen')).toBeVisible();
}

const incoming = (page: Page) => page.getByTestId('incoming-call');
const callScreen = (page: Page) => page.getByTestId('call-screen');

async function directChat(a: E2EUser, b: E2EUser): Promise<ChatSummary> {
  return apiAs<ChatSummary>(a, 'POST', '/api/chats/direct', { userId: b.user.id });
}

test.describe('1:1 calls', () => {
  test('voice call: ring, accept, connect, hang up, duration in the log', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Ava Caller' });
    const b = await registerUser({ displayName: 'Ben Callee' });
    await makeContacts(a, b);
    const A = await openAs(browser, a, '/calls');
    const B = await openAs(browser, b, '/calls');

    await startFromNewCall(A.page, 'Ben Callee', 'Voice');
    await expect(incoming(B.page)).toBeVisible();
    await expect(incoming(B.page)).toContainText('Ava Caller');
    // The caller's UI switches to "Ringing…" once B's device rings.
    await expect(A.page.getByTestId('call-status')).toHaveText('Ringing…');

    await B.page.getByRole('button', { name: 'Accept' }).click();
    await expect(callScreen(A.page)).toHaveAttribute('data-phase', 'connected', {
      timeout: 20_000,
    });
    await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected', {
      timeout: 20_000,
    });
    await expect(A.page.getByTestId('call-timer')).toHaveText(/^\d+:\d{2}$/);
    // Let the timer run so the call has a duration.
    await expect(A.page.getByTestId('call-timer')).toHaveText(/^0:0[2-9]$/, { timeout: 10_000 });

    // Mute is mirrored to the peer.
    await B.page.getByRole('button', { name: 'Mute' }).click();
    await expect(A.page.getByText('Muted', { exact: true })).toBeVisible();

    await A.page.getByRole('button', { name: 'End call' }).click();
    await expect(B.page.getByTestId('call-end-reason')).toHaveText(/Call ended · 0:0\d/);
    await expect(callScreen(A.page)).toBeHidden({ timeout: 10_000 });
    await expect(callScreen(B.page)).toBeHidden({ timeout: 10_000 });

    // The chat's call message carries the final status and duration.
    const chat = await directChat(a, b);
    const page = await apiAs<MessagePage>(a, 'GET', `/api/chats/${chat.id}/messages`);
    const msg = page.messages.find((m) => m.type === 'call');
    expect(msg?.call).toMatchObject({ status: 'ended', callType: 'audio' });
    expect(msg?.call?.durationSec ?? 0).toBeGreaterThan(0);

    // Both call logs show it with its duration.
    await A.page.goto('/calls');
    await expect(A.page.getByTestId('call-log-row').first()).toContainText('Ben Callee');
    await expect(A.page.getByTestId('call-log-subtitle').first()).toContainText(/0:0\d/);
    await B.page.goto('/calls');
    await expect(B.page.getByTestId('call-log-row').first()).toContainText('Ava Caller');
    await A.context.close();
    await B.context.close();
  });

  test('decline: the caller sees "Declined"; cancel: the callee gets a missed call', async ({
    browser,
  }) => {
    const a = await registerUser({ displayName: 'Ava Decline' });
    const b = await registerUser({ displayName: 'Ben Decline' });
    await makeContacts(a, b);
    const A = await openAs(browser, a, '/calls');
    const B = await openAs(browser, b, '/calls');

    await startFromNewCall(A.page, 'Ben Decline', 'Voice');
    await expect(incoming(B.page)).toBeVisible();
    await B.page.getByRole('button', { name: 'Decline' }).click();
    await expect(incoming(B.page)).toBeHidden();
    await expect(A.page.getByTestId('call-end-reason')).toHaveText('Declined');
    await A.page.getByRole('button', { name: 'Close' }).click();
    await expect(callScreen(A.page)).toBeHidden();

    // Second call: A cancels while it rings → B's ringing stops, B has a missed call.
    await startFromNewCall(A.page, 'Ben Decline', 'Voice');
    await expect(incoming(B.page)).toBeVisible();
    await A.page.getByRole('button', { name: 'Cancel call' }).click();
    await expect(incoming(B.page)).toBeHidden();
    await B.page.getByRole('tab', { name: /Missed/ }).click();
    await expect(B.page.getByTestId('call-log-row')).toHaveCount(1);
    await expect(B.page.getByTestId('call-log-row').first()).toContainText('Ava Decline');

    // The declined call shows in A's log.
    await A.page.goto('/calls');
    await expect(A.page.getByTestId('call-log-subtitle').first()).toContainText(
      /Cancelled|Declined/,
    );
    await A.context.close();
    await B.context.close();
  });

  test('video call: both sides receive and play remote video', async ({ browser }) => {
    const a = await registerUser({ displayName: 'Ava Video' });
    const b = await registerUser({ displayName: 'Ben Video' });
    await makeContacts(a, b);
    const A = await openAs(browser, a, '/calls');
    const B = await openAs(browser, b, '/calls');

    await startFromNewCall(A.page, 'Ben Video', 'Video');
    await expect(incoming(B.page)).toContainText('video call');
    await B.page.getByRole('button', { name: 'Accept' }).click();
    for (const page of [A.page, B.page]) {
      await expect(callScreen(page)).toHaveAttribute('data-phase', 'connected', {
        timeout: 20_000,
      });
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const v = document.querySelector<HTMLVideoElement>('video[data-remote-video]');
              return !!v && !v.paused && v.videoWidth > 0 && v.readyState >= 2;
            }),
          { timeout: 20_000 },
        )
        .toBe(true);
    }
    // Camera off on B → A falls back to B's avatar (no remote video).
    await B.page.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(A.page.locator('video[data-remote-video]')).toHaveCount(0, { timeout: 10_000 });

    // Minimize and restore on A.
    await A.page.getByRole('button', { name: 'Minimize call' }).click();
    await expect(A.page.getByTestId('call-mini')).toBeVisible();
    await A.page.getByRole('button', { name: 'Return to call' }).click();
    await expect(callScreen(A.page)).toBeVisible();

    await B.page.getByRole('button', { name: 'End call' }).click();
    await expect(A.page.getByTestId('call-end-reason')).toContainText('Call ended');
    await A.context.close();
    await B.context.close();
  });
});

test('socket drop mid-call: reconnecting UI, call:rejoin, media reconnects', async ({
  browser,
}) => {
  const a = await registerUser({ displayName: 'Ava Rejoin' });
  const b = await registerUser({ displayName: 'Ben Rejoin' });
  await makeContacts(a, b);
  const A = await openAs(browser, a, '/calls');
  const B = await openAs(browser, b, '/calls');
  // Test-side only: keep the page's WebSockets so the test can drop the Socket.IO one.
  await B.context.addInitScript(() => {
    const Native = window.WebSocket;
    const list: WebSocket[] = [];
    (window as unknown as { __sockets: WebSocket[] }).__sockets = list;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        list.push(this);
      }
    };
  });
  await B.page.reload();

  await startFromNewCall(A.page, 'Ben Rejoin', 'Voice');
  await B.page.getByRole('button', { name: 'Accept' }).click();
  await expect(callScreen(A.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });

  await B.page.evaluate(() =>
    (window as unknown as { __sockets: WebSocket[] }).__sockets
      .filter((ws) => ws.url.includes('/socket.io/'))
      .forEach((ws) => ws.close()),
  );
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'reconnecting');
  await expect(B.page.getByText('Reconnecting…')).toBeVisible();
  // Rejoin: B acts as a newcomer; both sides reconnect their peer connection.
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  await expect(callScreen(A.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  await B.page.getByRole('button', { name: 'End call' }).click();
  await expect(A.page.getByTestId('call-end-reason')).toContainText('Call ended');
  await A.context.close();
  await B.context.close();
});

test('group call: three participants in a mesh, join from the Calls tab, leave', async ({
  browser,
}) => {
  const a = await registerUser({ displayName: 'Ava Group' });
  const b = await registerUser({ displayName: 'Ben Group' });
  const c = await registerUser({ displayName: 'Cleo Group' });
  await makeContacts(a, b);
  await makeContacts(a, c);
  await apiAs(a, 'POST', '/api/groups', {
    name: 'Mesh Test Group',
    memberIds: [b.user.id, c.user.id],
  });

  const A = await openAs(browser, a, '/calls');
  const B = await openAs(browser, b, '/calls');
  const C = await openAs(browser, c, '/calls');

  await startFromNewCall(A.page, 'Mesh Test Group', 'Voice');
  await expect(incoming(B.page)).toContainText('Mesh Test Group');
  await expect(incoming(C.page)).toBeVisible();
  await B.page.getByRole('button', { name: 'Accept' }).click();
  await C.page.getByRole('button', { name: 'Decline' }).click();
  await expect(callScreen(A.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });

  // C joins the ongoing call from the Calls tab.
  await expect(C.page.getByRole('button', { name: 'Join' })).toBeVisible();
  await C.page.getByRole('button', { name: 'Join' }).click();
  await expect(callScreen(C.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });

  // Everyone has a connected peer connection to both others.
  for (const [page, others] of [
    [A.page, [b, c]],
    [B.page, [a, c]],
    [C.page, [a, b]],
  ] as const) {
    for (const u of others) {
      await expect(
        page.locator(`[data-testid="call-tile"][data-user-id="${u.user.id}"]`),
      ).toHaveAttribute('data-connection', 'connected', {
        timeout: 20_000,
      });
    }
  }

  // C leaves: the call goes on for A and B.
  await C.page.getByRole('button', { name: 'End call' }).click();
  await expect(
    A.page.locator(`[data-testid="call-tile"][data-user-id="${c.user.id}"]`),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected');

  await A.page.getByRole('button', { name: 'End call' }).click();
  await expect(B.page.getByTestId('call-end-reason')).toContainText('Call ended');
  await Promise.all([A.context.close(), B.context.close(), C.context.close()]);
});

test('page reload mid-call: the tab rejoins the call instead of leaving it', async ({
  browser,
}) => {
  const a = await registerUser({ displayName: 'Ava Reload' });
  const b = await registerUser({ displayName: 'Ben Reload' });
  await makeContacts(a, b);
  const A = await openAs(browser, a, '/calls');
  const B = await openAs(browser, b, '/calls');

  await startFromNewCall(A.page, 'Ben Reload', 'Voice');
  await B.page.getByRole('button', { name: 'Accept' }).click();
  await expect(callScreen(A.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });

  // Confirm the "leave this page?" prompt the call puts up.
  B.page.on('dialog', (d) => void d.accept());
  await B.page.reload();
  // The reloaded tab rejoins (retrying while the server still sees its old socket)…
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  await expect(callScreen(A.page)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
  // …and the call never ended in between (pagehide no longer sends call:leave).
  const live = await apiAs<Call[]>(a, 'GET', '/api/calls/active');
  expect(live).toHaveLength(1);
  expect(live[0]!.participants.every((p) => p.status === 'joined')).toBe(true);

  await B.page.getByRole('button', { name: 'End call' }).click();
  await expect(A.page.getByTestId('call-end-reason')).toContainText('Call ended');
  await A.context.close();
  await B.context.close();
});

test('removed from the group mid-call: the call ends for the removed member only', async ({
  browser,
}) => {
  const a = await registerUser({ displayName: 'Ava Admin' });
  const b = await registerUser({ displayName: 'Ben Stays' });
  const c = await registerUser({ displayName: 'Cleo Removed' });
  await makeContacts(a, b);
  await makeContacts(a, c);
  const { chat } = await apiAs<{ chat: ChatSummary }>(a, 'POST', '/api/groups', {
    name: 'Removal Test Group',
    memberIds: [b.user.id, c.user.id],
  });

  const A = await openAs(browser, a, '/calls');
  const B = await openAs(browser, b, '/calls');
  const C = await openAs(browser, c, '/calls');
  await startFromNewCall(A.page, 'Removal Test Group', 'Voice');
  await expect(incoming(B.page)).toBeVisible();
  await expect(incoming(C.page)).toBeVisible();
  await B.page.getByRole('button', { name: 'Accept' }).click();
  await C.page.getByRole('button', { name: 'Accept' }).click();
  for (const page of [A.page, B.page, C.page]) {
    await expect(callScreen(page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  }

  await apiAs(a, 'DELETE', `/api/groups/${chat.id}/members/${c.user.id}`);
  // C only learns it from call:updated (its call socket was released first).
  await expect(callScreen(C.page)).toBeHidden({ timeout: 15_000 });
  await expect(
    A.page.locator(`[data-testid="call-tile"][data-user-id="${c.user.id}"]`),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected');

  await A.page.getByRole('button', { name: 'End call' }).click();
  await expect(B.page.getByTestId('call-end-reason')).toContainText('Call ended');
  await Promise.all([A.context.close(), B.context.close(), C.context.close()]);
});

test('two calls at once: the second one rings once the first is declined', async ({ browser }) => {
  const a = await registerUser({ displayName: 'Ava First' });
  const b = await registerUser({ displayName: 'Ben Popular' });
  const c = await registerUser({ displayName: 'Cleo Second' });
  await makeContacts(a, b);
  await makeContacts(c, b);
  const A = await openAs(browser, a, '/calls');
  const B = await openAs(browser, b, '/calls');
  const C = await openAs(browser, c, '/calls');

  await startFromNewCall(A.page, 'Ben Popular', 'Voice');
  await expect(incoming(B.page)).toContainText('Ava First');
  await startFromNewCall(C.page, 'Ben Popular', 'Voice');
  // One incoming call UI at a time: the second call waits.
  await expect(incoming(B.page)).toHaveCount(1);
  await expect(incoming(B.page)).toContainText('Ava First');

  await B.page.getByRole('button', { name: 'Decline' }).click();
  await expect(A.page.getByTestId('call-end-reason')).toHaveText('Declined');
  await expect(incoming(B.page)).toContainText('Cleo Second');
  await expect(C.page.getByTestId('call-status')).toHaveText('Ringing…');
  await B.page.getByRole('button', { name: 'Accept' }).click();
  await expect(callScreen(C.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  await expect(callScreen(B.page)).toHaveAttribute('data-phase', 'connected', { timeout: 20_000 });
  await C.page.getByRole('button', { name: 'End call' }).click();
  await expect(B.page.getByTestId('call-end-reason')).toContainText('Call ended');
  await Promise.all([A.context.close(), B.context.close(), C.context.close()]);
});
