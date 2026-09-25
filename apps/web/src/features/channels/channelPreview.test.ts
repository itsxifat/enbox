import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelPreview } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useUsers } from '@/stores/users';
import { makeMessage, makeUser } from '@/test/factories';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));

const { previewChannel } = await import('./channelApi');

describe('previewChannel', () => {
  afterEach(() => {
    get.mockReset();
    resetSessionState();
  });

  it('puts the side-loaded users in the users store', async () => {
    const actor = makeUser({ displayName: 'Channel Founder' });
    const preview: ChannelPreview = {
      channel: {
        id: 'ch-1',
        name: 'News',
        description: null,
        avatarUrl: null,
        followerCount: 3,
        isFollowing: false,
        isPublic: true,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      messages: [makeMessage({ chatId: 'ch-1', senderId: null, type: 'system' })],
      users: [actor],
    };
    get.mockResolvedValue(preview);
    await expect(previewChannel('ch-1')).resolves.toBe(preview);
    expect(get).toHaveBeenCalledWith('/api/channels/ch-1', { signal: undefined });
    expect(useUsers.getState().byId[actor.id]?.displayName).toBe('Channel Founder');
  });
});
