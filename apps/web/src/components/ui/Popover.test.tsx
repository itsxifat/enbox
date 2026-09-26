import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Popover, placePopover } from './Popover';

const viewport = { width: 1000, height: 800 };
const box = { width: 200, height: 100 };
const rect = (left: number, top: number, width = 40, height = 20) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('placePopover', () => {
  it('places to the right of the anchor, centred on it, and flips left at the viewport edge', () => {
    const p = placePopover(rect(300, 400), box, viewport, 'right', 'center');
    expect(p).toEqual({ left: 346, top: 360, placement: 'right' });
    const flipped = placePopover(rect(900, 400), box, viewport, 'right', 'center');
    expect(flipped.placement).toBe('left');
    expect(flipped.left).toBe(900 - 200 - 6);
  });

  it('places to the left and flips right when there is no room', () => {
    expect(placePopover(rect(500, 400), box, viewport, 'left', 'center')).toMatchObject({
      left: 500 - 200 - 6,
      placement: 'left',
    });
    expect(placePopover(rect(20, 400), box, viewport, 'left', 'center')).toMatchObject({
      left: 66,
      placement: 'right',
    });
  });

  it('flips top/bottom and aligns start/end on the cross axis', () => {
    expect(placePopover(rect(300, 10), box, viewport, 'top', 'center').placement).toBe('bottom');
    expect(placePopover(rect(300, 780), box, viewport, 'bottom', 'center').placement).toBe('top');
    expect(placePopover(rect(300, 400), box, viewport, 'bottom', 'start').left).toBe(300);
    expect(placePopover(rect(300, 400), box, viewport, 'bottom', 'end').left).toBe(340 - 200);
    expect(placePopover(rect(300, 400), box, viewport, 'right', 'start').top).toBe(400);
    expect(placePopover(rect(300, 400), box, viewport, 'right', 'end').top).toBe(420 - 100);
  });

  it('never leaves the viewport margin', () => {
    const p = placePopover(rect(0, 0), box, viewport, 'top', 'start');
    expect(p.left).toBe(8);
    expect(p).toMatchObject({ top: 20 + 6, placement: 'bottom' });
    const q = placePopover(rect(990, 790), box, viewport, 'bottom', 'end');
    expect(q.left).toBe(1000 - 200 - 8);
    expect(q).toMatchObject({ top: 790 - 100 - 6, placement: 'top' });
  });
});

describe('Popover', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  function anchorAt(left: number, top: number): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = 'trigger';
    el.getBoundingClientRect = () => ({ ...rect(left, top), x: left, y: top, toJSON: () => '' });
    document.body.appendChild(el);
    return el;
  }

  it('renders an anchored dialog with the resolved placement', () => {
    const anchor = anchorAt(300, 10);
    render(
      <Popover open anchor={anchor} onClose={() => undefined} aria-label="Reactions">
        <button type="button">👍</button>
      </Popover>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Reactions' });
    // Preferred 'top' does not fit above an anchor at the top edge → flipped below it.
    expect(dialog).toHaveAttribute('data-placement', 'bottom');
    expect(dialog.style.top).toBe(`${10 + 20 + 6}px`);
  });

  it('closes on Escape (top-most overlay) and on an outside pointer, not on an inside one', () => {
    const anchor = anchorAt(300, 400);
    const onClose = vi.fn();
    render(
      <Popover open anchor={anchor} onClose={onClose} placement="right" aria-label="Attach">
        <button type="button">Photo</button>
      </Popover>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders nothing without an anchor', () => {
    render(
      <Popover open anchor={null} onClose={() => undefined} aria-label="Empty">
        x
      </Popover>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
