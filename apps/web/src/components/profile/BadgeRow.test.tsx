import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { profileBadges } from '@enbox/shared';
import { BadgeRow } from './BadgeRow';
import { MemberSince, formatProfileDate } from './MemberSince';

describe('BadgeRow', () => {
  it('draws each badge as a focusable image named by its label, owner crown first', () => {
    const badges = profileBadges(
      { createdAt: '2025-01-15T00:00:00.000Z' },
      Date.parse('2026-03-01T00:00:00.000Z'),
    );
    render(<BadgeRow badges={badges} owner />);
    const row = within(screen.getByRole('list', { name: 'Badges' }));
    const imgs = row.getAllByRole('img');
    expect(imgs.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Space Owner',
      'Supporter for a year',
      'Early Member',
    ]);
    for (const i of imgs) expect(i).toHaveAttribute('tabindex', '0');
    expect(imgs[1]).toHaveAttribute('data-badge', 'tenure-diamond');
    // The tooltip text is there for sighted users (hidden from screen readers: the label says it).
    expect(screen.getByText('Early Member')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders nothing without badges', () => {
    const { container } = render(<BadgeRow badges={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MemberSince', () => {
  it('shows the Enbox date and, in a Space, the Space join date', () => {
    render(
      <MemberSince
        createdAt="2025-01-15T12:00:00.000Z"
        space={{ id: 's1', name: 'Climbers', iconUrl: null }}
        joinedAt="2026-02-03T12:00:00.000Z"
      />,
    );
    const section = screen.getByTestId('card-member-since');
    expect(section).toHaveTextContent('Member Since');
    expect(section).toHaveTextContent('Enbox: Jan 15, 2025');
    expect(section).toHaveTextContent('Climbers: Feb 3, 2026');
  });

  it('formats dates as "Mon D, YYYY"', () => {
    expect(formatProfileDate('2024-12-31T12:00:00.000Z', 'en-US')).toBe('Dec 31, 2024');
  });
});
