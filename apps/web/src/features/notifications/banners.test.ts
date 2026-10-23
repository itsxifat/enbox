/**
 * In-app banners: which new messages get one (the desktop notification rules, @silent, a
 * thread I follow, a muted channel muting its threads; the switch, the app visible, not the
 * chat on screen, the system notification taking over in the background), what the card says,
 * and the stack (one per chat, newest first, at most three).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_FLAGS, MUTE_FOREVER_ISO, type ChatSummary, type ThreadInfo } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import type * as NotifyModule from '@/lib/notify';
import { isAppFocused, notificationPermission } from '@/lib/notify';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useIgnores } from '@/stores/ignores';
import { useSidePanel } from '@/stores/sidePanel';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import {
  bannerFor,
  offerMessageBanner,
  useBanners,
  wouldNotify,
  type MessageBanner,
} from './banners';

vi.mock('@/lib/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof NotifyModule>()),
  isAppFocused: vi.fn(() => true),
  notificationPermission: vi.fn(() => 'granted'),
}));

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const ME = '00000000-0000-4000-8000-0000000000e1';
const spaceInfo = (spaceId = 's1'): NonNullable<ChatSummary['space']> => ({
  spaceId,
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
});
const threadInfo = (p: Partial<ThreadInfo> = {}): ThreadInfo => ({
  parentId: 'general',
  starterMessageId: null,
  ownerId: null,
  archived: false,
  locked: false,
  autoArchiveMinutes: 1440,
  messageCount: 1,
  ...p,
});

const dm = makeChat({
  id: 'd1',
  type: 'direct',
  name: null,
  peer: makeUser({ id: ALICE, displayName: 'Alice' }),
});
const group = makeChat({ id: 'g1', type: 'group', name: 'Hikers' });
const general = makeChat({
  id: 'general',
  type: 'space_text',
  name: 'general',
  space: spaceInfo(),
});
const thread = makeChat({
  id: 't1',
  type: 'space_thread',
  name: 'Plans',
  space: spaceInfo(),
  thread: threadInfo(),
});
const from = (chatId: string, p: Parameters<typeof makeMessage>[0] = {}) =>
  makeMessage({ id: `m-${chatId}`, chatId, seq: 5, senderId: ALICE, text: 'hey there', ...p });

describe('in-app banners', () => {
  let me = makeMe({ id: ME, displayName: 'Me' });

  beforeEach(() => {
    me = makeMe({ id: ME, displayName: 'Me' });
    useAuth.setState({ user: me, token: 't', status: 'authenticated' });
    useChats.setState({ byId: { d1: dm, g1: group, general, t1: thread }, openChatId: null });
    useSpaces.setState({
      byId: { s1: makeSpace({ id: 's1', name: 'Gaming' }) },
      order: ['s1'],
      members: { s1: {} },
    });
    useUsers
      .getState()
      .upsertUsers([makeUser({ id: ALICE, displayName: 'Alice', avatarUrl: '/media/a.png' })]);
    useUi.getState().setPref('inAppBanners', true);
    useUi.getState().setPref('desktopNotifications', true);
    vi.mocked(isAppFocused).mockReturnValue(true);
    vi.mocked(notificationPermission).mockReturnValue('granted');
  });
  afterEach(() => {
    resetSessionState();
    useChats.setState({ byId: {}, openChatId: null });
    useSpaces.setState({ byId: {}, order: [], members: {} });
    useSidePanel.setState({ panel: null });
    useIgnores.setState({ byId: {} });
  });

  describe('wouldNotify', () => {
    it('DMs and groups, unless mine, system, @silent, muted, ignored, switched off or in do not disturb', () => {
      expect(wouldNotify(from('d1'), dm, me)).toBe(true);
      expect(wouldNotify(from('g1'), group, me)).toBe(true);
      expect(wouldNotify(from('d1', { senderId: ME }), dm, me)).toBe(false);
      expect(wouldNotify(from('g1', { type: 'system' }), group, me)).toBe(false);
      expect(wouldNotify(from('g1', { flags: MESSAGE_FLAGS.SILENT }), group, me)).toBe(false);
      expect(wouldNotify(from('g1'), { ...group, mutedUntil: MUTE_FOREVER_ISO }, me)).toBe(false);
      useIgnores.setState({ byId: { [ALICE]: true } });
      expect(wouldNotify(from('d1'), dm, me)).toBe(false);
      useIgnores.setState({ byId: {} });
      const quiet = { ...me, settings: { ...me.settings, groupNotifications: false } };
      expect(wouldNotify(from('g1'), group, quiet)).toBe(false);
      expect(wouldNotify(from('d1'), dm, quiet)).toBe(true);
      expect(
        wouldNotify(from('d1'), dm, { ...me, availability: 'dnd', availabilityUntil: null }),
      ).toBe(false);
    });

    it('Spaces by the notification level; a thread I follow: all of it; a muted channel mutes its threads', () => {
      // The Space's default is mentions only.
      expect(wouldNotify(from('general'), general, me)).toBe(false);
      expect(wouldNotify(from('general', { mentions: [ME] }), general, me)).toBe(true);
      expect(wouldNotify(from('general'), { ...general, notifyLevel: 'all' }, me)).toBe(true);
      expect(wouldNotify(from('t1'), thread, me)).toBe(false);
      const followed = { ...thread, thread: threadInfo({ following: true }) };
      expect(wouldNotify(from('t1'), followed, me)).toBe(true);
      expect(wouldNotify(from('t1'), { ...followed, notifyLevel: 'none' }, me)).toBe(false);
      useChats.getState().patchChat('general', { mutedUntil: MUTE_FOREVER_ISO });
      expect(wouldNotify(from('t1'), followed, me)).toBe(false);
      useChats.getState().patchChat('general', { mutedUntil: null });
      useSpaces.setState({
        byId: { s1: makeSpace({ id: 's1', me: { mutedUntil: MUTE_FOREVER_ISO } }) },
      });
      expect(wouldNotify(from('t1'), followed, me)).toBe(false);
    });
  });

  describe('bannerFor', () => {
    it('needs the switch, the app visible and another chat; in the background the system notification wins', () => {
      expect(bannerFor(from('g1'))).not.toBeNull();
      useUi.getState().setPref('inAppBanners', false);
      expect(bannerFor(from('g1'))).toBeNull();
      useUi.getState().setPref('inAppBanners', true);

      useChats.getState().setOpenChat('g1');
      expect(bannerFor(from('g1'))).toBeNull();
      useChats.getState().setOpenChat('general');
      useSidePanel.getState().open({ kind: 'thread', threadId: 't1', parentId: 'general' });
      expect(bannerFor(from('t1', { mentions: [ME] }))).toBeNull();
      expect(bannerFor(from('d1'))).not.toBeNull();

      vi.mocked(isAppFocused).mockReturnValue(false);
      expect(bannerFor(from('d1'))).toBeNull();
      vi.mocked(notificationPermission).mockReturnValue('default');
      expect(bannerFor(from('d1'))).not.toBeNull();
      const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      expect(bannerFor(from('d1'))).toBeNull();
      hidden.mockRestore();
    });

    it('says who, where and the first line; "New message" without previews', () => {
      expect(bannerFor(from('d1', { text: 'first line\nsecond' }))).toMatchObject({
        chatId: 'd1',
        name: 'Alice',
        where: null,
        text: 'first line',
        avatarUrl: '/media/a.png',
      } satisfies Partial<MessageBanner>);
      expect(bannerFor(from('g1'))).toMatchObject({ where: 'Hikers', text: 'hey there' });
      expect(bannerFor(from('general', { mentions: [ME], text: `hi @{${ME}}` }))).toMatchObject({
        where: '#general · Gaming',
        text: 'hi @Me',
      });
      useAuth.setState({
        user: { ...me, settings: { ...me.settings, notificationPreviews: false } },
      });
      expect(bannerFor(from('g1'))?.text).toBe('New message');
    });
  });

  it('stacks one banner per chat, newest first, three at most', () => {
    for (const id of ['d1', 'g1', 'd1']) offerMessageBanner(from(id, { id: `x-${Math.random()}` }));
    expect(useBanners.getState().banners.map((b) => b.chatId)).toEqual(['d1', 'g1']);
    useChats.getState().upsertChat(makeChat({ id: 'g2', type: 'group', name: 'Two' }));
    useChats.getState().upsertChat(makeChat({ id: 'g3', type: 'group', name: 'Three' }));
    offerMessageBanner(from('g2'));
    offerMessageBanner(from('g3'));
    expect(useBanners.getState().banners.map((b) => b.chatId)).toEqual(['g3', 'g2', 'd1']);
  });
});
