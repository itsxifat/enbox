import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PERM, type SpaceChannelInfo } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { makeChat, makeUser } from '@/test/factories';
import { ConversationDropzone } from './ConversationDropzone';
import { NO_UPLOAD_PERMISSION } from './files';

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

function channel(bits: number) {
  return makeChat({
    id: 'chan-1',
    type: 'space_text',
    name: 'general',
    space,
    spacePermissions: bits,
  });
}

/** jsdom has no DragEvent/DataTransfer: a MouseEvent (it has shiftKey) with a stand-in. */
function drag(
  type: string,
  { types = ['Files'], files = [] as File[], shiftKey = false, target = document.body } = {},
) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, shiftKey });
  Object.defineProperty(e, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const overlay = () => screen.queryByTestId('drop-overlay');

const offs: (() => void)[] = [];
function listen() {
  const onFiles = vi.fn();
  offs.push(bus.on('composer:files', onFiles));
  return onFiles;
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('ConversationDropzone', () => {
  it('shows the overlay for file drags and ignores text and link drags', () => {
    render(<ConversationDropzone chat={channel(PERM.ATTACH_FILES)} />);
    drag('dragenter', { types: ['text/plain', 'text/uri-list'] });
    expect(overlay()).toBeNull();
    drag('dragenter');
    expect(overlay()).toBeInTheDocument();
    expect(screen.getByText('Upload to #general')).toBeInTheDocument();
    expect(
      screen.getByText('You can add comments before uploading. Hold Shift to upload directly.'),
    ).toBeInTheDocument();
  });

  it('names a direct chat with @', () => {
    const chat = makeChat({ type: 'direct', peer: makeUser({ displayName: 'Maya' }) });
    render(<ConversationDropzone chat={chat} />);
    drag('dragenter');
    expect(screen.getByText('Upload to @Maya')).toBeInTheDocument();
  });

  it('counts enter/leave depth so crossing elements does not flicker', () => {
    render(<ConversationDropzone chat={channel(PERM.ATTACH_FILES)} />);
    drag('dragenter');
    drag('dragenter'); // the next element is entered before the previous one is left
    drag('dragleave');
    expect(overlay()).toBeInTheDocument();
    drag('dragleave');
    expect(overlay()).toBeNull();
  });

  it('hides on Escape and on dragend', () => {
    render(<ConversationDropzone chat={channel(PERM.ATTACH_FILES)} />);
    drag('dragenter');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(overlay()).toBeNull();
    // Still the same drag: crossing more elements does not bring it back.
    drag('dragenter');
    expect(overlay()).toBeNull();
    drag('dragleave');
    drag('dragleave');
    drag('dragenter');
    expect(overlay()).toBeInTheDocument();
    drag('dragend');
    expect(overlay()).toBeNull();
  });

  it('routes a drop to the composer (Shift: upload directly) and hides', () => {
    const chat = channel(PERM.ATTACH_FILES);
    const onFiles = listen();
    render(<ConversationDropzone chat={chat} />);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    drag('dragenter');
    const e = drag('drop', { files: [file] });
    expect(e.defaultPrevented).toBe(true);
    expect(overlay()).toBeNull();
    expect(onFiles).toHaveBeenLastCalledWith({ chatId: chat.id, files: [file], direct: false });
    drag('dragenter');
    drag('drop', { files: [file], shiftKey: true });
    expect(onFiles).toHaveBeenLastCalledWith({ chatId: chat.id, files: [file], direct: true });
  });

  it('ignores drags that start inside the page', () => {
    const onFiles = listen();
    render(<ConversationDropzone chat={channel(PERM.ATTACH_FILES)} />);
    drag('dragstart');
    drag('dragenter');
    expect(overlay()).toBeNull();
    drag('drop', { files: [new File(['x'], 'a.png', { type: 'image/png' })] });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('shows the red variant and refuses the drop without ATTACH_FILES', () => {
    const onFiles = listen();
    render(<ConversationDropzone chat={channel(PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES)} />);
    drag('dragenter');
    expect(overlay()).toHaveAttribute('data-denied', 'true');
    expect(screen.getByText(NO_UPLOAD_PERMISSION)).toBeInTheDocument();
    expect(screen.queryByText(/Upload to/)).toBeNull();
    const over = drag('dragover');
    expect((over as unknown as DragEvent).dataTransfer!.dropEffect).toBe('none');
    drag('drop', { files: [new File(['x'], 'a.png', { type: 'image/png' })] });
    expect(onFiles).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });
});
