/** The channel sidebar's NEW UNREADS / NEW MENTIONS pills, and its resizable frame on desktop. */
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PERM, type ChatSummary } from '@enbox/shared';
import { useSidebarWidth } from '@/features/frame/sidebarWidth';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeMe } from '@/test/factories';
import { ChannelSidebar } from './ChannelSidebar';
import { makeSpace } from './testUtils';

const media = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));

function channel(id: string, position: number, p: Partial<ChatSummary> = {}): ChatSummary {
  const c = makeChat({ id, name: id, type: 'space_text', spacePermissions: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES, lastSeq: 1, lastReadSeq: 1, ...p });
  return {
    ...c,
    space: {
      spaceId: 's1',
      categoryId: null,
      position,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

/** Where each row sits (its top, px); the list shows 100–300. */
const TOPS: Record<string, number> = { early: 0, mentioned: 40, open: 150, late: 400, later: 450 };

function seed(path = '/spaces/s1/open') {
  useSpaces.setState({ byId: { s1: makeSpace({ id: 's1', name: 'Lab' }) }, order: ['s1'], loaded: true, channelsLoaded: { s1: true } });
  useChats.setState({
    byId: Object.fromEntries(
      [
        channel('early', 0, { lastSeq: 5 }),
        channel('mentioned', 1, { lastSeq: 5, unreadMentionCount: 1 }),
        channel('open', 2, { lastSeq: 5 }),
        channel('late', 3, { lastSeq: 5 }),
        channel('later', 4),
      ].map((c) => [c.id, c]),
    ),
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/spaces/:spaceId/:chatId" element={<ChannelSidebar spaceId="s1" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 240, width: 240 }) as DOMRect;

describe('ChannelSidebar jump pills', () => {
  const scrolled = vi.fn();
  beforeEach(() => {
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('aria-label') === 'Lab channels') return rect(100, 300);
      const name = this.querySelector('[data-channel-name]')?.getAttribute('data-channel-name');
      const top = name ? (TOPS[name] ?? 200) : 200;
      return rect(top, top + 36);
    });
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    scrolled.mockReset();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    media.desktop = false;
    useSidebarWidth.setState({ width: null });
    useChats.setState({ byId: {} });
    useSpaces.setState({ byId: {}, order: [], channelsLoaded: {} });
  });

  it('NEW MENTIONS above and NEW UNREADS below jump to the nearest such channel; the open one never counts', () => {
    seed();
    expect(screen.getByRole('button', { name: 'New mentions above' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New unreads below' }));
    const target = scrolled.mock.contexts[0] as HTMLElement;
    expect(target.querySelector('[data-channel-name]')).toHaveAttribute('data-channel-name', 'late');
    fireEvent.click(screen.getByRole('button', { name: 'New mentions above' }));
    expect((scrolled.mock.contexts[1] as HTMLElement).querySelector('[data-channel-name]')).toHaveAttribute(
      'data-channel-name',
      'mentioned',
    );
    expect(document.querySelectorAll('[data-jump]')).toHaveLength(3);
  });

  it('on desktop the sidebar sits in the resizable frame, at the shared width', () => {
    media.desktop = true;
    useSidebarWidth.setState({ width: 320 });
    seed();
    const frame = screen.getByTestId('sidebar-frame');
    expect(frame).toHaveStyle({ width: '320px' });
    expect(frame).toContainElement(screen.getByRole('complementary', { name: 'Channels' }));
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '320');
  });

  it('phones keep the plain sidebar', () => {
    seed();
    expect(screen.queryByTestId('sidebar-frame')).toBeNull();
  });
});
