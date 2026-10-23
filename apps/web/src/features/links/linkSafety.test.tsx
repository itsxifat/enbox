/**
 * "Leaving Enbox": a link in a message to another site shows its full address first (Go back /
 * Visit site, "Trust <domain> links from now on"); masked links show their real address in
 * the dialog and as a tooltip; our own domains and trusted ones (subdomains too) open at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { DialogHost } from '@/components/ui';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { isTrustedHost, linkHost, needsLinkWarning } from './linkSafety';

const OWN = [window.location.origin];

function renderText(text: string) {
  return render(
    <>
      <RichText text={text} />
      <DialogHost />
    </>,
  );
}

beforeEach(() => {
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState({ dialogs: [] });
});

describe('which links ask first', () => {
  it('web links to other sites; not ours, trusted ones or mail links', () => {
    expect(linkHost('https://www.Example.com/a?b=1')).toBe('example.com');
    expect(linkHost('mailto:a@b.co')).toBeNull();
    expect(needsLinkWarning('https://example.com/x', [], OWN)).toBe(true);
    expect(needsLinkWarning(`${window.location.origin}/chats`, [], OWN)).toBe(false);
    expect(needsLinkWarning('https://docs.example.com/x', ['example.com'], OWN)).toBe(false);
    expect(needsLinkWarning('https://notexample.com/x', ['example.com'], OWN)).toBe(true);
    expect(needsLinkWarning('mailto:a@b.co', [], OWN)).toBe(false);
    expect(isTrustedHost('example.com', ['example.com'])).toBe(true);
  });
});

describe('the Leaving Enbox dialog', () => {
  it('shows the full address; Visit site opens it, Go back doesn’t', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderText('see https://example.com/page?q=1');
    fireEvent.click(screen.getByRole('link', { name: 'https://example.com/page?q=1' }));
    const dialog = screen.getByRole('dialog', { name: 'Leaving Enbox' });
    expect(within(dialog).getByText('This link is taking you to the following website')).toBeInTheDocument();
    expect(within(dialog).getByText('https://example.com/page?q=1')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go back' })));
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'https://example.com/page?q=1' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Visit site' })));
    expect(open).toHaveBeenCalledWith('https://example.com/page?q=1', '_blank', 'noopener,noreferrer');
  });

  it('a masked link shows its real address, as its tooltip too', () => {
    renderText('[cute cats](https://evil.example/steal)');
    const link = screen.getByRole('link', { name: 'cute cats' });
    expect(link).toHaveAttribute('title', 'https://evil.example/steal');
    fireEvent.click(link);
    const dialog = screen.getByRole('dialog', { name: 'Leaving Enbox' });
    expect(within(dialog).getByText('https://evil.example/steal')).toBeInTheDocument();
  });

  it('"Trust" remembers the domain: its links open at once from then on', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderText('https://www.example.com/a and https://cdn.example.com/b');
    fireEvent.click(screen.getByRole('link', { name: 'https://www.example.com/a' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trust example.com links from now on' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Visit site' })));
    expect(useUi.getState().prefs.trustedLinkDomains).toEqual(['example.com']);
    expect(open).toHaveBeenCalledTimes(1);

    // Trusted now: the browser follows the link itself (new tab), no dialog.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    screen.getByRole('link', { name: 'https://cdn.example.com/b' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('links to this app open in-app without asking', () => {
    renderText(`${window.location.origin}/settings`);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole('link').dispatchEvent(event);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
