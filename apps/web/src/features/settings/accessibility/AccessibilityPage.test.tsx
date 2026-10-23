/** Settings ▸ Accessibility: every control sets its device pref; the previews follow them. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { AccessibilityPage } from './AccessibilityPage';

const prefs = () => useUi.getState().prefs;

function renderPage() {
  return render(
    <MemoryRouter>
      <AccessibilityPage />
    </MemoryRouter>,
  );
}

beforeEach(() => useUi.setState({ prefs: { ...DEFAULT_PREFS } }));
afterEach(() => useUi.setState({ prefs: { ...DEFAULT_PREFS } }));

describe('Settings ▸ Accessibility', () => {
  it('saturation: a 0-100% slider, and saturation for role colours', () => {
    renderPage();
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Saturation' });
    expect(slider.value).toBe('100');
    expect(slider).toHaveAttribute('aria-valuetext', '100%');
    fireEvent.change(slider, { target: { value: '40' } });
    expect(prefs().saturation).toBe(0.4);
    expect(slider).toHaveAttribute('aria-valuetext', '40%');
    expect(screen.getByTestId('saturation-preview')).toBeInTheDocument();

    const roles = screen.getByRole('switch', { name: 'Apply saturation to role colours' });
    expect(roles).not.toBeChecked();
    fireEvent.click(roles);
    expect(prefs().saturateRoleColors).toBe(true);
  });

  it('contrast: sync with computer by default, on or off', () => {
    renderPage();
    const group = screen.getByRole('group', { name: 'Contrast' });
    expect(within(group).getByRole('radio', { name: /Sync with computer/ })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: /^On/ }));
    expect(prefs().contrast).toBe('on');
    fireEvent.click(within(group).getByRole('radio', { name: /^Off/ }));
    expect(prefs().contrast).toBe('off');
  });

  it('links and the send button are switches', () => {
    renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Always underline links' }));
    expect(prefs().underlineLinks).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Show send message button' }));
    expect(prefs().showSendButton).toBe(true);
  });

  it('role colours: in names, next to names (a dot in the preview) or not at all', () => {
    renderPage();
    const group = screen.getByRole('group', { name: 'Role colours' });
    const preview = screen.getByTestId('role-colors-preview');
    expect(within(group).getByRole('radio', { name: /Show in names/ })).toBeChecked();
    expect(preview.querySelector('.cos-name')).toHaveAttribute('data-role', 'solid');

    fireEvent.click(within(group).getByRole('radio', { name: /Show next to names/ }));
    expect(prefs().roleColors).toBe('dot');
    expect(preview.querySelector('.cos-name')).not.toHaveAttribute('data-role');
    expect(preview.querySelector('.cos-role-dot')).not.toBeNull();

    fireEvent.click(within(group).getByRole('radio', { name: /Don't show/ }));
    expect(prefs().roleColors).toBe('hidden');
    expect(preview.querySelector('.cos-role-dot')).toBeNull();
    expect(preview.querySelector('.cos-name')).not.toHaveAttribute('data-role');
  });

  it('motion: reduced motion, animated emoji, GIFs and avatars, stickers, super reactions', () => {
    renderPage();
    const motion = screen.getByRole('group', { name: 'Reduced motion' });
    expect(within(motion).getByRole('radio', { name: /Sync with computer/ })).toBeChecked();
    fireEvent.click(within(motion).getByRole('radio', { name: /^On/ }));
    expect(prefs().reduceMotion).toBe('on');

    fireEvent.click(screen.getByRole('switch', { name: 'Play animated emoji' }));
    expect(prefs().animateEmoji).toBe(false);

    const gifs = screen.getByRole('radiogroup', { name: 'Play GIFs and animated avatars' });
    expect(within(gifs).getByRole('radio', { name: 'On hover' })).toBeChecked();
    fireEvent.click(within(gifs).getByRole('radio', { name: 'Never' }));
    expect(prefs().autoplayAnimatedMedia).toBe('never');

    const stickers = screen.getByRole('radiogroup', { name: 'Sticker animations' });
    expect(within(stickers).getByRole('radio', { name: 'Always' })).toBeChecked();
    fireEvent.click(within(stickers).getByRole('radio', { name: 'On hover' }));
    expect(prefs().stickerAnimation).toBe('interaction');

    const burst = screen.getByRole('switch', { name: 'Play super reaction animations' });
    expect(burst).toBeChecked();
    fireEvent.click(burst);
    expect(prefs().superReactionAnimations).toBe(false);
  });

  it('message spacing: 0 to 24 px between groups, 16 by default, with a preview', () => {
    renderPage();
    const spacing = screen.getByRole('radiogroup', { name: 'Space between message groups' });
    expect(
      within(spacing)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['0px', '4px', '8px', '16px', '24px']);
    expect(within(spacing).getByRole('radio', { name: '16px' })).toBeChecked();
    fireEvent.click(within(spacing).getByRole('radio', { name: '4px' }));
    expect(prefs().messageGroupSpacing).toBe(4);
    expect(
      screen.getByTestId('spacing-preview').querySelector('.msg-group-start-cozy'),
    ).not.toBeNull();
  });

  it('links to the chat text size and text-to-speech in Chats', () => {
    renderPage();
    const row = screen.getByRole('link', { name: /Chat text size and text-to-speech/ });
    expect(row).toHaveAttribute('href', '/settings/chats');
    expect(row).toHaveTextContent('Medium text, /tts messages on');
  });
});
