/**
 * Around the box: the typing line under it (who types, Space nicknames, several people, the
 * dots), the characters left in Space chats from MESSAGE_COUNTER_FROM and, over
 * SPACE_MESSAGE_MAX_LENGTH, Enter refusing with "Send as file" (message.txt, an empty
 * caption); "@silent " (the hint, the @ list's offer, `silent: true` without the prefix);
 * typed emoticons converted on send (device pref).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  MESSAGE_COUNTER_FROM,
  PERM,
  SPACE_MESSAGE_MAX_LENGTH,
  type MediaAttachment,
  type MediaKind,
  type SpaceChannelInfo,
  type SpaceMember,
} from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { useChatMembersStore } from '../members';
import { Composer } from './Composer';
import { SILENT_HINT } from './silent';

type UploadOpts = { fileName?: string };

const uploads = vi.hoisted(() => ({ uploadMedia: vi.fn() }));
vi.mock('../lib/upload', () => uploads);

function uploaded(name: string, kind: MediaKind): MediaAttachment {
  return {
    id: `m-${name}`,
    kind,
    url: `/uploads/${name}`,
    thumbnailUrl: null,
    mimeType: 'text/plain',
    fileName: name,
    size: 4,
    width: null,
    height: null,
    animated: false,
    frameCount: null,
    durationMs: null,
    waveform: null,
  };
}

const info = (): SpaceChannelInfo => ({
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
});
const BASE = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;
const channel = (perms = BASE | PERM.ATTACH_FILES) =>
  makeChat({
    id: 'c1',
    type: 'space_text',
    name: 'general',
    space: info(),
    spacePermissions: perms,
  });
const group = makeChat({ id: 'g1', type: 'group', name: 'Friends' });
const dm = makeChat({
  id: 'dm1',
  type: 'direct',
  peer: makeUser({ id: 'olive', displayName: 'Olive' }),
});

const textarea = () => screen.getByRole('textbox', { name: 'Message' });
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(textarea(), { key });
const enter = () => press('Enter');
const counter = () => screen.queryByTestId('char-counter');
const typingLine = () => screen.getByTestId('composer-typing');
/** jsdom's Blob has no `text()`. */
const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

let send: ReturnType<typeof vi.fn>;
const sent = (i = 0) => send.mock.calls[i]![1] as Record<string, unknown>;

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: { g1: [], dm1: [], c1: [] } });
  useUsers.setState({
    byId: {
      ann: makeUser({ id: 'ann', displayName: 'Ann' }),
      bob: makeUser({ id: 'bob', displayName: 'Bob' }),
    },
  });
  URL.createObjectURL = vi.fn(() => 'blob:local');
  URL.revokeObjectURL = vi.fn();
  uploads.uploadMedia.mockImplementation(
    async (_blob: Blob, meta: { kind: MediaKind }, opts: UploadOpts) =>
      uploaded(opts.fileName!, meta.kind),
  );
  send = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(useMessages.getState(), 'sendMessage').mockImplementation(send as never);
});

afterEach(() => {
  act(() => useChats.getState().clearTyping());
  vi.restoreAllMocks();
  uploads.uploadMedia.mockReset();
  resetSessionState();
  useSpaces.setState({ members: {} });
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe('the typing line under the box', () => {
  it('names who types: one, two, then several people; empty otherwise', () => {
    render(<Composer chat={group} />);
    expect(typingLine()).toBeEmptyDOMElement();
    act(() => useChats.getState().setTyping('g1', 'ann', 'typing'));
    expect(typingLine()).toHaveTextContent('Ann is typing…');
    act(() => useChats.getState().setTyping('g1', 'bob', 'typing'));
    expect(typingLine()).toHaveTextContent('Ann and Bob are typing…');
    act(() => {
      useChats.getState().setTyping('g1', 'cy', 'typing');
      useChats.getState().setTyping('g1', 'di', 'typing');
    });
    expect(typingLine()).toHaveTextContent('Several people are typing…');
    // Another chat's typing stays there.
    act(() => useChats.getState().clearTyping());
    act(() => useChats.getState().setTyping('elsewhere', 'ann', 'typing'));
    expect(typingLine()).toBeEmptyDOMElement();
  });

  it('Space nicknames, voice notes being recorded, and still dots under reduced motion', () => {
    useSpaces.setState({
      members: {
        s1: { ann: { userId: 'ann', nickname: 'Annie', roleIds: [] } as unknown as SpaceMember },
      },
    });
    render(<Composer chat={channel()} />);
    act(() => useChats.getState().setTyping('c1', 'ann', 'typing'));
    expect(typingLine()).toHaveTextContent('Annie is typing…');
    expect(typingLine().querySelectorAll('animate').length).toBeGreaterThan(0);
    act(() => useUi.getState().setPref('reduceMotion', 'on'));
    expect(typingLine().querySelectorAll('animate')).toHaveLength(0);
    act(() => useChats.getState().setTyping('c1', 'ann', 'recording'));
    expect(typingLine()).toHaveTextContent('Annie is recording audio…');
  });

  it('shows in DMs too', () => {
    render(<Composer chat={dm} />);
    act(() => useChats.getState().setTyping('dm1', 'olive', 'typing'));
    expect(typingLine()).toHaveTextContent('is typing…');
  });
});

describe('the Space message limit', () => {
  it(`counts what is left from ${MESSAGE_COUNTER_FROM}; red and negative over the limit`, () => {
    render(<Composer chat={channel()} />);
    type('a'.repeat(MESSAGE_COUNTER_FROM - 1));
    expect(counter()).toBeNull();
    type('a'.repeat(MESSAGE_COUNTER_FROM));
    expect(counter()).toHaveTextContent(String(SPACE_MESSAGE_MAX_LENGTH - MESSAGE_COUNTER_FROM));
    expect(counter()).not.toHaveClass('text-danger');
    // "@silent " is not sent, so not counted.
    type(`@silent ${'a'.repeat(MESSAGE_COUNTER_FROM)}`);
    expect(counter()).toHaveTextContent(String(SPACE_MESSAGE_MAX_LENGTH - MESSAGE_COUNTER_FROM));
    type('a'.repeat(SPACE_MESSAGE_MAX_LENGTH + 1));
    expect(counter()).toHaveTextContent('-1');
    expect(counter()).toHaveClass('text-danger');
    expect(screen.getByTestId('too-long')).toHaveTextContent(
      'Your message is too long. Send it as a file?',
    );
    enter();
    expect(send).not.toHaveBeenCalled();
    expect(textarea()).toHaveValue('a'.repeat(SPACE_MESSAGE_MAX_LENGTH + 1));
    type('a'.repeat(SPACE_MESSAGE_MAX_LENGTH));
    expect(counter()).toHaveTextContent('0');
    expect(screen.queryByTestId('too-long')).toBeNull();
    enter();
    expect(sent()).toMatchObject({ type: 'text', text: 'a'.repeat(SPACE_MESSAGE_MAX_LENGTH) });
  });

  it('"Send as file" uploads the text as message.txt with an empty caption', async () => {
    const long = `${'x'.repeat(SPACE_MESSAGE_MAX_LENGTH)} and more`;
    render(<Composer chat={channel()} />);
    type(long);
    fireEvent.click(screen.getByRole('button', { name: 'Send as file' }));
    expect(textarea()).toHaveValue('');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(uploads.uploadMedia).toHaveBeenCalledTimes(1);
    const [file, meta, opts] = uploads.uploadMedia.mock.calls[0]! as [
      File,
      { kind: string },
      UploadOpts,
    ];
    expect(opts.fileName).toBe('message.txt');
    expect(meta.kind).toBe('file');
    expect(file.type).toBe('text/plain');
    expect(await readText(file)).toBe(long);
    expect(sent()).toMatchObject({ type: 'file', mediaId: 'm-message.txt' });
    expect(sent().text).toBeUndefined();
  });

  it('without ATTACH_FILES it asks to shorten the message instead', () => {
    render(<Composer chat={channel(BASE)} />);
    type('a'.repeat(SPACE_MESSAGE_MAX_LENGTH + 5));
    expect(screen.getByTestId('too-long')).toHaveTextContent(
      'Your message is too long. Shorten it to 4,000 characters to send it.',
    );
    expect(screen.queryByRole('button', { name: 'Send as file' })).toBeNull();
  });

  it('DMs and groups keep the old limit: no counter, long messages send', () => {
    render(<Composer chat={group} />);
    type('b'.repeat(SPACE_MESSAGE_MAX_LENGTH + 100));
    expect(counter()).toBeNull();
    expect(screen.queryByTestId('too-long')).toBeNull();
    enter();
    expect(sent()).toMatchObject({ text: 'b'.repeat(SPACE_MESSAGE_MAX_LENGTH + 100) });
  });
});

describe('@silent', () => {
  it('sends without the prefix and with silent: true; the hint shows meanwhile', () => {
    render(<Composer chat={group} />);
    expect(screen.queryByRole('img', { name: SILENT_HINT })).toBeNull();
    type('@silent hello there');
    expect(screen.getByRole('img', { name: SILENT_HINT })).toBeInTheDocument();
    enter();
    expect(sent()).toMatchObject({ type: 'text', text: 'hello there', silent: true });
    expect(screen.queryByRole('img', { name: SILENT_HINT })).toBeNull();
    type('hello again');
    enter();
    expect(sent(1)).not.toHaveProperty('silent');
    // Alone it sends nothing.
    type('@silent ');
    enter();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('the @ list offers it at the start of the box, in DMs too', () => {
    render(<Composer chat={dm} />);
    type('@si');
    const list = screen.getByRole('listbox', { name: 'Mention someone' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['@silentSend without notifying anyone']);
    press('Enter');
    expect(textarea()).toHaveValue('@silent ');
    type('@silent hi');
    enter();
    expect(sent()).toMatchObject({ text: 'hi', silent: true });
    type('hey @si');
    expect(screen.queryByRole('listbox', { name: 'Mention someone' })).toBeNull();
  });
});

describe('emoticons', () => {
  it('become emoji on send unless turned off; code stays as typed', () => {
    render(<Composer chat={group} />);
    type('nice :) see `:)` <3');
    enter();
    expect(sent().text).toBe('nice 🙂 see `:)` ❤️');
    act(() => useUi.getState().setPref('emoticonConversion', false));
    type('nice :)');
    enter();
    expect(sent(1).text).toBe('nice :)');
  });
});
