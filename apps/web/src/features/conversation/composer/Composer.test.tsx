/**
 * Attachment tray: files dropped anywhere over the conversation (or pasted, or picked) wait
 * in the composer and go with the next send; Shift-drop uploads at once; spoilers are sent
 * with the SPOILER_ name prefix; at most 10 files at a time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type SpaceChannelInfo } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { DEFAULT_PREFS, toast, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { ConversationDropzone } from '../dropzone/ConversationDropzone';
import { NO_UPLOAD_PERMISSION } from '../dropzone/files';
import { useChatMembersStore } from '../members';
import { Composer } from './Composer';

const media = vi.hoisted(() => ({
  enqueueMedia: vi.fn(),
  sendMedia: vi.fn(),
  cancelUpload: vi.fn(),
  retryMediaSend: vi.fn(),
}));
const processing = vi.hoisted(() => ({ prepareVisualMedia: vi.fn() }));
vi.mock('../lib/sendMedia', () => media);
vi.mock('../lib/mediaProcessing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareVisualMedia: processing.prepareVisualMedia,
}));

const chat = makeChat({ id: 'dm-1', type: 'direct', peer: makeUser({ displayName: 'Maya' }) });

const png = (name: string) => new File(['png'], name, { type: 'image/png' });
const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });

function drag(type: string, files: File[] = [], shiftKey = false) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, shiftKey });
  Object.defineProperty(e, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  });
  act(() => {
    document.body.dispatchEvent(e);
  });
}

function drop(files: File[], shiftKey = false) {
  drag('dragenter');
  drag('drop', files, shiftKey);
}

function addFiles(files: File[], target = chat) {
  act(() => bus.emit('composer:files', { chatId: target.id, files, direct: false }));
}

function renderPane(c = chat) {
  return render(
    <>
      <ConversationDropzone chat={c} />
      <Composer chat={c} />
    </>,
  );
}

const tiles = () => screen.queryAllByTestId('attachment-tile');
const textarea = () => screen.getByRole('textbox', { name: 'Message' });

let urls = 0;

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: { [chat.id]: [] } });
  URL.createObjectURL = vi.fn(() => `blob:local-${++urls}`);
  URL.revokeObjectURL = vi.fn();
  media.enqueueMedia.mockImplementation(() => () => Promise.resolve());
  processing.prepareVisualMedia.mockImplementation(async (file: File) => ({
    kind: 'image',
    blob: file,
    fileName: file.name,
    mimeType: file.type,
    thumbnail: null,
  }));
  vi.spyOn(useMessages.getState(), 'sendMessage').mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup(); // unmounting revokes the previews: before the stubs go
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  media.enqueueMedia.mockReset();
  processing.prepareVisualMedia.mockReset();
});

describe('Composer attachment tray', () => {
  it('adds dropped files to the tray as tiles', () => {
    renderPane();
    drop([png('cat.png'), pdf('notes.pdf')]);
    expect(screen.queryByTestId('drop-overlay')).toBeNull();
    expect(tiles()).toHaveLength(2);
    const [photo, doc] = tiles();
    expect(within(photo!).getByText('cat.png')).toBeInTheDocument();
    expect(photo!.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:local-/),
    );
    expect(within(doc!).getByText('notes.pdf')).toBeInTheDocument();
    expect(within(doc!).getByText('4 B')).toBeInTheDocument();
    expect(media.enqueueMedia).not.toHaveBeenCalled();
  });

  it('uploads straight away on a Shift-drop and keeps the typed text', async () => {
    renderPane();
    fireEvent.change(textarea(), { target: { value: 'draft' } });
    drop([png('a.png'), pdf('b.pdf')], true);
    expect(tiles()).toHaveLength(0);
    await vi.waitFor(() => expect(media.enqueueMedia).toHaveBeenCalledTimes(2));
    expect(media.enqueueMedia.mock.calls[0]![1]).toMatchObject({
      kind: 'image',
      fileName: 'a.png',
    });
    expect(media.enqueueMedia.mock.calls[0]![1].caption).toBeUndefined();
    expect(media.enqueueMedia.mock.calls[1]![1]).toMatchObject({
      kind: 'file',
      fileName: 'b.pdf',
      mimeType: 'application/pdf',
    });
    expect(textarea()).toHaveValue('draft');
  });

  it('sends the text as the first file’s caption and the rest as their own messages', async () => {
    renderPane();
    addFiles([png('one.png'), pdf('two.pdf'), png('three.png')]);
    fireEvent.change(textarea(), { target: { value: 'look' } });
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(tiles()).toHaveLength(0);
    expect(textarea()).toHaveValue('');
    await vi.waitFor(() => expect(media.enqueueMedia).toHaveBeenCalledTimes(3));
    const sent = media.enqueueMedia.mock.calls.map((c) => c[1]);
    expect(sent.map((s) => s.fileName)).toEqual(['one.png', 'two.pdf', 'three.png']);
    expect(sent.map((s) => s.caption)).toEqual(['look', undefined, undefined]);
    expect(useMessages.getState().sendMessage).not.toHaveBeenCalled();
  });

  it('sends the files with Enter even without text', async () => {
    renderPane();
    addFiles([pdf('only.pdf')]);
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    await vi.waitFor(() => expect(media.enqueueMedia).toHaveBeenCalledTimes(1));
    expect(media.enqueueMedia.mock.calls[0]![1].caption).toBeUndefined();
  });

  it('adds pasted files to the tray', () => {
    renderPane();
    fireEvent.paste(textarea(), { clipboardData: { files: [png('image.png')] } });
    expect(tiles()).toHaveLength(1);
    expect(screen.getByText('image.png')).toBeInTheDocument();
  });

  it('removes a tile and frees its preview', () => {
    renderPane();
    addFiles([png('keep.png'), png('drop.png')]);
    const url = tiles()[1]!.querySelector('img')!.getAttribute('src');
    fireEvent.click(screen.getByRole('button', { name: 'Remove drop.png' }));
    expect(tiles()).toHaveLength(1);
    expect(screen.queryByText('drop.png')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('marks a spoiler and uploads it with the SPOILER_ prefix', async () => {
    renderPane();
    addFiles([png('plot.png'), pdf('doc.pdf')]);
    // Only photos and videos can be spoilers.
    expect(screen.queryByRole('button', { name: 'Mark doc.pdf as spoiler' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark plot.png as spoiler' }));
    const [tile] = tiles();
    expect(tile).toHaveAttribute('data-spoiler', 'true');
    expect(within(tile!).getByText('SPOILER')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove spoiler from plot.png' }));
    expect(tiles()[0]).not.toHaveAttribute('data-spoiler');
    fireEvent.click(screen.getByRole('button', { name: 'Mark plot.png as spoiler' }));
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    await vi.waitFor(() => expect(media.enqueueMedia).toHaveBeenCalledTimes(2));
    const uploaded = processing.prepareVisualMedia.mock.calls[0]![0] as File;
    expect(uploaded.name).toBe('SPOILER_plot.png');
    expect(media.enqueueMedia.mock.calls[0]![1].fileName).toBe('SPOILER_plot.png');
    expect(media.enqueueMedia.mock.calls[1]![1].fileName).toBe('doc.pdf');
  });

  it('renames a file from the edit dialog', async () => {
    renderPane();
    addFiles([pdf('scan.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit scan.pdf' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit attachment' });
    fireEvent.change(within(dialog).getByLabelText('File name'), {
      target: { value: 'invoice.pdf' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    fireEvent.keyDown(textarea(), { key: 'Enter' });
    await vi.waitFor(() => expect(media.enqueueMedia).toHaveBeenCalledTimes(1));
    expect(media.enqueueMedia.mock.calls[0]![1].fileName).toBe('invoice.pdf');
  });

  it('takes at most 10 files at a time', () => {
    const error = vi.spyOn(toast, 'error');
    renderPane();
    addFiles(Array.from({ length: 8 }, (_, i) => pdf(`f${i}.pdf`)));
    expect(tiles()).toHaveLength(8);
    addFiles([pdf('x1.pdf'), pdf('x2.pdf'), pdf('x3.pdf')]);
    expect(tiles()).toHaveLength(10);
    expect(error).toHaveBeenCalledWith(
      'You can upload up to 10 files at a time',
      expect.anything(),
    );
    expect(screen.queryByText('x3.pdf')).toBeNull();
  });

  it('refuses files without ATTACH_FILES in a Space channel', () => {
    const error = vi.spyOn(toast, 'error');
    const space: SpaceChannelInfo = {
      spaceId: 'space-1',
      categoryId: null,
      position: 0,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    };
    const channel = makeChat({
      id: 'chan-1',
      type: 'space_text',
      name: 'general',
      space,
      spacePermissions: PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES,
    });
    render(<Composer chat={channel} />);
    addFiles([png('a.png')], channel);
    expect(tiles()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(NO_UPLOAD_PERMISSION, expect.anything());
  });
});
