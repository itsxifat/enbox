import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { toast, useUi } from '@/stores/ui';
import { IconButton } from './Button';
import { DropdownMenu } from './Menu';
import { Toaster } from './Toaster';

describe('Toaster timing', () => {
  afterEach(() => {
    vi.useRealTimers();
    act(() => useUi.setState({ toasts: [] }));
  });

  it('keeps toasts with an action for at least 10 s', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast.info('Chat archived', { action: { label: 'Undo', onClick: () => undefined } });
    });
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText('Chat archived')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5100));
    expect(screen.queryByText('Chat archived')).not.toBeInTheDocument();
  });

  it('pauses while hovered or focused', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast.info('Saved');
    });
    const el = screen.getByText('Saved').closest('[role="status"]')!;
    fireEvent.mouseEnter(el);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    fireEvent.mouseLeave(el);
    act(() => vi.advanceTimersByTime(3600));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});

describe('DropdownMenu', () => {
  it('points aria-controls at the rendered menu', () => {
    render(
      <DropdownMenu
        aria-label="Chat menu"
        items={[{ label: 'Archive', onSelect: () => undefined }]}
        trigger={(p) => <IconButton {...p} icon={() => null} label="Chat menu" />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat menu' }));
    const controls = screen
      .getByRole('button', { name: 'Chat menu' })
      .getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(screen.getByRole('menu', { name: 'Chat menu' })).toHaveAttribute('id', controls);
  });
});
