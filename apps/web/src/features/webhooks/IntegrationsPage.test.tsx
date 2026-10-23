/**
 * Space Settings ▸ Integrations: webhook cards grouped by channel (follower webhooks left to
 * Channels Followed), New Webhook (first text channel, a friendly name, Copy Webhook URL
 * right away), editing name / channel / avatar staged until Save (Reset discards),
 * Regenerate URL and Delete behind a confirmation. The API is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChatSummary, MediaAttachment, Webhook, WebhookWithUrl } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { IntegrationsPage } from './IntegrationsPage';
import { defaultWebhookName } from './actions';

vi.mock('@/features/announcements/FollowedChannels', () => ({
  FollowedChannels: () => <div data-testid="followed-channels" />,
}));
// The crop-and-upload flow has its own tests: here a click "uploads" an avatar.
vi.mock('@/features/groups/shared/EditableAvatar', () => ({
  EditableAvatar: (p: {
    label: string;
    src: string | null;
    onUploaded: (m: MediaAttachment) => void;
    onRemove?: () => void;
  }) => (
    <span>
      <button
        type="button"
        onClick={() =>
          p.onUploaded({
            id: 'media-1',
            url: '/uploads/new.png',
            animated: false,
          } as MediaAttachment)
        }
      >
        {p.label}
      </button>
      {p.onRemove ? (
        <button type="button" onClick={p.onRemove}>
          Remove avatar
        </button>
      ) : null}
      <span data-testid="avatar-src">{p.src ?? ''}</span>
    </span>
  ),
}));

const space = makeSpace({ owner: true });

function channel(
  id: string,
  name: string,
  position: number,
  type: ChatSummary['type'] = 'space_text',
): ChatSummary {
  return {
    ...makeChat({ id, name, type }),
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

const hook = (id: string, name: string, p: Partial<Webhook> = {}): Webhook => ({
  id,
  spaceId: 's1',
  channelId: 'general',
  kind: 'incoming',
  name,
  avatarUrl: null,
  createdBy: 'u2',
  createdAt: '2026-10-20T10:00:00.000Z',
  ...p,
});

const url = (id: string) => `https://enbox.example/api/webhooks/${id}/${'s'.repeat(43)}`;

function setup(
  list: Webhook[],
  channels = [channel('general', 'general', 0), channel('deploys', 'deploys', 1)],
) {
  useSpaces.setState({ byId: { s1: space }, order: ['s1'], loaded: true, members: {} });
  useChats.setState({ byId: Object.fromEntries(channels.map((c) => [c.id, c])) });
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(
      async (path: string) => (path === '/api/spaces/s1/webhooks' ? list : []) as never,
    );
  const post = vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    const created = /^\/api\/chats\/([^/]+)\/webhooks$/.exec(path);
    if (created)
      return {
        ...hook('w-new', (body as { name: string }).name, {
          channelId: created[1]!,
          createdBy: 'me',
        }),
        url: url('w-new'),
      } satisfies WebhookWithUrl as never;
    const regen = /^\/api\/webhooks\/([^/]+)\/token$/.exec(path);
    if (regen) return { ...list.find((w) => w.id === regen[1])!, url: url(regen[1]!) } as never;
    return [] as never; // users batch
  });
  const patch = vi.spyOn(api, 'patch').mockImplementation(async (path: string, body?: unknown) => {
    const id = path.split('/').pop()!;
    const b = body as { name?: string; channelId?: string; avatarMediaId?: string | null };
    const current = list.find((w) => w.id === id)!;
    return {
      ...current,
      ...(b.name ? { name: b.name } : {}),
      ...(b.channelId ? { channelId: b.channelId } : {}),
      ...(b.avatarMediaId !== undefined
        ? { avatarUrl: b.avatarMediaId ? '/uploads/new.png' : null }
        : {}),
    } as never;
  });
  const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
  render(<IntegrationsPage space={space} />);
  return { get, post, patch, del };
}

const card = (name: string) =>
  screen.getAllByTestId('webhook-card').find((el) => el.textContent?.includes(name))!;

async function confirmDialog(answer: 'confirm' | 'cancel', title: string) {
  await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
  const dialog = useUi.getState().dialogs[0]!;
  expect(dialog.title).toBe(title);
  act(() => useUi.getState().closeDialog(dialog.id, answer));
}

const writeText = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.setState({ byId: { u2: makeUser({ id: 'u2', displayName: 'Uma' }) } });
  useUi.setState({ toasts: [], dialogs: [] });
});

describe('defaultWebhookName', () => {
  it('picks the first friendly name not taken (ignoring case), then numbers', () => {
    expect(defaultWebhookName([])).toBe('Captain Hook');
    expect(defaultWebhookName(['captain hook'])).toBe('Beep Boop');
    expect(
      defaultWebhookName(['Captain Hook', 'Beep Boop', 'Relay Bot', 'Courier', 'Signal Bot']),
    ).toBe('Captain Hook 2');
  });
});

describe('IntegrationsPage', () => {
  it('lists the webhooks grouped by channel with creator and date; follower webhooks stay out', async () => {
    setup([
      hook('w1', 'Captain Hook'),
      hook('w2', 'Relay Bot', { channelId: 'deploys' }),
      hook('f1', 'Beta #announcements', { kind: 'follower' }),
    ]);
    const groups = await screen.findAllByTestId('webhook-group');
    expect(groups.map((g) => within(g).getByRole('heading').textContent)).toEqual([
      '#general',
      '#deploys',
    ]);
    expect(within(groups[0]!).getAllByTestId('webhook-card')).toHaveLength(1);
    expect(card('Captain Hook')).toHaveTextContent(/#general · Created on .*2026 by Uma/);
    expect(screen.queryByText('Beta #announcements')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Channels Followed' })).toBeInTheDocument();
    expect(screen.getByTestId('followed-channels')).toBeInTheDocument();
  });

  it('New Webhook adds one to the first text channel with a friendly name and offers its URL', async () => {
    const { post } = setup([]);
    await screen.findByText(/No webhooks yet/);
    fireEvent.click(screen.getByRole('button', { name: 'New Webhook' }));
    await screen.findByTestId('webhook-editor');
    expect(post).toHaveBeenCalledWith('/api/chats/general/webhooks', { name: 'Captain Hook' });
    expect(card('Captain Hook')).toHaveTextContent('#general');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Webhook URL' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url('w-new')));
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
  });

  it('without a text channel New Webhook is off', async () => {
    setup([], [channel('lobby', 'Lobby', 0, 'space_voice')]);
    expect(await screen.findByText(/Create a text channel first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Webhook' })).toBeDisabled();
  });

  it('edits stay staged until Save: name, channel and avatar; Reset discards them', async () => {
    const { patch } = setup([
      hook('w1', 'Captain Hook'),
      hook('w2', 'Relay Bot', { channelId: 'deploys' }),
    ]);
    await screen.findAllByTestId('webhook-card');
    fireEvent.click(within(card('Captain Hook')).getByRole('button', { expanded: false }));
    const editor = screen.getByTestId('webhook-editor');
    const name = within(editor).getByLabelText('Name');

    fireEvent.change(name, { target: { value: 'Hooky' } });
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(name).toHaveValue('Captain Hook');
    expect(screen.queryByText(/unsaved changes/)).toBeNull();

    fireEvent.change(name, { target: { value: '   ' } });
    expect(screen.getByText('A webhook needs a name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    fireEvent.change(name, { target: { value: ' Hooky ' } });
    fireEvent.change(within(editor).getByLabelText('Channel'), { target: { value: 'deploys' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Change webhook avatar' }));
    expect(within(editor).getByTestId('avatar-src')).toHaveTextContent('/uploads/new.png');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/webhooks/w1', {
        name: 'Hooky',
        channelId: 'deploys',
        avatarMediaId: 'media-1',
      }),
    );
    // It moved: now the #deploys group holds both.
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('webhook-group')
          .map((g) => within(g).getByRole('heading').textContent),
      ).toEqual(['#deploys']),
    );
    expect(card('Hooky')).toHaveTextContent('#deploys');
    expect(screen.queryByText(/unsaved changes/)).toBeNull();
  });

  it('Regenerate URL asks first, then offers the new URL to copy', async () => {
    const { post } = setup([hook('w1', 'Captain Hook')]);
    await screen.findAllByTestId('webhook-card');
    fireEvent.click(within(card('Captain Hook')).getByRole('button', { expanded: false }));
    expect(screen.queryByRole('button', { name: 'Copy Webhook URL' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate URL' }));
    await confirmDialog('cancel', 'Regenerate Webhook URL');
    expect(post).not.toHaveBeenCalledWith('/api/webhooks/w1/token');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate URL' }));
    await confirmDialog('confirm', 'Regenerate Webhook URL');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy Webhook URL' }));
    expect(post).toHaveBeenCalledWith('/api/webhooks/w1/token');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url('w1')));
  });

  it('Delete asks first and removes the card', async () => {
    const { del } = setup([hook('w1', 'Captain Hook'), hook('w2', 'Relay Bot')]);
    await screen.findAllByTestId('webhook-card');
    fireEvent.click(within(card('Relay Bot')).getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Webhook' }));
    await confirmDialog('confirm', 'Delete Webhook');
    await waitFor(() => expect(screen.getAllByTestId('webhook-card')).toHaveLength(1));
    expect(del).toHaveBeenCalledWith('/api/webhooks/w2');
    expect(card('Captain Hook')).toBeInTheDocument();
  });
});
