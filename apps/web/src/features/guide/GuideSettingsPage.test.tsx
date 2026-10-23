/**
 * Space Settings ▸ Server Guide: the draft behind the unsaved changes bar, the checks that keep
 * Save disabled, public text channels only, the limits, reordering, and one PUT of the whole
 * guide.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  DEFAULT_EVERYONE_PERMISSIONS,
  GUIDE_MAX_TODOS,
  PERM,
  type ServerGuide,
  type Space,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { GuideSettingsPage, guideProblem } from './GuideSettingsPage';
import { seedSpace, spaceChannel } from './testUtils';

const everyone = {
  id: 'everyone',
  name: '@everyone',
  color: null,
  position: 0,
  permissions: DEFAULT_EVERYONE_PERMISSIONS,
  hoist: false,
  mentionable: false,
  isDefault: true,
};

function seed(guide: ServerGuide | null = null): Space {
  return seedSpace({ owner: true, roles: [everyone], guide }, [
    spaceChannel('rules', 'rules', {}, { position: 0 }),
    spaceChannel('general', 'general', {}, { position: 1 }),
    spaceChannel('lounge', 'Lounge', { type: 'space_voice' }, { position: 2 }),
    spaceChannel(
      'staff',
      'staff',
      {},
      {
        position: 3,
        overwrites: [
          { targetType: 'role', targetId: 'everyone', allow: 0, deny: PERM.VIEW_CHANNEL },
        ],
      },
    ),
  ]);
}

function renderPage() {
  const space = useSpaces.getState().byId.s1!;
  return render(
    <MemoryRouter>
      <Page key={space.id} />
    </MemoryRouter>,
  );
}

/** The page as Space Settings mounts it (my Space from the store). */
function Page() {
  const space = useSpaces((s) => s.byId.s1!);
  return <GuideSettingsPage space={space} />;
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const save = () => within(bar()!).getByRole('button', { name: 'Save Changes' });
const options = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('Server Guide settings', () => {
  it('builds a guide: checks keep Save disabled; one PUT sends the whole guide', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockImplementation(async (_p: string, body?: unknown) => body as never);
    seed();
    renderPage();
    expect(screen.getByLabelText('Title')).toHaveValue('Welcome to Rocket Club!');
    expect(bar()).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Show the Server Guide' }));
    fireEvent.change(screen.getByLabelText('Subtitle'), { target: { value: 'Start here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    expect(bar()).toHaveTextContent('Pick a channel for every to-do');
    expect(save()).toBeDisabled();
    // Text channels everyone can see only.
    expect(options('Channel of to-do 1')).toEqual(['Pick a channel', '#rules', '#general']);
    fireEvent.change(screen.getByLabelText('Channel of to-do 1'), { target: { value: 'rules' } });
    expect(bar()).toHaveTextContent('Say what to do in every to-do');
    fireEvent.change(screen.getByLabelText('What to do in to-do 1'), {
      target: { value: ' Read the rules ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add a resource page' }));
    fireEvent.change(screen.getByLabelText('Channel of resource page 1'), {
      target: { value: 'general' },
    });
    expect(bar()).toHaveTextContent('Give every resource page a title');
    fireEvent.change(screen.getByLabelText('Title of resource page 1'), {
      target: { value: 'Chat' },
    });
    expect(save()).toBeEnabled();

    // The preview follows the draft.
    expect(
      within(screen.getByRole('figure', { name: 'Welcome sign preview' })).getByText('Start here'),
    ).toBeInTheDocument();

    fireEvent.click(save());
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/api/spaces/s1/guide', {
      enabled: true,
      welcome: { title: 'Welcome to Rocket Club!', subtitle: 'Start here' },
      todos: [{ channelId: 'rules', emoji: null, description: 'Read the rules' }],
      resources: [{ channelId: 'general', title: 'Chat', description: null, emoji: null }],
    });
    await vi.waitFor(() => expect(bar()).toBeNull());
    expect(useSpaces.getState().byId.s1!.guide?.todos).toHaveLength(1);
  });

  it(`at most ${GUIDE_MAX_TODOS} to-dos; each channel once per list`, () => {
    seed();
    renderPage();
    for (let i = 0; i < GUIDE_MAX_TODOS; i++)
      fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    expect(screen.queryByRole('button', { name: 'Add a to-do' })).toBeNull();
    expect(
      screen.getByText(`New member to-dos — ${GUIDE_MAX_TODOS}/${GUIDE_MAX_TODOS}`),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Channel of to-do 1'), { target: { value: 'rules' } });
    // Taken by to-do 1: not offered to the others.
    const second = screen.getByLabelText('Channel of to-do 2') as HTMLSelectElement;
    expect(Array.from(second.options).find((o) => o.value === 'rules')?.disabled).toBe(true);
    expect(
      guideProblem({
        enabled: true,
        title: 'Hi',
        subtitle: '',
        todos: [],
        resources: [
          { key: 'a', channelId: 'rules', title: 'A', description: '', emoji: null },
          { key: 'b', channelId: 'rules', title: 'B', description: '', emoji: null },
        ],
      }),
    ).toBe('Give each resource page its own channel');
  });

  it('loads the saved guide; rows reorder; Reset puts the draft back', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockImplementation(async (_p: string, body?: unknown) => body as never);
    seed({
      enabled: true,
      welcome: { title: 'Hello', subtitle: null },
      todos: [
        { channelId: 'rules', emoji: '📜', description: 'Read' },
        { channelId: 'general', emoji: null, description: 'Chat' },
      ],
      resources: [],
    });
    renderPage();
    expect(screen.getByLabelText('Title')).toHaveValue('Hello');
    expect(screen.getByLabelText('What to do in to-do 1')).toHaveValue('Read');
    expect(screen.getByRole('button', { name: 'Drag to-do 1' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Move to-do down' })[0]!);
    expect(screen.getByLabelText('What to do in to-do 1')).toHaveValue('Chat');
    expect(bar()).toBeInTheDocument();
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('What to do in to-do 1')).toHaveValue('Read');
    expect(bar()).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Move to-do down' })[0]!);
    fireEvent.click(save());
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put.mock.calls[0]![1] as ServerGuide).todos.map((t) => t.channelId)).toEqual([
      'general',
      'rules',
    ]);
  });

  it('a guide saved elsewhere replaces an untouched draft', () => {
    seed({ enabled: false, welcome: { title: 'Old', subtitle: null }, todos: [], resources: [] });
    renderPage();
    expect(screen.getByLabelText('Title')).toHaveValue('Old');
    useSpaces.setState((s) => ({
      byId: {
        s1: {
          ...s.byId.s1!,
          guide: {
            enabled: true,
            welcome: { title: 'New', subtitle: null },
            todos: [],
            resources: [],
          },
        },
      },
    }));
    return vi.waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('New'));
  });
});
