/**
 * The soundboard picker and its button: my voice channel's Space first, then my other Spaces;
 * a tile plays the sound for the channel (the API), its speaker previews it here only; search;
 * the button is disabled with the reason while muted, deafened or in a Stage audience.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SpaceSound, VoiceState } from '@enbox/shared';
import { api, mediaUrl } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSoundboard } from '@/stores/soundboard';
import { useSpaces } from '@/stores/spaces';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { makeMe } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { SoundboardButton, soundboardBlocked } from './SoundboardButton';
import { SoundboardPicker, pickerSpaces } from './SoundboardPicker';

class FakeAudio {
  static made: FakeAudio[] = [];
  volume = 1;
  play = vi.fn(() => Promise.resolve());
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
}

const sound = (id: string, spaceId: string, name: string, emoji: string | null = null): SpaceSound => ({
  id,
  spaceId,
  name,
  emoji,
  volume: 1,
  url: `/uploads/${id}.mp3`,
  createdBy: 'owner',
});
const horn = sound('h', 's1', 'Air horn', '📯');
const boing = sound('b', 's2', 'Boing');
const drum = sound('d', 's2', 'Drum roll', '🥁');

const me: VoiceState = {
  userId: 'me',
  spaceId: 's1',
  channelId: 'v1',
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  suppressed: false,
  requestToSpeakAt: null,
  joinedAt: '2026-10-23T10:00:00.000Z',
};

describe('soundboard picker', () => {
  beforeEach(() => {
    FakeAudio.made = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useSpaces.setState({
      byId: { s1: makeSpace({ id: 's1', name: 'Alpha' }), s2: makeSpace({ id: 's2', name: 'Beta' }) },
      // Beta is listed first: the voice channel's Space still comes first in the picker.
      order: ['s2', 's1'],
    });
    useSoundboard.setState({ bySpace: {}, fresh: {}, volume: 1 });
    useVoice.setState({ connection: { spaceId: 's1', channelId: 'v1', status: 'connected' }, byUser: { me } });
    useVoiceSelf.setState({ muted: false, deafened: false });
    vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
      path === '/api/spaces/s1/sounds' ? [horn] : path === '/api/spaces/s2/sounds' ? [boing, drum] : []) as never);
  });
  afterEach(() => {
    useVoice.setState({ connection: null, byUser: {} });
    useSpaces.setState({ byId: {}, order: [] });
  });

  it('orders my voice channel’s Space first', () => {
    const spaces = [makeSpace({ id: 'a', name: 'A' }), makeSpace({ id: 'b', name: 'B' }), makeSpace({ id: 'c', name: 'C' })];
    expect(pickerSpaces(spaces, 'b').map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(pickerSpaces(spaces, null).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('lists the Spaces’ sounds; a tile plays for the channel, the speaker previews it here', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    render(<SoundboardPicker anchor={document.body} spaceId="s1" onClose={() => undefined} />);
    const picker = await screen.findByTestId('soundboard-picker');
    await waitFor(() => expect(within(picker).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Alpha', 'Beta']));
    expect(api.get).toHaveBeenCalledWith('/api/spaces/s1/sounds');
    expect(api.get).toHaveBeenCalledWith('/api/spaces/s2/sounds');

    fireEvent.click(screen.getByRole('button', { name: 'Play Boing' }));
    expect(post).toHaveBeenCalledWith('/api/spaces/s2/sounds/b/play');
    expect(FakeAudio.made).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Air horn' }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(FakeAudio.made.map((a) => a.src)).toEqual([mediaUrl(horn.url)]);
    expect(FakeAudio.made[0]!.play).toHaveBeenCalled();
  });

  it('search filters by name', async () => {
    render(<SoundboardPicker anchor={document.body} spaceId="s1" onClose={() => undefined} />);
    await screen.findByRole('button', { name: 'Play Drum roll' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sounds' }), { target: { value: 'dRu' } });
    expect(screen.getByRole('button', { name: 'Play Drum roll' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play Air horn' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Alpha' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sounds' }), { target: { value: 'nothing like it' } });
    expect(screen.getByText('No sounds match your search.')).toBeInTheDocument();
  });

  it('the button opens the picker; it is disabled with the reason while muted, deafened or in the audience', async () => {
    expect(soundboardBlocked({ muted: false, deafened: false })).toBeNull();
    expect(soundboardBlocked({ muted: true, deafened: false })).toMatch(/unmute/i);
    expect(soundboardBlocked({ muted: true, deafened: true })).toMatch(/undeafen/i);
    expect(soundboardBlocked({ muted: false, deafened: false, suppressed: true })).toMatch(/speaker/i);
    expect(soundboardBlocked({ muted: false, deafened: false, serverMute: true })).toMatch(/moderator/i);

    render(<SoundboardButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Soundboard' }));
    expect(await screen.findByTestId('soundboard-picker')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Soundboard' }));
    await waitFor(() => expect(screen.queryByTestId('soundboard-picker')).toBeNull());

    useVoiceSelf.setState({ muted: true });
    const muted = await screen.findByRole('button', { name: /^Soundboard: Unmute/ });
    expect(muted).toBeDisabled();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Unmute to use the soundboard');

    useVoiceSelf.setState({ muted: false });
    useVoice.setState({ byUser: { me: { ...me, suppressed: true } } });
    expect(await screen.findByRole('button', { name: /^Soundboard: Become a speaker/ })).toBeDisabled();
  });
});
