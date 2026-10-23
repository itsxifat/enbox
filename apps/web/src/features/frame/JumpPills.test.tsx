/** Unread / mention pills over a scrolling list: what is out of view, the pills, and the jump. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JumpPill, offscreenJumps, useJumpPills, type JumpKind } from './JumpPills';

interface TestRow {
  id: string;
  top: number;
  kind?: JumpKind;
}

function List({ rows }: { rows: TestRow[] }) {
  const pills = useJumpPills();
  return (
    <div>
      <div ref={pills.ref} data-testid="scroller">
        {rows.map((r) => (
          <div key={r.id} data-testid={r.id} data-jump={r.kind} data-top={r.top} />
        ))}
      </div>
      <JumpPill side="top" kind={pills.above} onJump={pills.jump} />
      <JumpPill side="bottom" kind={pills.below} onJump={pills.jump} />
    </div>
  );
}

const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100 }) as DOMRect;
let view = { top: 100, bottom: 400 };

describe('offscreenJumps', () => {
  it('names the strongest kind out of view on each side; anything partly visible is in view', () => {
    const v = { top: 100, bottom: 400 };
    expect(offscreenJumps(v, [])).toEqual({ above: null, below: null });
    expect(
      offscreenJumps(v, [
        { top: 0, bottom: 30, kind: 'unread' },
        { top: 40, bottom: 100, kind: 'mention' },
        { top: 380, bottom: 420, kind: 'mention' },
        { top: 450, bottom: 480, kind: 'unread' },
      ]),
    ).toEqual({ above: 'mention', below: 'unread' });
  });
});

describe('useJumpPills', () => {
  const scrolled = vi.fn();
  beforeEach(() => {
    view = { top: 100, bottom: 400 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'scroller') return rect(view.top, view.bottom);
      const top = Number(this.dataset.top ?? 0);
      return rect(top, top + 30);
    });
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    scrolled.mockReset();
    // jsdom has none: the test's goes again.
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  const rows: TestRow[] = [
    { id: 'a', top: 0, kind: 'unread' },
    { id: 'b', top: 40, kind: 'mention' },
    { id: 'c', top: 200 },
    { id: 'd', top: 500, kind: 'unread' },
  ];

  it('shows a pill per side, mentions first, and jumps to the nearest one', () => {
    render(<List rows={rows} />);
    const top = screen.getByRole('button', { name: 'New mentions above' });
    expect(top).toHaveTextContent('New mentions');
    expect(screen.getByRole('button', { name: 'New unreads below' })).toHaveAttribute('data-kind', 'unread');

    fireEvent.click(top);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(screen.getByTestId('b'));
    fireEvent.click(screen.getByRole('button', { name: 'New unreads below' }));
    expect(scrolled.mock.contexts[1]).toBe(screen.getByTestId('d'));
  });

  it('follows the marks and the scroll position', async () => {
    const { rerender } = render(<List rows={rows} />);
    rerender(<List rows={rows.map((r) => (r.id === 'b' ? { ...r, kind: undefined } : r))} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New unreads above' })).toBeInTheDocument());

    view = { top: 0, bottom: 600 };
    fireEvent.scroll(screen.getByTestId('scroller'));
    await waitFor(() => expect(screen.queryByTestId('jump-pill-top')).toBeNull());
    expect(screen.queryByTestId('jump-pill-bottom')).toBeNull();
  });

  it('shows nothing while the list is not laid out', () => {
    view = { top: 0, bottom: 0 };
    render(<List rows={rows} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
