/**
 * Opening a Space: onboarding while I still have to do it (a required question blocks Next,
 * Finish sends my picks, Skip when nothing is required), then the welcome screen — once per
 * device and Space.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { Space, SpaceCommunity, SpaceOnboarding } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe } from '@/test/factories';
import { makeSpace } from '../testUtils';
import { CommunityGate, openSpaceId } from './CommunityGate';
// The gate loads these lazily: importing them here makes that instant in tests.
import './OnboardingFlow';
import './WelcomeModal';

const general = makeChat({
  id: 'c1',
  type: 'space_text',
  name: 'general',
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
    overwrites: [],
  },
});

const welcome: SpaceCommunity['welcomeScreen'] = {
  enabled: true,
  description: 'Glad you made it',
  channels: [{ channelId: 'c1', description: 'Say hi', emoji: '👋' }],
};

const onboarding = (required: boolean): SpaceOnboarding => ({
  enabled: true,
  prompts: [
    {
      id: 'p1',
      title: 'What brings you here?',
      singleSelect: true,
      required,
      options: [
        { id: 'o1', title: 'Games', description: 'Play with us', emoji: '🎮', roleIds: ['gamer'] },
        { id: 'o2', title: 'Art', description: null, emoji: null, roleIds: [] },
      ],
    },
    {
      id: 'p2',
      title: 'Anything else?',
      singleSelect: false,
      required: false,
      options: [{ id: 'o3', title: 'Just looking', description: null, emoji: null, roleIds: [] }],
    },
  ],
});

const community = (p: Partial<SpaceCommunity>): SpaceCommunity => ({
  isDiscoverable: false,
  discoveryCategory: null,
  discoveryTags: [],
  vanityCode: null,
  welcomeScreen: null,
  onboarding: null,
  ...p,
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderGate(path = '/spaces/s1/c1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CommunityGate />
      <Where />
    </MemoryRouter>,
  );
}

function setSpace(me: Partial<Space['me']>): Space {
  const space = makeSpace({ id: 's1', name: 'Rocket Club', me });
  useSpaces.setState({ byId: { s1: space }, order: ['s1'], loaded: true, channelsLoaded: { s1: true }, members: {} });
  return space;
}

function mockGets(c: SpaceCommunity, fresh?: Space) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/spaces/s1/community') return c as never;
    if (path === '/api/spaces/s1/members/me' && fresh) return fresh as never;
    throw new Error(`unexpected GET ${path}`);
  });
}

beforeEach(() => {
  resetSessionState(); // drops the cached community settings
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useChats.setState({ byId: { c1: general } });
  useUi.setState({ toasts: [] });
});

describe('openSpaceId', () => {
  it('is the Space of a Space or channel route, not of its settings', () => {
    expect(openSpaceId('/spaces/s1')).toBe('s1');
    expect(openSpaceId('/spaces/s1/c1')).toBe('s1');
    expect(openSpaceId('/spaces/s1/settings')).toBeNull();
    expect(openSpaceId('/spaces/s1/settings/roles')).toBeNull();
    expect(openSpaceId('/spaces')).toBeNull();
    expect(openSpaceId('/chats/s1')).toBeNull();
  });
});

describe('the welcome screen', () => {
  it('shows once per device and Space; a recommended channel opens', async () => {
    setSpace({ onboardedAt: '2026-01-01T00:00:00.000Z' });
    const get = mockGets(community({ welcomeScreen: welcome }));
    const first = renderGate('/spaces/s1');
    const dialog = await screen.findByRole('dialog', { name: 'Welcome to Rocket Club' });
    expect(within(dialog).getByText('Glad you made it')).toBeInTheDocument();
    expect(within(dialog).getByText('Say hi')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /#general/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/c1'));
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();

    get.mockClear();
    renderGate('/spaces/s1');
    // Seen on this device: nothing is even fetched.
    await new Promise((r) => setTimeout(r, 30));
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays away while it is off, and shows once it is on', async () => {
    setSpace({ onboardedAt: '2026-01-01T00:00:00.000Z' });
    const get = mockGets(community({ welcomeScreen: { ...welcome!, enabled: false } }));
    const view = renderGate();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/spaces/s1/community'));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    resetSessionState();
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    setSpace({ onboardedAt: '2026-01-01T00:00:00.000Z' });
    mockGets(community({ welcomeScreen: welcome }));
    renderGate();
    expect(await screen.findByRole('dialog', { name: 'Welcome to Rocket Club' })).toBeInTheDocument();
  });
});

describe('onboarding', () => {
  it('a required question blocks Next; Finish sends my picks; the welcome screen follows', async () => {
    const space = setSpace({ onboardedAt: null });
    mockGets(community({ onboarding: onboarding(true), welcomeScreen: welcome }), space);
    const done: Space = { ...space, me: { ...space.me, onboardedAt: '2026-10-23T00:00:00.000Z', roleIds: ['gamer'] } };
    const post = vi.spyOn(api, 'post').mockResolvedValue(done as never);
    renderGate();

    const flow = await screen.findByTestId('onboarding-flow');
    expect(within(flow).getByRole('heading', { name: /What brings you here\?/ })).toBeInTheDocument();
    expect(within(flow).getByText('Question 1 of 2')).toBeInTheDocument();
    expect(within(flow).queryByRole('button', { name: 'Skip' })).toBeNull();
    const next = within(flow).getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    // Single select: the second pick replaces the first.
    fireEvent.click(within(flow).getByRole('radio', { name: /Art/ }));
    fireEvent.click(within(flow).getByRole('radio', { name: /Games/ }));
    expect(within(flow).getByRole('radio', { name: /Games/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(flow).getByRole('radio', { name: /Art/ })).toHaveAttribute('aria-checked', 'false');
    expect(next).toBeEnabled();
    fireEvent.click(next);

    expect(within(flow).getByRole('heading', { name: 'Anything else?' })).toBeInTheDocument();
    fireEvent.click(within(flow).getByRole('button', { name: 'Next' })); // optional
    expect(within(flow).getByRole('heading', { name: 'You’re all set!' })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(flow).getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/spaces/s1/onboarding/answers', { optionIds: ['o1'] }));
    expect(await screen.findByRole('dialog', { name: 'Welcome to Rocket Club' })).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
    expect(useSpaces.getState().byId.s1?.me).toMatchObject({ roleIds: ['gamer'], onboardedAt: done.me.onboardedAt });
  });

  it('Skip finishes early when nothing is required', async () => {
    const space = setSpace({ onboardedAt: null });
    mockGets(community({ onboarding: onboarding(false) }), space);
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ ...space, me: { ...space.me, onboardedAt: '2026-10-23T00:00:00.000Z' } } as never);
    renderGate();
    const flow = await screen.findByTestId('onboarding-flow');
    expect(within(flow).getByRole('button', { name: 'Next' })).toBeEnabled();
    fireEvent.click(within(flow).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/spaces/s1/onboarding/answers', { optionIds: [] }));
    await waitFor(() => expect(screen.queryByTestId('onboarding-flow')).toBeNull());
  });

  it('is not shown when the server already counts me as onboarded', async () => {
    const space = setSpace({ onboardedAt: null });
    const fresh = { ...space, me: { ...space.me, onboardedAt: '2026-01-01T00:00:00.000Z' } };
    const get = mockGets(community({ onboarding: onboarding(true) }), fresh);
    renderGate();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/spaces/s1/members/me'));
    await waitFor(() => expect(useSpaces.getState().byId.s1?.me.onboardedAt).toBe(fresh.me.onboardedAt));
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
  });

  it('Leave for now goes Home; it shows again next time', async () => {
    const space = setSpace({ onboardedAt: null });
    mockGets(community({ onboarding: onboarding(true) }), space);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave for now' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/chats'));
    expect(screen.queryByTestId('onboarding-flow')).toBeNull();
  });
});
