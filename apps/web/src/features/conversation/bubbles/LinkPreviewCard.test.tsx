/**
 * Link embeds under a message: which links embed (`embedLinks`), page cards, inline images
 * (and the animation preference), click-to-load players, video file cards, nothing for
 * suppressed messages or with the preference off, and the author's / moderator's X
 * ("Remove all embeds?" → PATCH suppress-embeds; Shift skips the question).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  MESSAGE_FLAGS,
  PERM,
  type ChatSummary,
  type LinkPreview,
  type Message,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { embedLinks, resetLinkPreviewCache } from '../lib/linkPreview';
import { LinkPreviewCard } from './LinkPreviewCard';

const page = (url: string, p: Partial<LinkPreview> = {}): LinkPreview => ({
  url,
  domain: 'example.com',
  siteName: 'Example',
  title: 'An article',
  description: 'What it is about',
  themeColor: null,
  image: null,
  ...p,
});

/** `GET /api/link-preview` answering from `previews` (else no preview). */
function mockPreviews(previews: Record<string, LinkPreview | null>) {
  return vi.spyOn(api, 'get').mockImplementation(async (path, opts) => {
    if (path !== '/api/link-preview') throw new Error(`unexpected GET ${path}`);
    const url = String(opts?.query?.url);
    return { preview: previews[url] ?? null } as never;
  });
}

const group = makeChat({ id: 'g1', type: 'group' });

/** The embeds as a row renders them: of the live message in the store. */
function Row({ chat = group }: { chat?: ChatSummary }) {
  const live = useMessages((s) => s.byChat[chat.id]?.items[0]);
  return live ? <LinkPreviewCard text={live.text} message={live} chat={chat} /> : null;
}

function seed(chat: ChatSummary, items: Message[]) {
  useMessages.setState({
    byChat: {
      [chat.id]: {
        items,
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
}

beforeEach(() => {
  resetLinkPreviewCache();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
});

afterEach(() => {
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

describe('embedLinks', () => {
  it('up to three links in order, once each; not in code, spoilers or <angle brackets>', () => {
    expect(
      embedLinks('a https://a.com b https://b.com c https://a.com d https://c.com e https://d.com'),
    ).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    expect(embedLinks('see <https://quiet.com> and [docs](<https://masked.com>)')).toEqual([]);
    expect(embedLinks('[docs](https://masked.com) and www.site.org')).toEqual([
      'https://masked.com',
      'https://www.site.org',
    ]);
    expect(
      embedLinks('`https://code.com` ```\nhttps://block.com\n``` ||https://secret.com||'),
    ).toEqual([]);
    expect(embedLinks('mail me at a@b.co')).toEqual([]);
    expect(embedLinks(null)).toEqual([]);
  });
});

describe('LinkPreviewCard', () => {
  it('a page link shows its card; nothing with the preference off', async () => {
    const get = mockPreviews({ 'https://example.com/a': page('https://example.com/a') });
    const { unmount } = render(<LinkPreviewCard text="read https://example.com/a" />);
    const card = await screen.findByTestId('link-embed');
    expect(card).toHaveAttribute('href', 'https://example.com/a');
    expect(card).toHaveAttribute('target', '_blank');
    expect(within(card).getByText('An article')).toBeInTheDocument();
    expect(within(card).getByText('Example')).toBeInTheDocument();
    unmount();

    get.mockClear();
    useUi.getState().setPref('linkPreviews', false);
    const { container } = render(<LinkPreviewCard text="read https://example.com/a" />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('a message with SUPPRESS_EMBEDS shows no preview, player or card', () => {
    const get = mockPreviews({});
    const m = makeMessage({
      id: 'm1',
      chatId: 'g1',
      senderId: 'me',
      text: 'https://example.com/a https://youtu.be/dQw4w9WgXcQ https://cdn.example.com/v.mp4',
      flags: MESSAGE_FLAGS.SUPPRESS_EMBEDS,
    });
    const { container } = render(<LinkPreviewCard text={m.text} message={m} chat={group} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('a direct image link shows the image inline; GIFs keep a still unless animation may play', async () => {
    const still = page('https://cdn.example.com/cat.gif', {
      title: null,
      description: null,
      siteName: null,
      image: { url: '/uploads/2026/10/x.gif', width: 800, height: 400 },
    });
    mockPreviews({ 'https://cdn.example.com/cat.gif': still });
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    const { unmount } = render(<LinkPreviewCard text="https://cdn.example.com/cat.gif" />);
    const embed = await screen.findByTestId('image-embed');
    expect(embed).toHaveAttribute('href', 'https://cdn.example.com/cat.gif');
    expect(embed).toHaveAttribute('data-animated', 'still');
    expect(embed.querySelector('canvas')).not.toBeNull();
    expect(embed.querySelector('img')).toBeNull();
    expect(within(embed).getByText('GIF')).toBeInTheDocument();
    expect(screen.queryByTestId('link-embed')).toBeNull();
    unmount();

    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    useUi.getState().setPref('autoplayAnimatedMedia', 'always');
    render(<LinkPreviewCard text="https://cdn.example.com/cat.gif" />);
    const playing = await screen.findByTestId('image-embed');
    expect(playing).toHaveAttribute('data-animated', 'playing');
    const img = playing.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/\/uploads\/2026\/10\/x\.gif$/);
    // Fitted into 400 × 300.
    expect(img).toHaveAttribute('width', '400');
    expect(img).toHaveAttribute('height', '200');
  });

  it('players load only on click', async () => {
    mockPreviews({
      'https://youtu.be/dQw4w9WgXcQ': page('https://youtu.be/dQw4w9WgXcQ', {
        siteName: 'YouTube',
        title: 'The video',
        image: { url: '/uploads/2026/10/thumb.jpg', width: 1280, height: 720 },
      }),
    });
    render(<LinkPreviewCard text="watch https://youtu.be/dQw4w9WgXcQ" />);
    const card = await screen.findByTestId('player-embed');
    expect(card).toHaveAttribute('data-provider', 'youtube');
    expect(card.querySelector('iframe')).toBeNull();
    expect(card.querySelector('img')?.getAttribute('src')).toMatch(/thumb\.jpg$/);
    fireEvent.click(within(card).getByRole('button', { name: 'Play The video' }));
    const frame = card.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
    );
    expect(frame.getAttribute('allow')).toContain('autoplay; encrypted-media; picture-in-picture');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame).toHaveAttribute('title', 'YouTube player: The video');
  });

  it('a player without a preview still plays; music players are compact', async () => {
    mockPreviews({});
    const track = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    render(<LinkPreviewCard text={track} />);
    const card = await screen.findByTestId('player-embed');
    expect(card).toHaveAttribute('data-provider', 'spotify');
    fireEvent.click(within(card).getByRole('button', { name: 'Play Spotify player' }));
    const frame = card.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(
      'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT',
    );
    expect((frame.parentElement as HTMLElement).style.height).toBe('152px');
  });

  it('a video file gets an "Open video" card and is never fetched', () => {
    const get = mockPreviews({});
    render(<LinkPreviewCard text="https://cdn.example.com/clips/launch.mp4" />);
    const card = screen.getByTestId('video-link-embed');
    expect(within(card).getByText('launch.mp4')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /Open video/ })).toHaveAttribute(
      'href',
      'https://cdn.example.com/clips/launch.mp4',
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("the author's X asks, then removes all embeds for everyone", async () => {
    const m = makeMessage({
      id: 'm1',
      chatId: 'g1',
      seq: 3,
      senderId: 'me',
      text: 'https://example.com/a',
    });
    seed(group, [m]);
    mockPreviews({ 'https://example.com/a': page('https://example.com/a') });
    const patch = vi
      .spyOn(api, 'patch')
      .mockResolvedValue({ ...m, flags: MESSAGE_FLAGS.SUPPRESS_EMBEDS } as never);
    render(<Row />);
    await screen.findByTestId('link-embed');
    fireEvent.click(screen.getByRole('button', { name: 'Remove all embeds' }));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Remove all embeds?');
    expect(patch).not.toHaveBeenCalled();
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/messages/m1/suppress-embeds', { suppress: true }),
    );
    await waitFor(() => expect(screen.queryByTestId('link-embed')).toBeNull());
  });

  it('Shift skips the question; a refusal brings the embeds back', async () => {
    const m = makeMessage({
      id: 'm2',
      chatId: 'g1',
      seq: 4,
      senderId: 'me',
      text: 'https://example.com/a',
    });
    seed(group, [m]);
    mockPreviews({ 'https://example.com/a': page('https://example.com/a') });
    const patch = vi.spyOn(api, 'patch').mockRejectedValue(new Error('nope'));
    render(<Row />);
    await screen.findByTestId('link-embed');
    fireEvent.click(screen.getByRole('button', { name: 'Remove all embeds' }), { shiftKey: true });
    expect(useUi.getState().dialogs).toHaveLength(0);
    expect(patch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useUi.getState().toasts.at(-1)?.message).toBe('nope'));
    expect(await screen.findByTestId('link-embed')).toBeInTheDocument();
  });

  it('others get no X — except with MANAGE_MESSAGES in a Space channel', async () => {
    mockPreviews({ 'https://example.com/a': page('https://example.com/a') });
    const theirs = makeMessage({
      id: 'm3',
      chatId: 'g1',
      seq: 5,
      senderId: 'olive',
      text: 'https://example.com/a',
    });
    const { unmount } = render(
      <LinkPreviewCard text={theirs.text} message={theirs} chat={group} />,
    );
    await screen.findByTestId('link-embed');
    expect(screen.queryByRole('button', { name: 'Remove all embeds' })).toBeNull();
    unmount();

    const channel = makeChat({
      id: 'c1',
      type: 'space_text',
      name: 'general',
      space: { spaceId: 's1', categoryId: null, position: 0, overwrites: [] } as never,
      spacePermissions: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.MANAGE_MESSAGES,
    });
    const inChannel = { ...theirs, chatId: 'c1' };
    render(<LinkPreviewCard text={inChannel.text} message={inChannel} chat={channel} />);
    await screen.findByTestId('link-embed');
    expect(screen.getByRole('button', { name: 'Remove all embeds' })).toBeInTheDocument();
  });
});
