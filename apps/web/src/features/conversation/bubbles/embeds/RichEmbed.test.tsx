/**
 * Rich embeds: the fields grid (inline fields up to three a row, two beside a thumbnail, any
 * other field a row of its own), the colour bar, the footer time, author / title links,
 * images only from our uploads, and the message's embed list.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MESSAGE_FLAGS, type EmbedField, type MessageEmbed } from '@enbox/shared';
import { MessageEmbeds } from './MessageEmbeds';
import { RichEmbed } from './RichEmbed';
import { embedColor, formatEmbedTimestamp, layoutFields, safeImage, safeLink } from './layout';

const f = (name: string, inline = false): EmbedField => ({ name, value: `${name} value`, inline });

describe('layoutFields', () => {
  it('puts up to three inline fields in a row, evenly; other fields take a row of their own', () => {
    const cells = layoutFields([
      f('a', true),
      f('b', true),
      f('c', true),
      f('d', true),
      f('e'),
      f('g', true),
      f('h', true),
    ]);
    expect(cells.map((c) => [c.field.name, c.column])).toEqual([
      ['a', '1 / 5'],
      ['b', '5 / 9'],
      ['c', '9 / 13'],
      ['d', '1 / 13'],
      ['e', '1 / 13'],
      ['g', '1 / 7'],
      ['h', '7 / 13'],
    ]);
  });

  it('two a row beside a thumbnail', () => {
    expect(
      layoutFields([f('a', true), f('b', true), f('c', true)], 2).map((c) => c.column),
    ).toEqual(['1 / 7', '7 / 13', '1 / 13']);
  });
});

describe('embed helpers', () => {
  it('colours: 0xRRGGBB as hex, nothing for unset or out of range', () => {
    expect(embedColor(0x57f287)).toBe('#57f287');
    expect(embedColor(0x0000ff)).toBe('#0000ff');
    expect(embedColor(0)).toBe('#000000');
    expect(embedColor(null)).toBeNull();
    expect(embedColor(undefined)).toBeNull();
    expect(embedColor(0x1000000)).toBeNull();
  });

  it('footer times read like message times', () => {
    const now = new Date(2026, 9, 23, 15, 0);
    expect(formatEmbedTimestamp(new Date(2026, 9, 23, 9, 5).toISOString(), now)).toMatch(
      /^Today at /,
    );
    expect(formatEmbedTimestamp(new Date(2026, 9, 22, 9, 5).toISOString(), now)).toMatch(
      /^Yesterday at /,
    );
    expect(formatEmbedTimestamp(new Date(2026, 0, 2, 9, 5).toISOString(), now)).toMatch(/2026/);
    expect(formatEmbedTimestamp('not a date', now)).toBe('');
  });

  it('links are https only; images are our own copies only', () => {
    expect(safeLink('https://example.com/x')).toBe('https://example.com/x');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('http://example.com')).toBeNull();
    expect(safeImage('/uploads/2026/10/a.png')).toBe('/uploads/2026/10/a.png');
    expect(safeImage('https://evil.example/a.png')).toBeNull();
    expect(safeImage('//evil.example/a.png')).toBeNull();
  });
});

const full: MessageEmbed = {
  title: 'Build #42',
  url: 'https://ci.example.com/42',
  description: 'All **green**',
  color: 0x57f287,
  author: { name: 'CI', url: 'https://ci.example.com', iconUrl: '/uploads/ci.png' },
  footer: { text: 'main', iconUrl: '/uploads/branch.png' },
  timestamp: new Date().toISOString(),
  thumbnail: { url: '/uploads/thumb.png' },
  image: { url: '/uploads/chart.png' },
  fields: [f('Tests', true), f('Time', true), f('Notes')],
};

describe('RichEmbed', () => {
  it('renders the author, linked title, markdown description, fields, thumbnail, image and footer', () => {
    render(<RichEmbed embed={full} />);
    const card = screen.getByTestId('rich-embed');
    expect(card).toHaveStyle({ borderLeftColor: '#57f287' });
    expect(within(card).getByRole('link', { name: 'CI' })).toHaveAttribute(
      'href',
      'https://ci.example.com',
    );
    const title = within(card).getByRole('link', { name: 'Build #42' });
    expect(title).toHaveAttribute('href', 'https://ci.example.com/42');
    expect(title).toHaveAttribute('rel', 'noopener noreferrer');
    // Markdown: **green** is bold.
    expect(within(screen.getByTestId('embed-description')).getByText('green').tagName).toBe(
      'STRONG',
    );
    // Beside a thumbnail, inline fields go two a row.
    expect(
      screen.getAllByTestId('embed-field').map((el) => el.getAttribute('data-column')),
    ).toEqual(['1 / 7', '7 / 13', '1 / 13']);
    expect(screen.getByText('Tests').tagName).toBe('DT');
    expect(screen.getByTestId('embed-thumbnail').getAttribute('src')).toMatch(
      /\/uploads\/thumb\.png$/,
    );
    expect(screen.getByTestId('embed-image').getAttribute('src')).toMatch(/\/uploads\/chart\.png$/);
    const footer = screen.getByTestId('embed-footer');
    expect(footer).toHaveTextContent(/^main • Today at /);
    expect(within(footer).getByText(/Today at/).tagName).toBe('TIME');
  });

  it('without a colour the bar takes the line colour; without a url the title is plain text', () => {
    render(
      <RichEmbed embed={{ title: 'Plain', fields: [f('a', true), f('b', true), f('c', true)] }} />,
    );
    expect(screen.getByTestId('rich-embed').style.borderLeftColor).toBe('var(--line-strong)');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Plain')).toBeInTheDocument();
    expect(
      screen.getAllByTestId('embed-field').map((el) => el.getAttribute('data-column')),
    ).toEqual(['1 / 5', '5 / 9', '9 / 13']);
    expect(screen.queryByTestId('embed-footer')).toBeNull();
  });

  it('never shows third-party images or non-https links', () => {
    render(
      <RichEmbed
        embed={{
          title: 'Sneaky',
          url: 'javascript:alert(1)',
          image: { url: 'https://tracker.example/pixel.png' },
          thumbnail: { url: '//tracker.example/t.png' },
          author: { name: 'A', iconUrl: 'https://tracker.example/a.png' },
        }}
      />,
    );
    expect(screen.queryByTestId('embed-image')).toBeNull();
    expect(screen.queryByTestId('embed-thumbnail')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('MessageEmbeds', () => {
  it('renders each embed (at most 10), none for deleted messages or messages without', () => {
    const embeds = Array.from({ length: 12 }, (_, i) => ({ title: `E${i}` }));
    const { rerender } = render(<MessageEmbeds m={{ embeds, deletedAt: null }} />);
    expect(screen.getAllByTestId('rich-embed')).toHaveLength(10);
    rerender(<MessageEmbeds m={{ embeds, deletedAt: '2026-10-23T00:00:00.000Z' }} />);
    expect(screen.queryByTestId('rich-embed')).toBeNull();
    rerender(<MessageEmbeds m={{ deletedAt: null }} />);
    expect(screen.queryByTestId('message-embeds')).toBeNull();
    // "Remove all embeds" hides webhook embeds too.
    rerender(<MessageEmbeds m={{ embeds, deletedAt: null, flags: MESSAGE_FLAGS.SUPPRESS_EMBEDS }} />);
    expect(screen.queryByTestId('message-embeds')).toBeNull();
  });
});
