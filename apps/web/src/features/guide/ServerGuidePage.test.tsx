/**
 * The Server Guide members see (welcome sign, to-dos with my progress, resource cards) and the
 * sidebar shortcuts: Server Guide with a progress ring until done, Browse Channels, Channels &
 * Roles when the Space has onboarding; opening a to-do's channel ticks it once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { GuideProgress, ServerGuide, SpaceOnboarding } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpace, useSpaces } from '@/stores/spaces';
import { makeMe } from '@/test/factories';
import { ServerGuidePage } from './ServerGuidePage';
import { SidebarGuideLinks } from './SidebarGuideLinks';
import { seedSpace, spaceChannel } from './testUtils';

const guide = (p: Partial<ServerGuide> = {}): ServerGuide => ({
  enabled: true,
  welcome: { title: 'Welcome aboard!', subtitle: 'Start with the rules' },
  todos: [
    { channelId: 'rules', emoji: '📜', description: 'Read the rules' },
    { channelId: 'general', emoji: null, description: 'Say hi' },
  ],
  resources: [
    { channelId: 'faq', title: 'FAQ', description: 'Answers to common questions', emoji: '❓' },
  ],
  ...p,
});

const channels = [
  spaceChannel('rules', 'rules'),
  spaceChannel('general', 'general'),
  spaceChannel('faq', 'faq'),
];

const onboarding: SpaceOnboarding = {
  enabled: true,
  prompts: [
    {
      id: 'p1',
      title: 'Q',
      singleSelect: false,
      required: false,
      options: [{ id: 'o1', title: 'A', description: null, emoji: null, roleIds: [] }],
    },
  ],
};

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** The shortcuts as the sidebar mounts them (my Space from the store). */
function Links() {
  const space = useSpace('s1');
  return space ? <SidebarGuideLinks space={space} /> : null;
}

function mockCommunity(withOnboarding: boolean) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/spaces/s1/community')
      return { onboarding: withOnboarding ? onboarding : null } as never;
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/spaces/:spaceId/guide" element={<ServerGuidePage />} />
        <Route
          path="/spaces/:spaceId/:chatId?"
          element={
            <>
              <Links />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
});

describe('Server Guide page', () => {
  it('shows the welcome sign, my to-dos with progress and the resource cards', () => {
    mockCommunity(false);
    seedSpace({ guide: guide(), me: { guideDone: ['general'] } }, channels);
    renderAt('/spaces/s1/guide');
    const welcome = within(screen.getByTestId('guide-welcome'));
    expect(welcome.getByRole('heading', { name: 'Welcome aboard!' })).toBeInTheDocument();
    expect(welcome.getByText('Start with the rules')).toBeInTheDocument();
    expect(welcome.getByText('Rocket Club')).toBeInTheDocument();

    expect(screen.getByTestId('guide-progress')).toHaveTextContent('1 of 2');
    expect(screen.getByRole('progressbar', { name: 'To-dos done' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    const todos = screen.getAllByTestId('guide-todo');
    expect(
      todos.map((t) => [t.textContent?.includes('Read the rules'), t.hasAttribute('data-done')]),
    ).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(todos[0]).toHaveAttribute('href', '/spaces/s1/rules');
    const card = screen.getByTestId('guide-resource');
    expect(card).toHaveTextContent('FAQ');
    expect(card).toHaveTextContent('Answers to common questions');
    expect(card).toHaveAttribute('href', '/spaces/s1/faq');
  });

  it('every to-do done: a cheer', () => {
    mockCommunity(false);
    seedSpace({ guide: guide(), me: { guideDone: ['rules', 'general'] } }, channels);
    renderAt('/spaces/s1/guide');
    expect(screen.getByTestId('guide-progress')).toHaveTextContent('2 of 2');
    expect(screen.getByText(/You did them all/)).toBeInTheDocument();
  });

  it('a Space without a guide shows the empty state (managers can set it up)', () => {
    mockCommunity(false);
    seedSpace({ guide: guide({ enabled: false }), owner: true }, channels);
    renderAt('/spaces/s1/guide');
    expect(screen.getByText('No Server Guide yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up the Server Guide' })).toBeInTheDocument();
    expect(screen.queryByTestId('guide-welcome')).toBeNull();
  });
});

describe('sidebar shortcuts', () => {
  it('Server Guide with a ring until every to-do is done; Channels & Roles only with onboarding', async () => {
    mockCommunity(true);
    seedSpace({ guide: guide(), me: { guideDone: ['general'] } }, channels);
    renderAt('/spaces/s1');
    const links = within(screen.getByTestId('sidebar-guide-links'));
    expect(links.getByRole('link', { name: /Server Guide/ })).toHaveAttribute(
      'href',
      '/spaces/s1/guide',
    );
    expect(links.getByRole('img', { name: '1 of 2 done' })).toBeInTheDocument();
    expect(links.getByRole('link', { name: 'Browse Channels' })).toHaveAttribute(
      'href',
      '/spaces/s1/browse',
    );
    expect(await links.findByRole('link', { name: 'Channels & Roles' })).toHaveAttribute(
      'href',
      '/spaces/s1/channels-roles',
    );

    fireEvent.click(links.getByRole('link', { name: 'Browse Channels' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1/browse');
  });

  it('no guide, no onboarding: just Browse Channels; a finished guide has no ring', async () => {
    mockCommunity(false);
    seedSpace({ guide: null }, channels);
    renderAt('/spaces/s1');
    const links = within(screen.getByTestId('sidebar-guide-links'));
    expect(links.getAllByRole('link').map((l) => l.textContent)).toEqual(['Browse Channels']);
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/spaces/s1/community'));
    expect(links.queryByRole('link', { name: 'Channels & Roles' })).toBeNull();
  });

  it('opening a to-do’s channel ticks it, once', async () => {
    mockCommunity(false);
    seedSpace({ guide: guide() }, channels);
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ doneChannelIds: ['rules'] } satisfies GuideProgress as never);
    renderAt('/spaces/s1/rules');
    await vi.waitFor(() => expect(useSpaces.getState().byId.s1!.me.guideDone).toEqual(['rules']));
    // The shortcuts re-rendered with the tick: no second request.
    await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/guide/todos/rules/done');
  });

  it('done to-dos and channels that are no to-do are not ticked again', () => {
    mockCommunity(false);
    seedSpace({ guide: guide(), me: { guideDone: ['rules'] } }, channels);
    const post = vi.spyOn(api, 'post');
    renderAt('/spaces/s1/rules');
    renderAt('/spaces/s1/faq');
    expect(post).not.toHaveBeenCalled();
  });
});
