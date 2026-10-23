/**
 * Space Settings → Soundboard: the slots count; a picked file is refused before any upload
 * when it is not MP3/OGG/WAV, too big, or too long (its duration measured from the audio
 * metadata); a good one is named, given a volume and uploaded; names need 2-32 characters;
 * editing a row sends the form's fields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_SOUND_BYTES, SPACE_SOUND_LIMIT, type SpaceSound } from '@enbox/shared';
import type * as MediaModule from '@/lib/media';
import { api } from '@/lib/api';
import { useSoundboard } from '@/stores/soundboard';
import { makeSpace } from '@/features/spaces/testUtils';

const media = vi.hoisted(() => ({ readAudioDuration: vi.fn(async () => 1_200) }));
vi.mock('@/lib/media', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaModule>()),
  readAudioDuration: media.readAudioDuration,
  createObjectUrl: () => 'blob:sound',
  revokeObjectUrl: () => undefined,
}));

const { SoundboardPage } = await import('./SoundboardPage');
const { checkSoundFile, soundNameFromFile } = await import('./soundFile');

const file = (name: string, type: string, size = 2_000) => new File([new Uint8Array(size)], name, { type });
const horn: SpaceSound = {
  id: 'h1',
  spaceId: 's1',
  name: 'Air horn',
  emoji: '📯',
  volume: 0.5,
  url: '/uploads/horn.mp3',
  createdBy: null,
};

function renderPage(list: SpaceSound[] = []) {
  vi.spyOn(api, 'get').mockResolvedValue(list as never);
  render(<SoundboardPage space={makeSpace({ id: 's1' })} />);
}

const pick = (f: File) => fireEvent.change(screen.getByTestId('sound-file-input'), { target: { files: [f] } });

describe('SoundboardPage', () => {
  beforeEach(() => {
    useSoundboard.setState({ bySpace: {}, fresh: {}, volume: 1 });
    media.readAudioDuration.mockReset().mockResolvedValue(1_200);
  });
  afterEach(() => vi.restoreAllMocks());

  it('checks files before uploading: type, size and length', async () => {
    expect(await checkSoundFile(file('a.mp3', 'audio/mpeg'))).toEqual({ ok: true, durationMs: 1_200 });
    expect(await checkSoundFile(file('a.WAV', ''))).toMatchObject({ ok: true });
    expect(await checkSoundFile(file('a.m4a', 'audio/mp4'))).toMatchObject({ ok: false, error: /MP3, OGG or WAV/ });
    expect(await checkSoundFile(file('a.mp3', 'audio/mpeg', MAX_SOUND_BYTES + 1))).toMatchObject({ ok: false, error: /512 KB/ });
    media.readAudioDuration.mockResolvedValueOnce(5_201);
    expect(await checkSoundFile(file('a.ogg', 'audio/ogg'))).toMatchObject({ ok: false, error: /5.2 seconds/ });
    media.readAudioDuration.mockRejectedValueOnce(new Error('bad'));
    expect(await checkSoundFile(file('a.ogg', 'audio/ogg'))).toMatchObject({ ok: false, error: /can’t be played/ });
    expect(soundNameFromFile('laser_beam-01.mp3')).toBe('laser beam 01');
    expect(soundNameFromFile('x.mp3')).toBe('New sound');
    expect(soundNameFromFile(`${'y'.repeat(40)}.wav`)).toHaveLength(32);
  });

  it('shows the slots; refuses a long or big file with a message and no upload', async () => {
    renderPage();
    expect(await screen.findByTestId('sound-slots')).toHaveTextContent(`0 of ${SPACE_SOUND_LIMIT} slots used`);
    const upload = vi.spyOn(api, 'upload');
    media.readAudioDuration.mockResolvedValueOnce(6_000);
    pick(file('long.mp3', 'audio/mpeg'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sounds can be at most 5.2 seconds long.');
    pick(file('big.wav', 'audio/wav', MAX_SOUND_BYTES + 10));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sounds can be at most 512 KB.'));
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a good file: named from the file, a volume, then uploaded and added', async () => {
    renderPage();
    await screen.findByTestId('sound-slots');
    const upload = vi.spyOn(api, 'upload').mockResolvedValue({ id: 'm1' } as never);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...horn, id: 'n1', name: 'laser beam', emoji: null, volume: 0.25 } as never);
    const f = file('laser_beam.mp3', 'audio/mpeg');
    pick(f);
    const name = await screen.findByTestId('sound-name');
    expect(name).toHaveValue('laser beam');
    // Names need 2-32 characters.
    fireEvent.change(name, { target: { value: ' a ' } });
    fireEvent.click(screen.getByTestId('sound-save'));
    expect(await screen.findByText('Names need 2 to 32 characters.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'laser beam' } });
    fireEvent.change(screen.getByLabelText(/^Volume/), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('sound-save'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith(f, { kind: 'audio', durationMs: 1_200 });
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/sounds', { name: 'laser beam', emoji: null, volume: 0.25, mediaId: 'm1' });
    expect(await screen.findByTestId('sound-row-laser beam')).toBeInTheDocument();
    expect(screen.getByTestId('sound-slots')).toHaveTextContent(`1 of ${SPACE_SOUND_LIMIT} slots used`);
  });

  it('rows: edit sends the form’s fields', async () => {
    renderPage([horn]);
    expect(await screen.findByTestId('sound-row-Air horn')).toHaveTextContent('Volume 50%');
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ...horn, name: 'Horn' } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Air horn' }));
    fireEvent.change(await screen.findByTestId('sound-name'), { target: { value: 'Horn' } });
    fireEvent.click(screen.getByTestId('sound-save'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/spaces/s1/sounds/h1', { name: 'Horn', emoji: '📯', volume: 0.5 }),
    );
    expect(await screen.findByTestId('sound-row-Horn')).toBeInTheDocument();
  });
});
