/**
 * Space Settings → Community Overview, Welcome Screen, Onboarding: drafts behind the unsaved
 * changes bar, validation that keeps Save disabled, and one PATCH of what changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  PERM,
  type ChatSummary,
  type PermissionOverwrite,
  type Space,
  type SpaceCommunity,
  type UpdateSpaceCommunityRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe } from '@/test/factories';
import { makeSpace } from '../../testUtils';
import { CommunityOverviewPage } from './CommunityOverviewPage';
import { OnboardingPage } from './OnboardingPage';
import { WelcomeScreenPage } from './WelcomeScreenPage';

const community = (p: Partial<SpaceCommunity> = {}): SpaceCommunity => ({
  isDiscoverable: false,
  discoveryCategory: null,
  discoveryTags: [],
  vanityCode: null,
  welcomeScreen: null,
  onboarding: null,
  ...p,
});

function spaceWith(p: Parameters<typeof makeSpace>[0] = {}): Space {
  const space = makeSpace({
    id: 's1',
    name: 'Rocket Club',
    owner: true,
    description: 'We build rockets',
    roles: [
      { id: 'everyone', name: '@everyone', color: null, position: 0, permissions: DEFAULT_EVERYONE_PERMISSIONS, hoist: false, mentionable: false, isDefault: true },
      { id: 'gamer', name: 'Gamer', color: '#22c55e', position: 1, permissions: 0, hoist: false, mentionable: false, isDefault: false },
    ],
    ...p,
  });
  useSpaces.setState({ byId: { s1: space }, order: ['s1'], loaded: true, channelsLoaded: { s1: true }, members: {} });
  return space;
}

const channel = (id: string, name: string, p: Partial<ChatSummary> = {}, overwrites: PermissionOverwrite[] = []) =>
  makeChat({
    id,
    name,
    type: 'space_text',
    space: {
      spaceId: 's1',
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites,
    },
    ...p,
  });

/** GET community (+ the server config for invite links); PATCH echoes the body onto it. */
function mockApi(start: SpaceCommunity) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/spaces/s1/community') return start as never;
    if (path === '/api/config') return { publicUrl: 'https://enbox.dev' } as never;
    throw new Error(`unexpected GET ${path}`);
  });
  return vi
    .spyOn(api, 'patch')
    .mockImplementation(async (_path: string, body?: unknown) => ({ ...start, ...(body as UpdateSpaceCommunityRequest) }) as never);
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const save = () => within(bar()!).getByRole('button', { name: 'Save Changes' });

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('Community Overview', () => {
  it('listing needs a category; one PATCH saves the listing, tags and vanity URL', async () => {
    const space = spaceWith();
    const patch = mockApi(community());
    render(
      <MemoryRouter>
        <CommunityOverviewPage space={space} />
      </MemoryRouter>,
    );
    await screen.findByTestId('community-overview');
    expect(bar()).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'List this Space in discovery' }));
    expect(bar()).toHaveTextContent('Pick a category to list your Space');
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'gaming' } });
    expect(save()).toBeEnabled();

    const tags = screen.getByLabelText('Tags');
    fireEvent.change(tags, { target: { value: 'Retro' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Remove tag retro' })).toBeInTheDocument();

    const vanity = screen.getByLabelText('Invite code');
    fireEvent.change(vanity, { target: { value: 'ab' } });
    expect(bar()).toHaveTextContent(/Vanity URL/);
    expect(save()).toBeDisabled();
    fireEvent.change(vanity, { target: { value: 'My Space' } });
    expect(vanity).toHaveValue('my-space');
    await waitFor(() => expect(screen.getByTestId('vanity-preview')).toHaveTextContent('https://enbox.dev/join/my-space'));

    fireEvent.click(save());
    await waitFor(() => expect(bar()).toBeNull());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/community', {
      isDiscoverable: true,
      discoveryCategory: 'gaming',
      discoveryTags: ['retro'],
      vanityCode: 'my-space',
    });
    expect(useSpaces.getState().byId.s1).toMatchObject({ isDiscoverable: true, vanityCode: 'my-space' });
  });

  it('without a description the Space cannot be listed', async () => {
    const space = spaceWith({ description: null });
    mockApi(community());
    render(
      <MemoryRouter>
        <CommunityOverviewPage space={space} />
      </MemoryRouter>,
    );
    await screen.findByTestId('community-overview');
    expect(screen.getByRole('switch', { name: 'List this Space in discovery' })).toBeDisabled();
    expect(screen.getByRole('list', { name: 'Requirements' })).toHaveTextContent('(missing)');
  });
});

describe('Welcome Screen', () => {
  it('offers channels everyone can see; each needs a description; one PATCH saves it', async () => {
    const space = spaceWith();
    useChats.setState({
      byId: {
        c1: channel('c1', 'general'),
        c2: channel('c2', 'staff', {}, [{ targetType: 'role', targetId: 'everyone', allow: 0, deny: PERM.VIEW_CHANNEL }]),
        c3: channel('c3', 'Lounge', { type: 'space_voice' }),
      },
    });
    const patch = mockApi(community());
    render(
      <MemoryRouter>
        <WelcomeScreenPage space={space} />
      </MemoryRouter>,
    );
    await screen.findByTestId('welcome-screen-page');
    fireEvent.click(screen.getByRole('switch', { name: 'Show the welcome screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a channel' }));
    expect(bar()).toHaveTextContent('Pick a channel for every recommendation');
    expect(save()).toBeDisabled();

    const select = screen.getByRole('combobox', { name: 'Channel 1' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pick a channel', '#general']);
    fireEvent.change(select, { target: { value: 'c1' } });
    expect(bar()).toHaveTextContent('Describe every recommended channel');
    fireEvent.change(screen.getByRole('textbox', { name: 'Description of channel 1' }), { target: { value: 'Say hi' } });
    expect(save()).toBeEnabled();
    const preview = screen.getByRole('figure', { name: 'Welcome screen preview' });
    expect(preview).toHaveTextContent('Welcome to Rocket Club!');
    expect(preview).toHaveTextContent('#general');
    expect(preview).toHaveTextContent('Say hi');

    fireEvent.click(save());
    await waitFor(() => expect(bar()).toBeNull());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/community', {
      welcomeScreen: { enabled: true, description: null, channels: [{ channelId: 'c1', description: 'Say hi', emoji: null }] },
    });
  });

  it('an unchanged saved screen is not dirty', async () => {
    const space = spaceWith();
    useChats.setState({ byId: { c1: channel('c1', 'general') } });
    // jsonb hands keys back in its own order.
    mockApi(
      community({
        welcomeScreen: { channels: [{ emoji: null, channelId: 'c1', description: 'Say hi' }], enabled: true, description: null },
      }),
    );
    render(
      <MemoryRouter>
        <WelcomeScreenPage space={space} />
      </MemoryRouter>,
    );
    await screen.findByTestId('welcome-screen-page');
    expect(screen.getByRole('combobox', { name: 'Channel 1' })).toHaveValue('c1');
    expect(bar()).toBeNull();
  });
});

describe('Onboarding', () => {
  it('questions need a title and titled options; roles come from a menu; one PATCH saves it', async () => {
    const space = spaceWith();
    const patch = mockApi(community());
    render(
      <MemoryRouter>
        <OnboardingPage space={space} />
      </MemoryRouter>,
    );
    await screen.findByTestId('onboarding-page');
    const enable = screen.getByRole('switch', { name: 'Turn on onboarding' });
    expect(enable).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    expect(bar()).toHaveTextContent('Give every question a title');
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Question 1' }), { target: { value: 'Why are you here?' } });
    expect(bar()).toHaveTextContent('Give every option a title');
    fireEvent.change(screen.getByRole('textbox', { name: 'Question 1, option 1 title' }), { target: { value: 'Games' } });
    expect(save()).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Gamer' }));
    expect(screen.getByRole('button', { name: 'Remove Gamer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Required' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Turn on onboarding' }));
    const preview = screen.getByRole('figure', { name: 'Onboarding preview' });
    expect(within(preview).getByRole('heading', { name: /Why are you here\?/ })).toBeInTheDocument();
    expect(within(preview).getByRole('checkbox', { name: /Games/ })).toBeInTheDocument();

    fireEvent.click(save());
    await waitFor(() => expect(bar()).toBeNull());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/community', {
      onboarding: {
        enabled: true,
        prompts: [
          {
            id: expect.any(String),
            title: 'Why are you here?',
            singleSelect: false,
            required: true,
            options: [{ id: expect.any(String), title: 'Games', description: null, emoji: null, roleIds: ['gamer'] }],
          },
        ],
      },
    });
  });

  it('roles at or above mine are not offered', async () => {
    const space = spaceWith({
      owner: false,
      ownerId: 'someone',
      myPermissions: PERM.MANAGE_SPACE | PERM.MANAGE_ROLES,
      me: { roleIds: ['gamer'] },
      roles: [
        { id: 'everyone', name: '@everyone', color: null, position: 0, permissions: DEFAULT_EVERYONE_PERMISSIONS, hoist: false, mentionable: false, isDefault: true },
        { id: 'helper', name: 'Helper', color: null, position: 1, permissions: 0, hoist: false, mentionable: false, isDefault: false },
        { id: 'gamer', name: 'Gamer', color: null, position: 2, permissions: 0, hoist: false, mentionable: false, isDefault: false },
        { id: 'admin', name: 'Admin', color: null, position: 3, permissions: 0, hoist: false, mentionable: false, isDefault: false },
      ],
    });
    mockApi(community());
    render(
      <MemoryRouter>
        <OnboardingPage space={space} />
      </MemoryRouter>,
    );
    await screen.findByTestId('onboarding-page');
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Helper']);
  });
});
