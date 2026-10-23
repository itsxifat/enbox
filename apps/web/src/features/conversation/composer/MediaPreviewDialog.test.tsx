/**
 * The phone preview of picked photos and videos: one caption for the message, alt text per
 * item, at most 10 items; Send hands them all over at once (the composer sends one message).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { makeChat, makeMe } from '@/test/factories';
import { MediaPreviewDialog } from './MediaPreviewDialog';

const png = (name: string) => new File(['png'], name, { type: 'image/png' });
const chat = makeChat({ id: 'g-1', type: 'group', name: 'Friends' });

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup(); // unmounting revokes the previews: before the stubs go
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe('MediaPreviewDialog', () => {
  it('sends every item with its alt text and one caption', () => {
    const onSend = vi.fn();
    const [a, b] = [png('a.png'), png('b.png')];
    render(
      <MediaPreviewDialog
        chat={chat}
        files={[a, b]}
        initialCaption="from the composer"
        onClose={() => undefined}
        onSend={onSend}
      />,
    );
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Item 2' }));
    fireEvent.click(screen.getByRole('button', { name: /Add alt text/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (alt text)' }), {
      target: { value: 'A lighthouse at dusk' },
    });
    expect(screen.getByRole('img', { name: 'A lighthouse at dusk' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Caption' }), {
      target: { value: 'Holiday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith({
      caption: 'Holiday',
      items: [
        { file: a, description: '' },
        { file: b, description: 'A lighthouse at dusk' },
      ],
    });
  });

  it('keeps at most 10 items', () => {
    const error = vi.spyOn(toast, 'error');
    const onSend = vi.fn();
    render(
      <MediaPreviewDialog
        chat={chat}
        files={Array.from({ length: 12 }, (_, i) => png(`p${i}.png`))}
        onClose={() => undefined}
        onSend={onSend}
      />,
    );
    expect(error).toHaveBeenCalledWith('You can only upload 10 files at a time', expect.anything());
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add more' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend.mock.calls[0]![0].items).toHaveLength(10);
  });
});
