/**
 * Space templates on the web: the Add Space flow (Create My Own or a starter, "Tell us more",
 * icon and name, then the new Space's first text channel; Join a Space), Space Settings ▸
 * Space Template (generate, copy the link, sync when dirty, delete) and /template/:code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import {
  STARTER_TEMPLATES,
  starterTemplate,
  type ChatSummary,
  type SpaceChannelInfo,
  type SpaceDetail,
  type SpaceTemplate,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { AddSpaceModal } from './AddSpaceModal';
import { TemplatePage } from './TemplatePage';
import { TemplatePreviewPage } from './TemplatePreviewPage';

const info = (p: Partial<SpaceChannelInfo> = {}): SpaceChannelInfo => ({
  spaceId: 's9',
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
  ...p,
});

/** A new Space whose sidebar starts with #welcome (the Information category comes first). */
function newSpace(): SpaceDetail {
  const space = makeSpace({
    id: 's9',
    owner: true,
    categories: [
      { id: 'info', name: 'Information', position: 0, overwrites: [] },
      { id: 'text', name: 'Text Channels', position: 1, overwrites: [] },
    ],
  });
  const ch = (id: string, name: string, p: Partial<SpaceChannelInfo>, type = 'space_text') =>
    makeChat({ id, name, type: type as ChatSummary['type'], space: info(p) });
  return {
    space,
    channels: [
      ch('general', 'general', { categoryId: 'text', position: 0 }),
      ch('lounge', 'Lounge', { categoryId: 'info', position: 0 }, 'space_voice'),
      ch('welcome', 'welcome-and-rules', { categoryId: 'info', position: 1 }),
    ],
  };
}

function Where() {
  return <p data-testid="where">channel</p>;
}

function renderFlow() {
  const onClose = vi.fn();
  const onJoin = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AddSpaceModal onClose={onClose} onJoin={onJoin} />} />
        <Route path="/spaces/:spaceId/:chatId" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose, onJoin };
}

const template = (p: Partial<SpaceTemplate> = {}): SpaceTemplate => ({
  code: 'AbCdEfGhJkLm',
  name: 'Guild kit',
  description: 'Roles and channels',
  sourceSpaceId: 's1',
  creatorId: 'me',
  usageCount: 3,
  createdAt: '2026-10-23T00:00:00.000Z',
  updatedAt: '2026-10-23T00:00:00.000Z',
  isDirty: false,
  snapshot: starterTemplate('school-club')!.snapshot,
  ...p,
});

beforeEach(() => {
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Ada' }),
    token: 't',
    status: 'authenticated',
  });
  useUi.setState({ toasts: [], dialogs: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Add Space', () => {
  it('starts with Create My Own, the starters and Join a Space', () => {
    const { onJoin } = renderFlow();
    expect(screen.getByRole('dialog', { name: 'Create Your Space' })).toBeInTheDocument();
    expect(screen.getByTestId('add-space-own')).toHaveTextContent('Create My Own');
    for (const s of STARTER_TEMPLATES)
      expect(screen.getByTestId(`add-space-starter-${s.id}`)).toHaveTextContent(s.name);
    fireEvent.click(screen.getByTestId('add-space-join'));
    expect(onJoin).toHaveBeenCalled();
  });

  it('a starter, then Tell us more, then the icon and name; Create opens the first text channel', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(newSpace() as never);
    const { onClose } = renderFlow();
    fireEvent.click(screen.getByTestId('add-space-starter-school-club'));
    expect(
      screen.getByRole('dialog', { name: 'Tell us more about your Space' }),
    ).toBeInTheDocument();
    // Back and forth keeps the choice.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByTestId('add-space-starter-school-club'));
    fireEvent.click(screen.getByRole('button', { name: /For a club or community/ }));
    expect(screen.getByRole('dialog', { name: 'Customize your Space' })).toBeInTheDocument();
    expect(screen.getByLabelText('Space name')).toHaveValue('Ada’s Space');
    expect(screen.getByRole('button', { name: 'Upload a Space icon' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/spaces', {
        name: 'Ada’s Space',
        template: 'school-club',
      }),
    );
    expect(await screen.findByTestId('where')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('Create My Own sends no template; the question can be skipped; the name is mine', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(newSpace() as never);
    renderFlow();
    fireEvent.click(screen.getByTestId('add-space-own'));
    fireEvent.click(screen.getByRole('button', { name: /skip this question/ }));
    const input = screen.getByLabelText('Space name');
    fireEvent.change(input, { target: { value: ' ' } });
    expect(screen.getByTestId('create-space-submit')).toBeDisabled();
    fireEvent.change(input, { target: { value: '  Rocket Club ' } });
    fireEvent.click(screen.getByTestId('create-space-submit'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/spaces', { name: 'Rocket Club' }));
    expect(await screen.findByTestId('where')).toBeInTheDocument();
  });
});

describe('Space Template settings', () => {
  const space = makeSpace({ owner: true, name: 'Guild' });
  const renderPage = () =>
    render(
      <MemoryRouter>
        <TemplatePage space={space} />
      </MemoryRouter>,
    );

  it('generates a template, then copies its link', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue(template() as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    const generate = await screen.findByTestId('template-generate');
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByTestId('template-name'), { target: { value: ' Guild kit ' } });
    fireEvent.click(generate);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/spaces/s1/templates', {
        name: 'Guild kit',
        description: null,
      }),
    );
    const link = `${location.origin}/template/AbCdEfGhJkLm`;
    expect(await screen.findByDisplayValue(link)).toBeInTheDocument();
    expect(screen.getByTestId('template-structure')).toHaveTextContent('announcements');
    // In sync: nothing to sync yet.
    expect(screen.getByTestId('template-sync')).toBeDisabled();
    fireEvent.click(screen.getByTestId('template-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
  });

  it('syncs a dirty template and deletes it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([template({ isDirty: true })] as never);
    const put = vi.spyOn(api, 'put').mockResolvedValue(template({ isDirty: false }) as never);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    renderPage();
    expect(await screen.findByText(/unsynced changes/)).toBeInTheDocument();
    const sync = screen.getByTestId('template-sync');
    expect(sync).toBeEnabled();
    fireEvent.click(sync);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/spaces/s1/templates/AbCdEfGhJkLm'));
    await waitFor(() => expect(screen.getByTestId('template-sync')).toBeDisabled());

    fireEvent.click(screen.getByTestId('template-delete'));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    act(() => useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/spaces/s1/templates/AbCdEfGhJkLm'));
    expect(await screen.findByTestId('template-generate')).toBeInTheDocument();
  });
});

describe('/template/:code', () => {
  it('shows the template and creates a Space from it', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(template() as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue(newSpace() as never);
    render(
      <MemoryRouter initialEntries={['/template/AbCdEfGhJkLm']}>
        <Routes>
          <Route path="/template/:code" element={<TemplatePreviewPage />} />
          <Route path="/spaces/:spaceId/:chatId" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const preview = await screen.findByTestId('template-preview');
    expect(get).toHaveBeenCalledWith('/api/templates/AbCdEfGhJkLm');
    expect(preview).toHaveTextContent('Guild kit');
    expect(preview).toHaveTextContent('Used 3 times');
    expect(screen.getByLabelText('Space name')).toHaveValue('Guild kit');
    fireEvent.click(screen.getByTestId('template-create-space'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/spaces', {
        name: 'Guild kit',
        template: 'AbCdEfGhJkLm',
      }),
    );
    expect(await screen.findByTestId('where')).toBeInTheDocument();
  });

  it('an unknown code says the link is not valid', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('not_found', 'Template not found', 404));
    render(
      <MemoryRouter initialEntries={['/template/nope']}>
        <Routes>
          <Route path="/template/:code" element={<TemplatePreviewPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("This template link isn't valid")).toBeInTheDocument();
  });
});
