/**
 * Discord's highlight of a message that mentions me (a tint and a left bar): my name or a
 * reply's ping, my roles and @everyone in a Space unless I suppress them; never my own or
 * unrelated messages. Cozy and bubble rows alike.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChatSummary, Message } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext } from '../bubbles/appearance';
import { CozyMessageRow } from '../CozyMessageRow';
import type { Row } from '../lib/rows';
import { MessageRow } from '../MessageRow';

const space: NonNullable<ChatSummary['space']> = {
  spaceId: 's1',
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
};
const channel = makeChat({ id: 'general', type: 'space_text', name: 'general', space });
const group = makeChat({ id: 'g1', type: 'group', name: 'Book club' });

function renderRow(chat: ChatSummary, p: Partial<Message>, Component = CozyMessageRow) {
  const m = makeMessage({ id: 'm1', chatId: chat.id, senderId: 'ann', text: 'hey', ...p });
  const row: Row = {
    key: m.id,
    message: m,
    mine: m.senderId === 'me',
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
  };
  return render(
    <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
      <Component row={row} chat={chat} onJump={() => undefined} onJumpById={() => undefined} />
    </RowAppearanceContext.Provider>,
  );
}

const highlighted = () => {
  const row = screen.getByTestId('message');
  return row.hasAttribute('data-mentioned') && !!row.querySelector('.bg-mention-bg');
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
});

describe('mention highlight', () => {
  it('a mention of me (a reply ping too) is highlighted; others are not', () => {
    const { unmount } = renderRow(group, { mentions: ['me'] });
    expect(highlighted()).toBe(true);
    unmount();
    renderRow(group, { mentions: ['zed'] });
    expect(highlighted()).toBe(false);
  });

  it('in a Space: my roles and @everyone, unless I suppress them', () => {
    useSpaces.setState({ byId: { s1: makeSpace({ me: { roleIds: ['mods'] } }) } });
    const first = renderRow(channel, { mentionRoleIds: ['mods'] });
    expect(highlighted()).toBe(true);
    first.unmount();
    const second = renderRow(channel, { mentionEveryone: true });
    expect(highlighted()).toBe(true);
    second.unmount();
    useSpaces.setState({
      byId: { s1: makeSpace({ me: { roleIds: ['mods'], suppressEveryone: true, suppressRoles: true } }) },
    });
    const third = renderRow(channel, { mentionEveryone: true });
    expect(highlighted()).toBe(false);
    third.unmount();
    renderRow(channel, { mentionRoleIds: ['mods'] });
    expect(highlighted()).toBe(false);
  });

  it('never my own message', () => {
    renderRow(group, { senderId: 'me', mentions: ['me'] });
    expect(highlighted()).toBe(false);
  });

  it('bubble rows too', () => {
    renderRow(group, { mentions: ['me'] }, MessageRow);
    expect(highlighted()).toBe(true);
  });
});
