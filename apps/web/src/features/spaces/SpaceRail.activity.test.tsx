/** Rail activity: voice, LIVE and live-event glyphs, the off-screen mentions pill, the floating tooltip, Home's last DM. */
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { RailEntry, SpaceEvent, VoiceState } from '@enbox/shared';
import { useLastHome } from '@/features/frame/lastLocation';
import { useAuth } from '@/stores/auth';
import { useEvents } from '@/stores/events';
import { useRail } from '@/stores/rail';
import { useSpaces } from '@/stores/spaces';
import { useVoice } from '@/stores/voice';
import { makeMe } from '@/test/factories';
import { SpaceRail } from './SpaceRail';
import { makeSpace } from './testUtils';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));

/** jsdom has no PointerEvent: a MouseEvent with a pointer type. */
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const layout: RailEntry[] = ['a', 'b', 'c'].map((id) => ({ kind: 'space', id }));

const voice = (userId: string, spaceId: string, selfStream = false): VoiceState => ({
  userId,
  spaceId,
  channelId: `${spaceId}-voice`,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
});

function renderRail(path = '/spaces') {
  const spaces = [
    makeSpace({ id: 'a', name: 'Space A' }),
    makeSpace({ id: 'b', name: 'Space B' }),
    makeSpace({ id: 'c', name: 'Space C', unreadMentionCount: 2 }),
  ];
  useSpaces.setState({ byId: Object.fromEntries(spaces.map((s) => [s.id, s])), order: spaces.map((s) => s.id), loaded: true });
  useAuth.setState({ user: makeMe({ id: 'me', railLayout: layout }), token: 't', status: 'authenticated' });
  useRail.setState({ layout, open: {} });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SpaceRail />
    </MemoryRouter>,
  );
}

const tile = (name: RegExp) => screen.getAllByTestId('space-tile').find((t) => name.test(t.getAttribute('aria-label') ?? ''))!;
const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 12, right: 60, width: 48 }) as DOMRect;

describe('SpaceRail activity', () => {
  const scrolled = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    scrolled.mockReset();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    media.desktop = true;
    useSpaces.setState({ byId: {}, order: [] });
    useVoice.setState({ byUser: {}, connection: null });
    useEvents.setState({ bySpace: {} });
    useLastHome.setState({ userId: null, path: null });
  });

  it('a speaker where I talk, LIVE where someone streams, a calendar while an event is on (mentions win the corner)', () => {
    useVoice.setState({
      connection: { spaceId: 'a', channelId: 'a-voice', status: 'connected' },
      byUser: { me: voice('me', 'a'), u2: voice('u2', 'b', true) },
    });
    useEvents.setState({ bySpace: { b: [{ id: 'e1', spaceId: 'b', status: 'active' } as SpaceEvent], c: [{ id: 'e2', spaceId: 'c', status: 'active' } as SpaceEvent] } });
    renderRail();

    const a = tile(/^Space A/);
    expect(a).toHaveAttribute('aria-label', 'Space A, in voice');
    expect(within(a).getByTestId('rail-voice')).toBeInTheDocument();

    const b = tile(/^Space B/);
    expect(b).toHaveAttribute('aria-label', 'Space B, live, event happening now');
    expect(within(b).getByText('LIVE')).toBeInTheDocument();
    expect(within(b).getByTestId('rail-event')).toBeInTheDocument();

    const c = tile(/^Space C/);
    expect(c).toHaveAttribute('aria-label', 'Space C, 2 mentions, event happening now');
    expect(within(c).queryByTestId('rail-event')).toBeNull();
    expect(within(c).getByText('2')).toBeInTheDocument();
  });

  it('a red pill points to Spaces with new mentions scrolled out of view, and scrolls to them', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'rail-scroller') return rect(0, 200);
      return this.dataset.railKey === 'c' ? rect(500, 548) : rect(10, 58);
    });
    renderRail();
    expect(screen.queryByTestId('jump-pill-top')).toBeNull();
    const pill = screen.getByRole('button', { name: 'New mentions below' });
    expect(pill).toHaveTextContent('Newmentions');
    fireEvent.click(pill);
    expect(scrolled.mock.contexts[0]).toBe(tile(/^Space C/));
  });

  it('tooltips float beside the hovered tile, outside the scrolling rail', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(100, 148));
    renderRail();
    fireEvent.pointerOver(tile(/^Space B/), { pointerType: 'mouse' });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Space B');
    expect(tip).toHaveStyle({ left: '72px', top: '124px' });
    expect(screen.getByRole('navigation', { name: 'Spaces' })).not.toContainElement(tip);

    fireEvent.pointerOver(screen.getByTestId('create-space'), { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Create a Space');
    fireEvent.pointerLeave(screen.getByRole('navigation', { name: 'Spaces' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Touch shows none.
    fireEvent.pointerOver(tile(/^Space B/), { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Home goes back to the DM I had open; on Home, to Friends; on phones, to the list', () => {
    useLastHome.setState({ userId: 'me', path: '/chats/d1' });
    const first = renderRail('/spaces/a');
    expect(screen.getByTestId('rail-home')).toHaveAttribute('href', '/chats/d1');
    first.unmount();
    const second = renderRail('/chats/d1');
    expect(screen.getByTestId('rail-home')).toHaveAttribute('href', '/chats');
    second.unmount();
    media.desktop = false;
    renderRail('/spaces/a');
    expect(screen.getByTestId('rail-home')).toHaveAttribute('href', '/chats');
  });
});
