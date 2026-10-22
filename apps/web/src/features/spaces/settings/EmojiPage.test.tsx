/** Space Settings → Emoji: tables by kind with the slots left, upload (picker and drop) named after the file, inline rename, delete. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SPACE_EMOJI_LIMIT, type MediaAttachment, type SpaceEmoji } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useEmojis } from '@/stores/emojis';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { makeSpace } from '../testUtils';
import { EmojiPage } from './EmojiPage';
import { emojiNameFromFile, prepareEmojiImage, uniqueEmojiName } from './emojiImage';
import type * as EmojiImageModule from './emojiImage';

vi.mock('./emojiImage', async (importOriginal) => ({
  ...(await importOriginal<typeof EmojiImageModule>()),
  prepareEmojiImage: vi.fn(),
}));

const emoji = (id: string, name: string, animated = false): SpaceEmoji => ({
  id,
  spaceId: 's1',
  name,
  url: `/uploads/${id}.${animated ? 'gif' : 'png'}`,
  animated,
  createdBy: 'me',
});

const space = makeSpace({ owner: true });
const media = { id: 'm1' } as MediaAttachment;

function setup(list: SpaceEmoji[]) {
  vi.spyOn(api, 'get').mockResolvedValue(list);
  const post = vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    if (path === '/api/spaces/s1/emojis') {
      const b = body as { name: string; mediaId: string };
      return emoji(`new-${b.name}`, b.name) as never;
    }
    return [] as never; // profiles batch
  });
  const upload = vi.spyOn(api, 'upload').mockResolvedValue(media);
  vi.mocked(prepareEmojiImage).mockImplementation(async (file: File) => ({
    file: new Blob(['png'], { type: 'image/png' }),
    fileName: `${emojiNameFromFile(file.name)}.png`,
    thumbnail: null,
    animated: false,
    width: 128,
    height: 128,
  }));
  render(<EmojiPage space={space} />);
  return { post, upload };
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useEmojis.setState({ groups: null, bySpace: {}, byId: {}, stale: false });
  useUi.setState({ toasts: [] });
});

describe('emoji names from files', () => {
  it('sanitise to [A-Za-z0-9_] within 2-32 characters and avoid taken names', () => {
    expect(emojiNameFromFile('Party Parrot!.gif')).toBe('Party_Parrot');
    expect(emojiNameFromFile('café-time.png')).toBe('cafe_time');
    expect(emojiNameFromFile('🙂.png')).toBe('emoji');
    expect(emojiNameFromFile('a.png')).toBe('a_');
    expect(emojiNameFromFile(`${'x'.repeat(40)}.png`)).toHaveLength(32);
    expect(uniqueEmojiName('blob', ['BLOB', 'blob_2'])).toBe('blob_3');
    expect(uniqueEmojiName('fresh', ['blob'])).toBe('fresh');
  });
});

describe('EmojiPage', () => {
  it('lists emoji and animated emoji apart, with the slots left', async () => {
    setup([emoji('e1', 'blob'), emoji('e2', 'party', true)]);
    expect(await screen.findByTestId('emoji-row-blob')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Emoji' })).toHaveTextContent('blob');
    expect(screen.getByRole('table', { name: 'Animated Emoji' })).toHaveTextContent('party');
    expect(screen.getByTestId('emoji-slots')).toHaveTextContent(`${SPACE_EMOJI_LIMIT - 2} slots available`);
    expect(screen.getByText(/Max file size: 512 KB/)).toBeInTheDocument();
  });

  it('uploads chosen files named after the file, unique in the Space', async () => {
    const { post, upload } = setup([emoji('e1', 'blob')]);
    await screen.findByTestId('emoji-row-blob');
    fireEvent.change(screen.getByTestId('emoji-file-input'), {
      target: { files: [png('Party Parrot!.png'), png('blob.png')] },
    });
    await waitFor(() => expect(screen.getByTestId('emoji-row-blob_2')).toBeInTheDocument());
    expect(upload).toHaveBeenCalledWith(
      expect.any(Blob),
      { kind: 'image', width: 128, height: 128 },
      undefined,
      { fileName: 'Party_Parrot.png', thumbnail: null },
    );
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/emojis', { name: 'Party_Parrot', mediaId: 'm1' });
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/emojis', { name: 'blob_2', mediaId: 'm1' });
    expect(screen.getByTestId('emoji-row-Party_Parrot')).toBeInTheDocument();
    expect(screen.getByTestId('emoji-slots')).toHaveTextContent(`${SPACE_EMOJI_LIMIT - 3} slots available`);
  });

  it('accepts image files dropped anywhere on the page', async () => {
    const { post } = setup([]);
    const page = await screen.findByTestId('emoji-page');
    fireEvent.dragEnter(page, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByText('Drop images to add them as emoji')).toBeInTheDocument();
    fireEvent.drop(page, { dataTransfer: { types: ['Files'], files: [png('wave.png')] } });
    expect(screen.queryByText('Drop images to add them as emoji')).toBeNull();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/spaces/s1/emojis', { name: 'wave', mediaId: 'm1' }));
    expect(await screen.findByTestId('emoji-row-wave')).toBeInTheDocument();
  });

  it('a failed file is reported and the rest go on', async () => {
    const { post } = setup([]);
    await screen.findByText(/No emoji yet/);
    vi.mocked(prepareEmojiImage).mockRejectedValueOnce(new Error('Use a PNG, JPEG, WebP or GIF image.'));
    fireEvent.change(screen.getByTestId('emoji-file-input'), { target: { files: [png('bad.png'), png('good.png')] } });
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/spaces/s1/emojis', { name: 'good', mediaId: 'm1' }));
    expect(useUi.getState().toasts.map((t) => t.message)).toContain('bad.png: Use a PNG, JPEG, WebP or GIF image.');
    expect(post).not.toHaveBeenCalledWith('/api/spaces/s1/emojis', expect.objectContaining({ name: 'bad' }));
  });

  it('renames in place: Enter saves (typed spaces become _), Escape cancels, bad names are refused', async () => {
    setup([emoji('e1', 'blob')]);
    const patch = vi.spyOn(api, 'patch').mockImplementation(async (_p: string, body?: unknown) => emoji('e1', (body as { name: string }).name) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'blob' }));
    fireEvent.change(screen.getByLabelText('Rename :blob:'), { target: { value: 'blob by!' } });
    fireEvent.keyDown(screen.getByLabelText('Rename :blob:'), { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/spaces/s1/emojis/e1', { name: 'blob_by' }));
    expect(await screen.findByRole('button', { name: 'blob_by' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'blob_by' }));
    fireEvent.change(screen.getByLabelText('Rename :blob_by:'), { target: { value: 'other' } });
    fireEvent.keyDown(screen.getByLabelText('Rename :blob_by:'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'blob_by' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'blob_by' }));
    fireEvent.change(screen.getByLabelText('Rename :blob_by:'), { target: { value: 'x' } });
    fireEvent.blur(screen.getByLabelText('Rename :blob_by:'));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(useUi.getState().toasts.at(-1)?.message).toMatch(/2-32 letters/);
  });

  it('deletes an emoji', async () => {
    setup([emoji('e1', 'blob'), emoji('e2', 'party', true)]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete :party:' }));
    await waitFor(() => expect(screen.queryByTestId('emoji-row-party')).toBeNull());
    expect(del).toHaveBeenCalledWith('/api/spaces/s1/emojis/e2');
    expect(screen.queryByRole('table', { name: 'Animated Emoji' })).toBeNull();
    expect(screen.getByTestId('emoji-row-blob')).toBeInTheDocument();
  });

  it('a full Space cannot upload more', async () => {
    setup(Array.from({ length: SPACE_EMOJI_LIMIT }, (_, i) => emoji(`e${i}`, `e_${i}`)));
    expect(await screen.findByTestId('emoji-slots')).toHaveTextContent('0 slots available');
    await screen.findByTestId('emoji-row-e_0');
    expect(screen.getByRole('button', { name: 'Upload Emoji' })).toBeDisabled();
  });
});
