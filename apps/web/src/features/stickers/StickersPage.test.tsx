/**
 * Space Settings ▸ Stickers: the cards with "N of 60 slots available", Upload Sticker (file
 * with a preview, name prefilled from it, related emoji, description → upload then create),
 * Edit (name, emoji, description) and Delete after a confirmation; the store and the
 * `space:stickers` handler keep the list current.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  SPACE_STICKER_LIMIT,
  type MediaAttachment,
  type SpaceSticker,
  type SpaceStickerGroup,
} from '@enbox/shared';
import { api } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { registerStickerHandlers } from '@/realtime/stickers';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useStickers } from '@/stores/stickers';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { StickersPage } from './StickersPage';
import { prepareStickerImage, stickerNameFromFile } from './stickerUpload';
import type * as StickerUploadModule from './stickerUpload';

vi.mock('./stickerUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof StickerUploadModule>()),
  prepareStickerImage: vi.fn(),
}));

const sticker = (id: string, name: string, p: Partial<SpaceSticker> = {}): SpaceSticker => ({
  id,
  spaceId: 's1',
  name,
  description: null,
  emoji: null,
  url: `/uploads/2026/10/${id}.png`,
  animated: false,
  createdBy: 'me',
  ...p,
});

const space = makeSpace({ owner: true });

function setup(list: SpaceSticker[]) {
  vi.spyOn(api, 'get').mockResolvedValue(list);
  const post = vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    if (path === '/api/spaces/s1/stickers') {
      const b = body as { name: string; emoji: string | null; description: string | null };
      return sticker('st-new', b.name, { emoji: b.emoji, description: b.description }) as never;
    }
    return [] as never; // profiles batch
  });
  const upload = vi.spyOn(api, 'upload').mockResolvedValue({ id: 'media-1' } as MediaAttachment);
  vi.mocked(prepareStickerImage).mockImplementation(async (file: File) => ({
    file: new Blob(['png'], { type: 'image/png' }),
    fileName: file.name,
    thumbnail: null,
    animated: false,
    width: 320,
    height: 320,
  }));
  render(<StickersPage space={space} />);
  return { post, upload };
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useStickers.setState({ groups: null, bySpace: {}, stale: false });
  useSpaces.setState({ byId: { s1: space }, order: ['s1'] });
  useUi.setState({ prefs: DEFAULT_PREFS, toasts: [], dialogs: [] });
});

describe('sticker names from files', () => {
  it('start from the file name: separators become spaces, within the length limit', () => {
    expect(stickerNameFromFile('party_parrot-2.gif')).toBe('party parrot 2');
    expect(stickerNameFromFile('x.png')).toBe('');
    expect(stickerNameFromFile(`${'long '.repeat(10)}.png`).length).toBeLessThanOrEqual(30);
  });
});

describe('StickersPage', () => {
  it('lists the stickers as cards with the free slots', async () => {
    setup([sticker('st1', 'Wave', { emoji: '👋' }), sticker('st2', 'Party', { animated: true })]);
    const wave = await screen.findByTestId('sticker-card-Wave');
    expect(within(wave).getByRole('img', { name: 'Wave' })).toBeInTheDocument();
    expect(wave).toHaveTextContent('👋');
    expect(screen.getByTestId('sticker-card-Party')).toBeInTheDocument();
    expect(screen.getByTestId('sticker-slots')).toHaveTextContent(
      `${SPACE_STICKER_LIMIT - 2} of ${SPACE_STICKER_LIMIT} slots available`,
    );
    expect(screen.getByText(/Max file size: 512 KB/)).toBeInTheDocument();
    expect(screen.getByText(/PNG, APNG, WebP or GIF/)).toBeInTheDocument();
  });

  it('uploads a sticker: file with a preview, the name from the file, emoji and description', async () => {
    const { post, upload } = setup([]);
    await screen.findByText(/No stickers yet/);
    fireEvent.click(screen.getByRole('button', { name: 'Upload Sticker' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload Sticker' });
    const submit = within(dialog).getByRole('button', { name: 'Upload' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId('sticker-file-input'), {
      target: { files: [png('happy_dance.png')] },
    });
    expect(
      await within(dialog).findByRole('img', { name: 'Preview of happy dance' }),
    ).toHaveAttribute('src', 'blob:preview');
    expect(within(dialog).getByTestId('sticker-file-name')).toHaveTextContent('happy_dance.png');
    expect(within(dialog).getByLabelText('Sticker name')).toHaveValue('happy dance');
    fireEvent.change(within(dialog).getByLabelText('Sticker name'), {
      target: { value: 'Happy Dance' },
    });
    fireEvent.change(within(dialog).getByLabelText('Related emoji'), { target: { value: '💃' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Dancing' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Upload Sticker' })).toBeNull(),
    );
    expect(upload).toHaveBeenCalledWith(
      expect.any(Blob),
      { kind: 'image', width: 320, height: 320 },
      expect.any(Function),
      { fileName: 'happy_dance.png', thumbnail: null },
    );
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/stickers', {
      name: 'Happy Dance',
      emoji: '💃',
      description: 'Dancing',
      mediaId: 'media-1',
    });
    expect(await screen.findByTestId('sticker-card-Happy Dance')).toBeInTheDocument();
    expect(screen.getByTestId('sticker-slots')).toHaveTextContent(`${SPACE_STICKER_LIMIT - 1} of`);
  });

  it('a file that can’t be a sticker is explained and keeps Upload off; names need 2 characters', async () => {
    setup([]);
    await screen.findByText(/No stickers yet/);
    vi.mocked(prepareStickerImage).mockRejectedValueOnce(
      new Error('Use a PNG, APNG, WebP or GIF image.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Upload Sticker' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload Sticker' });
    fireEvent.change(within(dialog).getByTestId('sticker-file-input'), {
      target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Use a PNG, APNG, WebP or GIF image.',
    );
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId('sticker-file-input'), {
      target: { files: [png('ok.png')] },
    });
    fireEvent.change(within(dialog).getByLabelText('Sticker name'), { target: { value: 'x' } });
    await within(dialog).findByRole('img', { name: 'Preview of x' });
    expect(within(dialog).getByText('Use at least 2 characters')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('edits a sticker’s name, emoji and description', async () => {
    setup([sticker('st1', 'Wave', { emoji: '👋', description: 'Hello' })]);
    const patch = vi
      .spyOn(api, 'patch')
      .mockImplementation(
        async (_p: string, body?: unknown) =>
          sticker('st1', '', body as Partial<SpaceSticker>) as never,
      );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Wave' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Sticker' });
    expect(within(dialog).queryByTestId('sticker-file-input')).toBeNull();
    expect(within(dialog).getByLabelText('Related emoji')).toHaveValue('👋');
    fireEvent.change(within(dialog).getByLabelText('Sticker name'), {
      target: { value: 'Big Wave' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Sticker' })).toBeNull());
    expect(patch).toHaveBeenCalledWith('/api/spaces/s1/stickers/st1', {
      name: 'Big Wave',
      emoji: '👋',
      description: null,
    });
    expect(await screen.findByTestId('sticker-card-Big Wave')).toBeInTheDocument();
  });

  it('deletes a sticker after a confirmation', async () => {
    setup([sticker('st1', 'Wave'), sticker('st2', 'Party')]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Party' }));
    await waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Delete Sticker');
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(screen.queryByTestId('sticker-card-Party')).toBeNull());
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/stickers/st2');
    expect(screen.getByTestId('sticker-card-Wave')).toBeInTheDocument();
  });

  it('stays live: space:stickers replaces the list, leaving the Space drops its group', async () => {
    setup([sticker('st1', 'Wave')]);
    await screen.findByTestId('sticker-card-Wave');
    const handlers = new Map<string, (p: never) => void>();
    registerStickerHandlers({
      on: (e: string, fn: (p: never) => void) => handlers.set(e, fn),
    } as unknown as AppSocket);
    const groups: SpaceStickerGroup[] = [
      { spaceId: 's1', spaceName: 'Space', iconUrl: null, stickers: [sticker('st1', 'Wave')] },
    ];
    useStickers.setState({ groups });
    act(() =>
      handlers.get('space:stickers')!({
        spaceId: 's1',
        stickers: [sticker('st1', 'Wave'), sticker('st3', 'Nod')],
      } as never),
    );
    expect(await screen.findByTestId('sticker-card-Nod')).toBeInTheDocument();
    expect(useStickers.getState().groups![0]!.stickers.map((s) => s.name)).toEqual(['Wave', 'Nod']);
    act(() => handlers.get('space:removed')!({ spaceId: 's1' } as never));
    expect(useStickers.getState().groups).toEqual([]);
    expect(useStickers.getState().bySpace.s1).toBeUndefined();
  });
});
