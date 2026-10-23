/** The resizable desktop sidebar: drag, keys, reset, the device memory and the width override. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SidebarFrame } from './SidebarFrame';
import { SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth, useSidebarWidth } from './sidebarWidth';

/** jsdom has no PointerEvent: a MouseEvent with a pointer id. */
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const KEY = 'enbox.frame.sidebarWidth';

function renderFrame() {
  render(
    <SidebarFrame defaultWidth={260}>
      <aside aria-label="Channels" className="w-[260px]" />
    </SidebarFrame>,
  );
  const frame = screen.getByTestId('sidebar-frame');
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ width: 260 } as DOMRect);
  return { frame, handle: screen.getByRole('separator', { name: 'Resize sidebar' }) };
}

describe('SidebarFrame', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    useSidebarWidth.setState({ width: null });
  });
  afterEach(() => useSidebarWidth.setState({ width: null }));

  it('keeps the sidebar’s own width until resized', () => {
    const { frame, handle } = renderFrame();
    expect(frame.getAttribute('style')).toBeNull();
    expect(frame.className).not.toContain('[&>:first-child]:w-full!');
    expect(handle).toHaveAttribute('aria-valuenow', '260');
    expect(handle).toHaveAttribute('aria-valuemin', String(SIDEBAR_MIN));
    expect(handle).toHaveAttribute('aria-valuemax', String(SIDEBAR_MAX));
  });

  it('drags between 200 and 400 px, live, and remembers the width once let go', () => {
    const { frame, handle } = renderFrame();
    fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { clientX: 340 });
    expect(frame).toHaveStyle({ width: '300px' });
    expect(frame.className).toContain('[&>:first-child]:w-full!');
    expect(localStorage.getItem(KEY)).toBeNull();

    fireEvent.pointerMove(handle, { clientX: 900 });
    expect(frame).toHaveStyle({ width: '400px' });
    fireEvent.pointerMove(handle, { clientX: 0 });
    expect(frame).toHaveStyle({ width: '200px' });

    fireEvent.pointerUp(handle, { clientX: 320 });
    expect(frame).toHaveStyle({ width: '280px' });
    expect(localStorage.getItem(KEY)).toBe('280');
    // Moving the mouse afterwards changes nothing.
    fireEvent.pointerMove(handle, { clientX: 500 });
    expect(frame).toHaveStyle({ width: '280px' });
  });

  it('arrow keys step (Shift: bigger steps), Home and End go to the limits; double-click resets', () => {
    const { frame, handle } = renderFrame();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '270');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(handle).toHaveAttribute('aria-valuenow', '230');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(frame).toHaveStyle({ width: '200px' });
    fireEvent.keyDown(handle, { key: 'End' });
    expect(frame).toHaveStyle({ width: '400px' });
    expect(localStorage.getItem(KEY)).toBe('400');

    fireEvent.doubleClick(handle);
    expect(frame.style.width).toBe('');
    expect(frame.className).not.toContain('[&>:first-child]:w-full!');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('clamps any width to the limits', () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(250.4)).toBe(250);
  });
});
