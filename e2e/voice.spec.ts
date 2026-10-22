/**
 * Voice channels against a real LiveKit server (skipped unless the API server has voice
 * configured — see playwright.config.ts): join from the channel view, the other member sees
 * the occupant in the sidebar and in the call, leave clears it.
 */
import { expect, test } from '@playwright/test';
import { apiAs, openAs, registerUser, uniqueName } from './helpers';

test('two members talk in a voice channel', async ({ browser, request }) => {
  const cfg = (await (await request.get('/api/config')).json()) as { voice: unknown };
  test.skip(!cfg.voice, 'voice channels are not configured on the test server');

  const [alice, bob] = await Promise.all([registerUser(), registerUser()]);
  const detail = await apiAs<{ space: { id: string }; channels: { id: string; type: string; name: string }[] }>(
    alice,
    'POST',
    '/api/spaces',
    { name: `Voice ${uniqueName('s')}` },
  );
  const spaceId = detail.space.id;
  const voice = detail.channels.find((c) => c.type === 'space_voice')!;
  const invite = await apiAs<{ code: string }>(alice, 'POST', `/api/spaces/${spaceId}/invites`, {});
  await apiAs(bob, 'POST', `/api/invites/${invite.code}/join`);

  const a = await openAs(browser, alice, `/spaces/${spaceId}/${voice.id}`);
  await a.page.getByTestId('join-voice').click();
  await expect(a.page.getByTestId('voice-panel').getByRole('status')).toHaveText('Voice Connected', { timeout: 20_000 });
  await expect(a.page.getByTestId('voice-tile')).toHaveCount(1);

  const b = await openAs(browser, bob, `/spaces/${spaceId}/${voice.id}`);
  await expect(b.page.getByLabel('1 in voice')).toBeVisible();
  await expect(b.page.getByTestId('voice-occupant')).toHaveCount(1);
  await b.page.getByTestId('join-voice').click();
  await expect(b.page.getByTestId('voice-panel').getByRole('status')).toHaveText('Voice Connected', { timeout: 20_000 });
  await expect(b.page.getByTestId('voice-tile')).toHaveCount(2, { timeout: 15_000 });
  await expect(a.page.getByTestId('voice-tile')).toHaveCount(2, { timeout: 15_000 });
  await expect(a.page.getByTestId('voice-occupant')).toHaveCount(2);

  await a.page.getByTestId('voice-disconnect').click();
  await expect(a.page.getByTestId('voice-panel')).toHaveCount(0);
  await expect(b.page.getByTestId('voice-occupant')).toHaveCount(1);
  await expect(b.page.getByTestId('voice-tile')).toHaveCount(1, { timeout: 15_000 });

  await a.context.close();
  await b.context.close();
});
