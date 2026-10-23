/**
 * Channels & Roles: the onboarding questions with my answers as chips, required questions
 * keeping Save disabled, and one PUT of my answers whose roles land in my Space.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { SpaceCommunity, SpaceOnboarding } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { ChannelsRolesPage } from './ChannelsRolesPage';
import { seedSpace } from './testUtils';

const onboarding: SpaceOnboarding = {
  enabled: true,
  prompts: [
    {
      id: 'p1',
      title: 'What brings you here?',
      singleSelect: true,
      required: true,
      options: [
        { id: 'o1', title: 'Games', description: 'Play with us', emoji: '🎮', roleIds: ['gamer'] },
        { id: 'o2', title: 'Art', description: null, emoji: null, roleIds: ['artist'] },
      ],
    },
    {
      id: 'p2',
      title: 'When are you around?',
      singleSelect: false,
      required: false,
      options: [
        { id: 'o3', title: 'Nights', description: null, emoji: null, roleIds: ['night'] },
        { id: 'o4', title: 'Weekends', description: null, emoji: null, roleIds: [] },
      ],
    },
  ],
};

function mockCommunity(o: SpaceOnboarding | null) {
  const community = { onboarding: o } as SpaceCommunity;
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/spaces/s1/community') return community as never;
    throw new Error(`unexpected GET ${path}`);
  });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/spaces/s1/channels-roles']}>
      <Routes>
        <Route path="/spaces/:spaceId/channels-roles" element={<ChannelsRolesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** An option chip by its title (single-select questions: radios, others: checkboxes). */
const chip = (name: string) =>
  [...screen.queryAllByRole('radio'), ...screen.queryAllByRole('checkbox')].find((el) =>
    el.textContent?.includes(name),
  )!;
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('Channels & Roles', () => {
  it('shows my answers; changing them sends one PUT and my roles follow', async () => {
    mockCommunity(onboarding);
    seedSpace({ me: { roleIds: ['gamer'], onboardingAnswers: { p1: ['o1'] } } });
    const put = vi.spyOn(api, 'put').mockResolvedValue({ roleIds: ['artist', 'night'] } as never);
    renderPage();
    await screen.findByText('What brings you here?');
    expect(screen.getAllByTestId('channels-roles-prompt')).toHaveLength(2);
    expect(
      within(screen.getByRole('radiogroup'))
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-checked')),
    ).toEqual(['true', 'false']);
    expect(chip('Nights')).toHaveAttribute('aria-checked', 'false');
    expect(bar()).toBeNull();

    fireEvent.click(chip('Art'));
    expect(chip('Games')).toHaveAttribute('aria-checked', 'false');
    expect(chip('Art')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(chip('Nights'));
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Save Changes' }));
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/onboarding/answers', {
      answers: { p1: ['o2'], p2: ['o3'] },
    });
    await vi.waitFor(() => expect(bar()).toBeNull());
    const me = useSpaces.getState().byId.s1!.me;
    expect(me.roleIds).toEqual(['artist', 'night']);
    expect(me.onboardingAnswers).toEqual({ p1: ['o2'], p2: ['o3'] });
    expect(chip('Art')).toHaveAttribute('aria-checked', 'true');
  });

  it('a required question needs an answer before saving; Reset goes back to mine', async () => {
    mockCommunity(onboarding);
    seedSpace({ me: { onboardingAnswers: { p1: ['o1'], p2: ['o4'] } } });
    renderPage();
    await screen.findByText('What brings you here?');
    fireEvent.click(chip('Games'));
    expect(bar()).toHaveTextContent('Answer “What brings you here?”');
    expect(within(bar()!).getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Reset' }));
    expect(chip('Games')).toHaveAttribute('aria-checked', 'true');
    expect(chip('Weekends')).toHaveAttribute('aria-checked', 'true');
  });

  it('a member who never answered starts with nothing picked', async () => {
    mockCommunity(onboarding);
    seedSpace({ me: { onboardingAnswers: null } });
    renderPage();
    await screen.findByText('What brings you here?');
    expect(
      screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
  });

  it('without onboarding there is nothing to answer', async () => {
    mockCommunity(null);
    seedSpace();
    renderPage();
    expect(await screen.findByText('No questions here')).toBeInTheDocument();
  });
});
