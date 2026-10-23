/**
 * Announcement channels on the web: who gets Publish (menu item and the inline pill under my
 * own unpublished message, then the "Published" check), the Follow modal (Spaces and text
 * channels where I can manage webhooks, then Follow), Integrations ▸ Channels Followed, and
 * the channel dialog's Announcement type and switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  MESSAGE_FLAGS,
  PERM,
  type ChannelFollow,
  type ChatSummary,
  type Message,
  type SpaceChannelInfo,
} from '@enbox/shared';
import type { MenuItem } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { ChannelDialog } from '@/features/spaces/dialogs/ChannelDialog';
import { makeSpace } from '@/features/spaces/testUtils';
import { publishMessageItem, usePublished } from './actions';
import { FollowDialog } from './FollowDialog';
import { FollowedChannels } from './FollowedChannels';
import { PublishPill } from './PublishPill';

const info = (p: Partial<SpaceChannelInfo> = {}): SpaceChannelInfo => ({
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
  isNews: true,
  ...p,
});

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;
const channel = (p: Partial<ChatSummary> = {}) =>
  makeChat({
    id: 'news',
    type: 'space_text',
    name: 'news',
    space: info(),
    spacePermissions: MEMBER,
    ...p,
  });
const message = (p: Partial<Message> = {}) =>
  makeMessage({ id: 'm1', chatId: 'news', seq: 5, senderId: 'me', text: 'Launch at noon', ...p });

/** Confirm the open dialog (confirm()). */
async function confirmDialog() {
  await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
  act(() => useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, 'confirm'));
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  usePublished.setState({ ids: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('Publish', () => {
  it('the message menu offers Publish for my messages, or anyone’s with MANAGE_MESSAGES, once', () => {
    expect((publishMessageItem(channel(), message()) as MenuItem).label).toBe('Publish');
    // Not an announcement channel, someone else's, already published, a copy, unsent.
    expect(publishMessageItem(channel({ space: info({ isNews: false }) }), message())).toBeNull();
    expect(publishMessageItem(channel(), message({ senderId: 'bob' }))).toBeNull();
    expect(publishMessageItem(channel(), message({ flags: MESSAGE_FLAGS.CROSSPOSTED }))).toBeNull();
    expect(
      publishMessageItem(channel(), message({ flags: MESSAGE_FLAGS.IS_CROSSPOST })),
    ).toBeNull();
    expect(publishMessageItem(channel(), message({ seq: 0 }))).toBeNull();
    expect(publishMessageItem(channel(), message({ type: 'poll' }))).toBeNull();
    // Moderators publish anyone's; without SEND_MESSAGES my own can't be published.
    const mod = channel({ spacePermissions: MEMBER | PERM.MANAGE_MESSAGES });
    expect(publishMessageItem(mod, message({ senderId: 'bob' }))).not.toBeNull();
    expect(
      publishMessageItem(channel({ spacePermissions: PERM.VIEW_CHANNEL }), message()),
    ).toBeNull();
  });

  it('the menu item confirms, then publishes', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(message({ flags: MESSAGE_FLAGS.CROSSPOSTED }) as never);
    const item = publishMessageItem(channel(), message()) as MenuItem;
    act(() => item.onSelect!());
    await confirmDialog();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/messages/m1/crosspost'));
    await waitFor(() => expect(usePublished.getState().ids.m1).toBe(true));
    expect(useUi.getState().toasts.map((t) => t.message)).toContain(
      'Published to every channel following this one',
    );
  });

  it('an inline pill under my unpublished message publishes it, then shows Published', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(message({ flags: MESSAGE_FLAGS.CROSSPOSTED }) as never);
    const { rerender } = render(<PublishPill chat={channel()} m={message()} />);
    fireEvent.click(screen.getByTestId('publish-pill'));
    await confirmDialog();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/messages/m1/crosspost'));
    rerender(<PublishPill chat={channel()} m={message({ flags: MESSAGE_FLAGS.CROSSPOSTED })} />);
    expect(await screen.findByTestId('published-hint')).toHaveTextContent('Published');
    expect(screen.queryByTestId('publish-pill')).toBeNull();
  });

  it('no pill under others’ messages, published ones or outside announcement channels', () => {
    const mod = channel({ spacePermissions: MEMBER | PERM.MANAGE_MESSAGES });
    const { container, rerender } = render(
      <PublishPill chat={mod} m={message({ senderId: 'bob' })} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<PublishPill chat={channel()} m={message({ flags: MESSAGE_FLAGS.CROSSPOSTED })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PublishPill chat={channel({ space: info({ isNews: false }) })} m={message()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Follow', () => {
  it('lists my Spaces and text channels where I can manage webhooks, then follows', async () => {
    useSpaces.setState({
      byId: {
        s2: makeSpace({ id: 's2', name: 'Fans', myPermissions: PERM.MANAGE_WEBHOOKS }),
        s3: makeSpace({ id: 's3', name: 'Lurking', myPermissions: PERM.VIEW_CHANNEL }),
      },
      order: ['s2', 's3'],
    });
    const general = makeChat({
      id: 'c1',
      type: 'space_text',
      name: 'general',
      space: info({ spaceId: 's2', isNews: false }),
      spacePermissions: MEMBER | PERM.MANAGE_WEBHOOKS,
    });
    const rules = makeChat({
      id: 'c2',
      type: 'space_text',
      name: 'rules',
      space: info({ spaceId: 's2', isNews: false, position: 1 }),
      spacePermissions: MEMBER,
    });
    const voice = makeChat({
      id: 'c3',
      type: 'space_voice',
      name: 'Lounge',
      space: info({ spaceId: 's2', isNews: false }),
      spacePermissions: MEMBER | PERM.MANAGE_WEBHOOKS,
    });
    const get = vi.spyOn(api, 'get').mockResolvedValue([general, rules, voice] as never);
    const follow: ChannelFollow = {
      id: 'f1',
      sourceChannel: {
        id: 'news',
        name: 'news',
        spaceId: 's1',
        spaceName: 'Rockets',
        spaceIconUrl: null,
      },
      targetChannel: { id: 'c1', name: 'general', spaceId: 's2' },
      webhookId: 'w1',
      createdBy: 'me',
      createdAt: '2026-10-23T00:00:00.000Z',
    };
    const post = vi.spyOn(api, 'post').mockResolvedValue(follow as never);
    const onClose = vi.fn();
    render(<FollowDialog chat={channel()} onClose={onClose} />);

    const spaces = screen.getByLabelText('Space');
    expect([...spaces.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Select a Space',
      'Fans',
    ]);
    expect(screen.getByTestId('follow-submit')).toBeDisabled();
    fireEvent.change(spaces, { target: { value: 's2' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/spaces/s2/channels'));
    const channels = screen.getByLabelText('Channel');
    await waitFor(() =>
      expect([...channels.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
        'Select a channel',
        '#general',
      ]),
    );
    // The only channel is picked.
    expect(channels).toHaveValue('c1');
    fireEvent.click(screen.getByTestId('follow-submit'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats/news/followers', { targetChannelId: 'c1' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useUi.getState().toasts.map((t) => t.message)).toContain('Following #news in Fans');
  });

  it('Channels Followed lists the follows into this Space and unfollows', async () => {
    const follow: ChannelFollow = {
      id: 'f1',
      sourceChannel: {
        id: 'news',
        name: 'news',
        spaceId: 's9',
        spaceName: 'Rockets',
        spaceIconUrl: null,
      },
      targetChannel: { id: 'c1', name: 'general', spaceId: 's1' },
      webhookId: 'w1',
      createdBy: 'me',
      createdAt: '2026-10-23T00:00:00.000Z',
    };
    const get = vi.spyOn(api, 'get').mockResolvedValue([follow] as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    render(<FollowedChannels space={makeSpace({ owner: true })} />);
    const row = await screen.findByTestId('followed-channel');
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/follows');
    expect(row).toHaveTextContent('Rockets');
    expect(row).toHaveTextContent('#news');
    expect(row).toHaveTextContent('#general');
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
    await confirmDialog();
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/channel-follows/f1'));
    await waitFor(() => expect(screen.queryByTestId('followed-channel')).toBeNull());
  });
});

describe('Channel settings', () => {
  const dialog = (chat?: ChatSummary) =>
    render(
      <MemoryRouter>
        <ChannelDialog spaceId="s1" chat={chat} onClose={vi.fn()} />
      </MemoryRouter>,
    );

  it('creates an announcement channel (a text channel with isNews)', async () => {
    useSpaces.setState({ byId: { s1: makeSpace({ owner: true }) }, order: ['s1'] });
    const post = vi.spyOn(api, 'post').mockResolvedValue(channel() as never);
    dialog();
    const announcement = screen.getByRole('radio', { name: /Announcement/ });
    fireEvent.click(announcement);
    expect(announcement).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^Text/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.change(screen.getByTestId('channel-name'), { target: { value: 'News Desk' } });
    fireEvent.click(screen.getByTestId('channel-save'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/spaces/s1/channels',
        expect.objectContaining({ type: 'space_text', name: 'news-desk', isNews: true }),
      ),
    );
  });

  it('a text channel converts with the Announcement Channel switch', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(channel() as never);
    dialog(channel({ space: info({ isNews: false }) }));
    fireEvent.click(screen.getByRole('switch', { name: 'Announcement Channel' }));
    fireEvent.click(screen.getByTestId('channel-save'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/api/spaces/s1/channels/news',
        expect.objectContaining({ isNews: true }),
      ),
    );
  });
});
