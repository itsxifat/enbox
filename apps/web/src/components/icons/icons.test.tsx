import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Search } from 'lucide-react';
import { Ticks } from '@/features/conversation/bubbles/Ticks';
import {
  ChatsFilledIcon,
  ChatsIcon,
  IconProvider,
  ICON_STROKE,
  TickIcon,
  VideoIcon,
  VideoOffIcon,
} from './index';

const svg = (container: HTMLElement) => container.querySelector('svg')!;

describe('Enbox icons', () => {
  it('render like lucide icons: 24-unit grid, currentColor, decorative by default', () => {
    const { container } = render(<ChatsIcon size={20} className="text-brand" />);
    const el = svg(container);
    expect(el).toHaveAttribute('viewBox', '0 0 24 24');
    expect(el).toHaveAttribute('width', '20');
    expect(el).toHaveAttribute('stroke', 'currentColor');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveClass('lucide', 'lucide-enbox-chats', 'text-brand');
  });

  it('are exposed to assistive tech when labelled', () => {
    const { container } = render(<TickIcon aria-label="Sent" role="img" />);
    expect(svg(container)).not.toHaveAttribute('aria-hidden');
  });

  it('share the app-wide screen-pixel stroke with lucide icons', () => {
    const { container } = render(
      <IconProvider>
        <ChatsIcon size={16} />
        <Search size={16} />
      </IconProvider>,
    );
    const [custom, lucide] = Array.from(container.querySelectorAll('svg'));
    // 1.5px at 16px on a 24-unit grid = 2.25 units; lucide keeps 1.5 + non-scaling-stroke.
    expect(Number(custom!.getAttribute('stroke-width'))).toBeCloseTo((ICON_STROKE * 24) / 16);
    expect(lucide!.getAttribute('stroke-width')).toBe(String(ICON_STROKE));
    expect(lucide!.querySelector('[vector-effect="non-scaling-stroke"]')).not.toBeNull();
  });

  it('scale the stroke with the size when opting out (illustrations)', () => {
    const { container } = render(
      <IconProvider>
        <ChatsIcon size={48} strokeWidth={1.5} nonScalingStroke={false} />
      </IconProvider>,
    );
    expect(svg(container)).toHaveAttribute('stroke-width', '1.5');
  });

  it('give every instance its own mask so cut-outs never collide', () => {
    const { container } = render(
      <>
        <ChatsFilledIcon />
        <ChatsFilledIcon />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('mask')).map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const masked = Array.from(container.querySelectorAll('[mask]')).map((m) =>
      m.getAttribute('mask'),
    );
    expect(masked).toEqual(ids.map((id) => `url(#${id})`));
  });

  it('draw the camera tall enough to sit beside the phone icon, and cut the "off" slash cleanly', () => {
    const { container } = render(
      <>
        <VideoIcon />
        <VideoOffIcon />
      </>,
    );
    const [video, off] = Array.from(container.querySelectorAll('svg'));
    // lucide's camera body is 12 units tall and reads smaller than the handset next to it.
    expect(video!.querySelector('rect')).toHaveAttribute('height', '14');
    expect(video).toHaveClass('lucide-enbox-video');
    // The "off" variant masks the same camera around its slash, then draws the slash on top.
    const mask = off!.querySelector('mask')!;
    expect(off!.querySelector(`g[mask="url(#${mask.id})"] rect`)).toHaveAttribute('height', '14');
    expect(off!.lastElementChild).toHaveAttribute('d', 'M2 2l20 20');
  });
});

describe('Ticks', () => {
  it('labels each message status and colors read receipts', () => {
    const { getByRole, rerender } = render(<Ticks status="sent" />);
    expect(getByRole('img', { name: 'Sent' })).toBeInTheDocument();
    rerender(<Ticks status="read" />);
    expect(getByRole('img', { name: 'Read' })).toHaveClass('text-tick-read');
    rerender(<Ticks status="failed" />);
    expect(getByRole('img', { name: 'Not sent' })).toHaveClass('text-danger');
  });
});
