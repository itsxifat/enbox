/**
 * Attachment tray: files dropped anywhere over the conversation (or pasted, or picked) wait
 * in the composer and go with the next send as ONE message (`mediaId` + `extraMediaIds`, the
 * text its caption, alt text aligned in `descriptions`); every file uploads with progress on
 * its tile; a failed upload keeps the tray with Retry; Shift-drop sends at once; spoilers are
 * sent with the SPOILER_ name prefix; at most 10 files at a time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PERM, type MediaAttachment, type MediaKind, type SpaceChannelInfo } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { bus } from '@/lib/bus';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { DEFAULT_PREFS, toast, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { ConversationDropzone } from '../dropzone/ConversationDropzone';
import { NO_UPLOAD_PERMISSION } from '../dropzone/files';
import { useChatMembersStore } from '../members';
import { Composer } from './Composer';

type UploadOpts = { fileName?: string; signal?: AbortSignal; onProgress?: (p: number) => void };

const uploads = vi.hoisted(() => ({ uploadMedia: vi.fn() }));
const processing = vi.hoisted(() => ({ prepareVisualMedia: vi.fn() }));
vi.mock('../lib/upload', () => uploads);
vi.mock('../lib/mediaProcessing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareVisualMedia: processing.prepareVisualMedia,
}));

const chat = makeChat({ id: 'dm-1', type: 'direct', peer: makeUser({ displayName: 'Maya' }) });

const png = (name: string) => new File(['png'], name, { type: 'image/png' });
const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });

/** The server copy of an upload (id `m-<file name>`). */
function uploaded(name: string, kind: MediaKind): MediaAttachment {
  return {
    id: `m-${name}`,
    kind,
    url: `/uploads/${name}`,
    thumbnailUrl: null,
    mimeType: kind === 'image' ? 'image/png' : 'application/pdf',
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
const enter = () => fireEvent.keyDown(textarea(), { key: 'Enter' });
const sendMessage = () => vi.mocked(useMessages.getState().sendMessage);
/** The request of the n-th `sendMessage` call. */
const sent = (n = 0) => sendMessage().mock.calls[n]![1] as Record<string, unknown>;
const uploadedNames = () =>
  uploads.uploadMedia.mock.calls.map((c) => (c[2] as UploadOpts).fileName);

let urls = 0;

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: { [chat.id]: [] } });
  URL.createObjectURL = vi.fn(() => `blob:local-${++urls}`);
  URL.revokeObjectURL = vi.fn();
  uploads.uploadMedia.mockImplementation(
    async (_blob: Blob, meta: { kind: MediaKind }, opts: UploadOpts) =>
      uploaded(opts.fileName!, meta.kind),
  );
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
  uploads.uploadMedia.mockReset();
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
    expect(uploads.uploadMedia).not.toHaveBeenCalled();
  });

  it('sends ONE message: every file uploaded, then mediaId + extraMediaIds with the text as caption', async () => {
    renderPane();
    addFiles([png('one.png'), pdf('two.pdf'), png('three.png')]);
    fireEvent.change(textarea(), { target: { value: 'look' } });
    enter();
    // The text goes with the files; the field is free at once.
    expect(textarea()).toHaveValue('');
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(uploadedNames()).toEqual(['one.png', 'two.pdf', 'three.png']);
    // Photos and videos lead (the mosaic; the first one's kind is the type), the rest follow.
    expect(sent()).toMatchObject({
      type: 'image',
      mediaId: 'm-one.png',
      extraMediaIds: ['m-three.png', 'm-two.pdf'],
      text: 'look',
    });
    expect(sent()).not.toHaveProperty('descriptions');
    const optimistic = sendMessage().mock.calls[0]![2]!.optimistic!;
    expect(optimistic.media).toMatchObject({ id: 'm-one.png' });
    expect(optimistic.attachments!.map((a) => [a.id, a.description])).toEqual([
      ['m-one.png', null],
      ['m-three.png', null],
      ['m-two.pdf', null],
    ]);
    expect(tiles()).toHaveLength(0);
  });

  it('sends the files with Enter even without text', async () => {
    renderPane();
    addFiles([pdf('only.pdf')]);
    enter();
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ type: 'file', mediaId: 'm-only.pdf' });
    expect(sent()).not.toHaveProperty('extraMediaIds');
    expect(sent().text).toBeUndefined();
    // One file without alt text: just `media`, like the server.
    expect(sendMessage().mock.calls[0]![2]!.optimistic).not.toHaveProperty('attachments');
  });

  it('shows each upload’s progress on its tile while sending', async () => {
    const releases: (() => void)[] = [];
    uploads.uploadMedia.mockImplementation(
      (_blob: Blob, meta: { kind: MediaKind }, opts: UploadOpts) =>
        new Promise((resolve) => {
          opts.onProgress?.(0.5);
          releases.push(() => resolve(uploaded(opts.fileName!, meta.kind)));
        }),
    );
    renderPane();
    addFiles([png('a.png'), png('b.png')]);
    enter();
    await waitFor(() =>
      expect(within(tiles()[0]!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50'),
    );
    expect(tiles()[0]).toHaveAttribute('data-status', 'uploading');
    expect(within(tiles()[1]!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
    expect(screen.getByTestId('attachment-tray-status')).toHaveTextContent('Uploading 1 of 2');
    // No editing meanwhile.
    expect(screen.queryByRole('button', { name: 'Remove a.png' })).toBeNull();
    act(() => releases[0]!());
    await waitFor(() => expect(tiles()[0]).toHaveAttribute('data-status', 'uploaded'));
    await waitFor(() => expect(releases).toHaveLength(2));
    act(() => releases[1]!());
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ mediaId: 'm-a.png', extraMediaIds: ['m-b.png'] });
    expect(tiles()).toHaveLength(0);
  });

  it('a failed upload keeps the tray with a retry; only the failed file goes up again', async () => {
    const error = vi.spyOn(toast, 'error');
    let fail = true;
    uploads.uploadMedia.mockImplementation(
      async (_blob: Blob, meta: { kind: MediaKind }, opts: UploadOpts) => {
        if (opts.fileName === 'bad.png' && fail)
          throw new ApiError('payload_too_large', 'File is too large', 413);
        return uploaded(opts.fileName!, meta.kind);
      },
    );
    renderPane();
    addFiles([png('good.png'), png('bad.png')]);
    fireEvent.change(textarea(), { target: { value: 'caption' } });
    enter();
    await waitFor(() =>
      expect(screen.getByTestId('attachment-tray-status')).toHaveTextContent(
        'Couldn’t upload a file',
      ),
    );
    expect(sendMessage()).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(ApiError), expect.anything());
    expect(tiles().map((t) => t.getAttribute('data-status'))).toEqual([null, 'failed']);
    expect(within(tiles()[1]!).getByText('Upload failed')).toBeInTheDocument();
    // The caption is back in the field, ready for the retry.
    expect(textarea()).toHaveValue('caption');

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(uploadedNames()).toEqual(['good.png', 'bad.png', 'bad.png']);
    expect(sent()).toMatchObject({
      type: 'image',
      mediaId: 'm-good.png',
      extraMediaIds: ['m-bad.png'],
      text: 'caption',
    });
    expect(tiles()).toHaveLength(0);
    expect(textarea()).toHaveValue('');
  });

  it('Cancel stops the send: the uploads are aborted and the text comes back', async () => {
    const signals: AbortSignal[] = [];
    uploads.uploadMedia.mockImplementation(
      (_blob: Blob, _meta: unknown, opts: UploadOpts) =>
        new Promise((_resolve, reject) => {
          signals.push(opts.signal!);
          opts.signal!.addEventListener('abort', () =>
            reject(new ApiError('aborted', 'Upload cancelled')),
          );
        }),
    );
    renderPane();
    addFiles([png('slow.png')]);
    fireEvent.change(textarea(), { target: { value: 'hello' } });
    enter();
    expect(textarea()).toHaveValue('');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(signals[0]!.aborted).toBe(true);
    expect(textarea()).toHaveValue('hello');
    expect(tiles()).toHaveLength(1);
    expect(tiles()[0]).not.toHaveAttribute('data-status');
    expect(screen.queryByTestId('attachment-tray-status')).toBeNull();
    await act(async () => undefined);
    expect(sendMessage()).not.toHaveBeenCalled();
  });

  it('text typed while the files are on their way goes as its own message', async () => {
    const info = vi.spyOn(toast, 'info');
    let release!: () => void;
    uploads.uploadMedia.mockImplementation(
      (_blob: Blob, meta: { kind: MediaKind }, opts: UploadOpts) =>
        new Promise((resolve) => (release = () => resolve(uploaded(opts.fileName!, meta.kind)))),
    );
    renderPane();
    addFiles([png('pic.png')]);
    fireEvent.change(textarea(), { target: { value: 'first' } });
    enter();
    await waitFor(() => expect(uploads.uploadMedia).toHaveBeenCalledTimes(1));
    // No more files meanwhile.
    addFiles([png('late.png')]);
    expect(info).toHaveBeenCalledWith('Wait until your files are sent', expect.anything());
    expect(tiles()).toHaveLength(1);
    fireEvent.change(textarea(), { target: { value: 'second' } });
    enter();
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(sent(0)).toMatchObject({ type: 'text', text: 'second' });
    act(() => release());
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(2));
    expect(sent(1)).toMatchObject({ type: 'image', mediaId: 'm-pic.png', text: 'first' });
  });

  it('sends at once on a Shift-drop, in one message, and keeps the typed text', async () => {
    renderPane();
    fireEvent.change(textarea(), { target: { value: 'draft' } });
    drop([png('a.png'), pdf('b.pdf')], true);
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ type: 'image', mediaId: 'm-a.png', extraMediaIds: ['m-b.pdf'] });
    expect(sent().text).toBeUndefined();
    expect(textarea()).toHaveValue('draft');
    expect(tiles()).toHaveLength(0);
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

  it('alt text from the edit dialog goes with the message, aligned with the files', async () => {
    renderPane();
    addFiles([pdf('notes.pdf'), png('cat.png'), png('dog.png')]);
    // Documents have no alt text.
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes.pdf' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Edit attachment' })).queryByLabelText(
        'Description (alt text)',
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit dog.png' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit attachment' });
    fireEvent.change(within(dialog).getByLabelText('Description (alt text)'), {
      target: { value: '  A dog catching a frisbee  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const dog = tiles()[2]!;
    expect(within(dog).getByText('ALT')).toBeInTheDocument();
    expect(dog.querySelector('img')).toHaveAttribute('alt', 'A dog catching a frisbee');
    expect(within(tiles()[1]!).queryByText('ALT')).toBeNull();

    enter();
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({
      type: 'image',
      mediaId: 'm-cat.png',
      extraMediaIds: ['m-dog.png', 'm-notes.pdf'],
      descriptions: [null, 'A dog catching a frisbee', null],
    });
    const optimistic = sendMessage().mock.calls[0]![2]!.optimistic!;
    expect(optimistic.attachments![1]).toMatchObject({
      id: 'm-dog.png',
      description: 'A dog catching a frisbee',
    });
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
    enter();
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    const prepared = processing.prepareVisualMedia.mock.calls[0]![0] as File;
    expect(prepared.name).toBe('SPOILER_plot.png');
    expect(uploadedNames()).toEqual(['SPOILER_plot.png', 'doc.pdf']);
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
    enter();
    await waitFor(() => expect(sendMessage()).toHaveBeenCalledTimes(1));
    expect(uploadedNames()).toEqual(['invoice.pdf']);
  });

  it('takes at most 10 files at a time', () => {
    const error = vi.spyOn(toast, 'error');
    renderPane();
    addFiles(Array.from({ length: 8 }, (_, i) => pdf(`f${i}.pdf`)));
    expect(tiles()).toHaveLength(8);
    addFiles([pdf('x1.pdf'), pdf('x2.pdf'), pdf('x3.pdf')]);
    expect(tiles()).toHaveLength(10);
    expect(error).toHaveBeenCalledWith('You can only upload 10 files at a time', expect.anything());
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
