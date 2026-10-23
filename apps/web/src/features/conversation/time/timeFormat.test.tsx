/** Discord's message times: the header form, the short one and the full date of the tooltip. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatTime } from '@/lib/format';
import { formatFullMessageTime, formatMessageTime, formatSinceTime } from './timeFormat';
import { MessageTime } from './MessageTime';

const now = new Date(2026, 9, 23, 18, 0);
const at = (day: number, h = 15, m = 14, year = 2026) => new Date(year, 9, day, h, m).toISOString();
// Some ICU versions put a narrow no-break space before AM/PM.
const plain = (s: string) => s.replace(/\s/g, ' ');
const header = (iso: string) => plain(formatMessageTime(iso, { now, locale: 'en-US' }));
const since = (iso: string) => plain(formatSinceTime(iso, { now, locale: 'en-US' }));

describe('message times', () => {
  it('headers say Today at, Yesterday at, else the date and time', () => {
    expect(header(at(23))).toBe('Today at 3:14 PM');
    expect(header(at(22))).toBe('Yesterday at 3:14 PM');
    expect(header(at(20, 9, 5))).toBe('10/20/2026 9:05 AM');
    expect(header(at(22, 15, 14, 2025))).toBe('10/22/2025 3:14 PM');
  });

  it('the tooltip is the full date', () => {
    expect(plain(formatFullMessageTime(at(22), { locale: 'en-US' }))).toBe(
      'Thursday, October 22, 2026 3:14 PM',
    );
  });

  it('"since" is the time today, the day and time before', () => {
    expect(since(at(23))).toBe('3:14 PM');
    expect(since(at(21))).toBe('October 21 at 3:14 PM');
    expect(since(at(21, 15, 14, 2025))).toBe('October 21, 2025 at 3:14 PM');
  });

  it('renders a <time> with the full date as its tooltip, in the header or the short form', () => {
    const iso = new Date().toISOString();
    const { rerender } = render(<MessageTime at={iso} />);
    const time = screen.getByText(/^Today at /);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', iso);
    expect(time).toHaveAttribute('title', formatFullMessageTime(iso));
    rerender(<MessageTime at={iso} short />);
    expect(screen.getByText(formatTime(iso)).tagName).toBe('TIME');
  });
});
