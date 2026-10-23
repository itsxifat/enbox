/**
 * The sticker picker: my groups load on open, a section per Space with a rail (the chat's own
 * Space first, others only with USE_EXTERNAL_EMOJI), search by name / related emoji /
 * description, a click or Enter sends, animated stickers play on hover. The composer's button
 * opens it lazily and closes it on a pick; a lone emoji typed offers sticker suggestions; a
 * sticker goes out through the normal send path with its picture as the optimistic bubble.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  ALL_PERMISSIONS,
  PERM,
  type ChatSummary,
  type Message,
  type SpaceChannelInfo,
  type SpaceSticker,
  type SpaceStickerGroup,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { makeSpace } from '@/features/spaces/testUtils';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { useStickers } from '@/stores/stickers';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { sendSticker } from './send';
import { StickerButton } from './StickerButton';
import { StickerPicker } from './StickerPicker';

const sticker = (
  id: string,
  spaceId: string,
  name: string,
  p: Partial<SpaceSticker> = {},
): SpaceSticker => ({
  id,
  spaceId,
  name,
  description: null,
  emoji: null,
  url: `/uploads/2026/10/${id}.png`,
  animated: false,
  createdBy: 'u1',
  ...p,
});

const WAVE = sticker('st1', 's1', 'Wave', { emoji: '👋', description: 'Hello there' });
const PARTY = sticker('st2', 's1', 'Party', {
  emoji: '🎉',
  animated: true,
  url: '/uploads/2026/10/st2.gif',
});
const BEE = sticker('st3', 's2', 'Bee', { emoji: '🐝', description: 'buzz buzz' });
const HI = sticker('st4', 's2', 'Hi', { emoji: '👋️' });
const GROUPS: SpaceStickerGroup[] = [
  { spaceId: 's1', spaceName: 'Alpha', iconUrl: null, stickers: [WAVE, PARTY] },
  { spaceId: 's2', spaceName: 'Beta', iconUrl: '/uploads/beta.png', stickers: [BEE, HI] },
];

const dm = makeChat({ id: 'dm-1', type: 'direct' });
const channelIn = (spaceId: string, bits = ALL_PERMISSIONS): ChatSummary =>
  makeChat({
    id: `ch-${spaceId}`,
    type: 'space_text',
    space: { spaceId } as SpaceChannelInfo,
    spacePermissions: bits,
  });

/** A touch device (`(pointer: coarse)`); media query lists are cached, hence the getter. */
let coarse = false;

beforeEach(() => {
  vi.restoreAllMocks();
  coarse = false;
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return query === '(pointer: coarse)' && coarse;
        },
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useUi.setState({ prefs: DEFAULT_PREFS, toasts: [] });
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useStickers.setState({ groups: null, bySpace: {}, stale: false });
  useSpaces.setState({
    byId: {
      s1: makeSpace({ id: 's1', name: 'Alpha' }),
      s2: makeSpace({ id: 's2', name: 'Beta' }),
    },
    order: ['s1', 's2'],
  });
});

const sectionNames = () => screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));

describe('StickerPicker', () => {
  it('loads my groups on open: a section per Space with a rail, the channel’s own Space first', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(GROUPS);
    render(<StickerPicker chat={channelIn('s2')} onPick={() => undefined} />);
    await screen.findByRole('region', { name: 'Beta' });
    expect(get).toHaveBeenCalledWith('/api/me/stickers');
    expect(sectionNames()).toEqual(['Beta', 'Alpha']);
    const rail = screen.getByRole('navigation', { name: 'Spaces' });
    expect(
      within(rail)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Beta', 'Alpha']);
    expect(
      within(screen.getByRole('region', { name: 'Alpha' }))
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Wave', 'Party']);
    // The search box has focus for typing at once.
    expect(screen.getByRole('searchbox', { name: 'Search stickers' })).toHaveFocus();
  });

  it('other Spaces’ stickers are left out where USE_EXTERNAL_EMOJI is denied; DMs get them all', async () => {
    useStickers.setState({ groups: GROUPS });
    const { unmount } = render(
      <StickerPicker
        chat={channelIn('s2', ALL_PERMISSIONS & ~PERM.USE_EXTERNAL_EMOJI)}
        onPick={() => undefined}
      />,
    );
    expect(sectionNames()).toEqual(['Beta']);
    unmount();
    render(<StickerPicker chat={dm} onPick={() => undefined} />);
    expect(sectionNames()).toEqual(['Alpha', 'Beta']);
  });

  it('search matches the name, the related emoji and the description; Enter sends the first match', async () => {
    useStickers.setState({ groups: GROUPS });
    const pick = vi.fn();
    render(<StickerPicker chat={dm} onPick={pick} />);
    const box = screen.getByRole('searchbox', { name: 'Search stickers' });
    const names = () =>
      screen
        .queryAllByRole('button')
        .filter((b) => b.hasAttribute('data-sticker-cell'))
        .map((b) => b.getAttribute('aria-label'));
    fireEvent.change(box, { target: { value: 'BUZZ' } });
    expect(names()).toEqual(['Bee']);
    fireEvent.change(box, { target: { value: '🎉' } });
    expect(names()).toEqual(['Party']);
    // Emoji variation selectors don't matter.
    fireEvent.change(box, { target: { value: '👋' } });
    expect(names()).toEqual(['Wave', 'Hi']);
    fireEvent.change(box, { target: { value: 'nothing like it' } });
    expect(screen.getByRole('status')).toHaveTextContent('No stickers match “nothing like it”');
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(pick).toHaveBeenCalledWith(WAVE);
  });

  it('a click sends a sticker; arrows move between stickers; animated ones play on hover ("On hover")', async () => {
    useStickers.setState({ groups: GROUPS });
    useUi.getState().setPref('stickerAnimation', 'interaction');
    const pick = vi.fn();
    render(<StickerPicker chat={dm} onPick={pick} />);
    const party = screen.getByRole('button', { name: 'Party' });
    expect(party.querySelector('[data-animated]')).toHaveAttribute('data-animated', 'still');
    fireEvent.pointerEnter(party);
    expect(party.querySelector('[data-animated]')).toHaveAttribute('data-animated', 'playing');
    fireEvent.pointerLeave(party);
    expect(party.querySelector('[data-animated]')).toHaveAttribute('data-animated', 'still');

    const box = screen.getByRole('searchbox', { name: 'Search stickers' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Wave' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Wave' }), { key: 'ArrowRight' });
    expect(party).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Bee' }));
    expect(pick).toHaveBeenCalledWith(BEE);
  });

  it('says so when there are no stickers yet', async () => {
    useStickers.setState({ groups: [] });
    render(<StickerPicker chat={channelIn('s1')} onPick={() => undefined} />);
    expect(screen.getByText('No stickers yet')).toBeInTheDocument();
  });
});

describe('the composer’s sticker button', () => {
  it('opens the picker (lazy) and closes it on a pick, handing the sticker over', async () => {
    useStickers.setState({ groups: GROUPS });
    const pick = vi.fn();
    render(<StickerButton chat={dm} onPick={pick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stickers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wave' }));
    expect(pick).toHaveBeenCalledWith(WAVE, false);
    await waitFor(() => expect(screen.queryByTestId('sticker-picker')).toBeNull());
  });

  it('touch devices get a sheet whose search box stays unfocused (no keyboard popping up)', async () => {
    coarse = true;
    useStickers.setState({ groups: GROUPS });
    const pick = vi.fn();
    render(<StickerButton chat={dm} onPick={pick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stickers' }));
    const sheet = await screen.findByRole('dialog', { name: 'Stickers' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    const search = await within(sheet).findByRole('searchbox', { name: 'Search stickers' });
    await new Promise((r) => requestAnimationFrame(r));
    expect(search).not.toHaveFocus();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Bee' }));
    expect(pick).toHaveBeenCalledWith(BEE, false);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull());
  });

  it('a lone emoji typed offers the stickers related to it', async () => {
    useStickers.setState({ groups: GROUPS });
    const pick = vi.fn();
    const { rerender } = render(<StickerButton chat={dm} text="hello 👋" onPick={pick} />);
    expect(screen.queryByTestId('sticker-suggestions')).toBeNull();
    rerender(<StickerButton chat={dm} text=" 👋 " onPick={pick} />);
    const strip = screen.getByRole('group', { name: 'Sticker suggestions' });
    expect(
      within(strip)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Wave', 'Hi']);
    fireEvent.click(within(strip).getByRole('button', { name: 'Hi' }));
    expect(pick).toHaveBeenCalledWith(HI, true);
    // Nothing related: no strip.
    rerender(<StickerButton chat={dm} text="🦄" onPick={pick} />);
    expect(screen.queryByTestId('sticker-suggestions')).toBeNull();
  });
});

describe('sendSticker', () => {
  it('posts { type: sticker } and shows the picture at once as an optimistic image message', async () => {
    useMessages.setState({ byChat: {} });
    let resolve!: (m: Message) => void;
    const post = vi.spyOn(api, 'post').mockImplementation(
      () =>
        new Promise<Message>((r) => {
          resolve = r;
        }) as never,
    );
    const sent = sendSticker('dm-1', PARTY, { replyToId: 'm0', mentionRepliedAuthor: false });
    expect(post).toHaveBeenCalledWith('/api/chats/dm-1/messages', {
      type: 'sticker',
      stickerId: 'st2',
      replyToId: 'm0',
      mentionRepliedAuthor: false,
      clientId: expect.any(String),
    });
    const optimistic = useMessages.getState().byChat['dm-1']!.items.at(-1)!;
    expect(optimistic).toMatchObject({
      type: 'image',
      text: null,
      sticker: { id: 'st2', name: 'Party', spaceId: 's1' },
      media: { kind: 'image', url: PARTY.url, animated: true, mimeType: 'image/gif' },
    });
    const server = makeMessage({
      id: 'srv-1',
      chatId: 'dm-1',
      seq: 5,
      senderId: 'me',
      type: 'image',
      text: null,
      clientId: (post.mock.calls[0]![1] as { clientId: string }).clientId,
      sticker: { id: 'st2', name: 'Party', spaceId: 's1' },
    });
    await act(async () => {
      resolve(server);
      await sent;
    });
    expect(useMessages.getState().byChat['dm-1']!.items.map((m) => m.id)).toContain('srv-1');
  });
});
