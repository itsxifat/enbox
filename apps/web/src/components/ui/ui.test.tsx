import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useUi } from '@/stores/ui';
import { Avatar, avatarColor } from './Avatar';
import { Badge } from './Badge';
import { DialogHost } from './DialogHost';
import { Modal } from './Modal';
import { confirm } from './index';

describe('Avatar', () => {
  it('renders initials with a deterministic color when there is no image', () => {
    render(<Avatar name="Ada Lovelace" colorSeed="u1" decorative={false} />);
    const el = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(el).toHaveTextContent('AL');
    expect(avatarColor('u1')).toBe(avatarColor('u1'));
  });
});

describe('Badge', () => {
  it('caps at 99+ and hides zero', () => {
    const { rerender, container } = render(<Badge count={150} />);
    expect(container).toHaveTextContent('99+');
    rerender(<Badge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Modal', () => {
  it('closes on Escape and renders an accessible dialog', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Hello">
          body
        </Modal>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Hello' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('confirm()', () => {
  it('resolves true when confirmed through the DialogHost', async () => {
    render(<DialogHost />);
    let result: Promise<boolean> | undefined;
    act(() => {
      result = confirm({ title: 'Delete chat?', confirmLabel: 'Delete', danger: true });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(result).resolves.toBe(true);
    expect(useUi.getState().dialogs).toHaveLength(0);
  });

  it('resolves false on cancel', async () => {
    render(<DialogHost />);
    const onDone = vi.fn();
    act(() => {
      void confirm({ title: 'Sure?' }).then(onDone);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
  });
});
