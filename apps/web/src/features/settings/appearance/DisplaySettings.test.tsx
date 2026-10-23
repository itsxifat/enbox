/** Settings ▸ Chats display controls: each one sets its device pref. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { ChatsSettingsPage } from '../ChatsSettingsPage';

const prefs = () => useUi.getState().prefs;

function renderPage() {
  return render(
    <MemoryRouter>
      <ChatsSettingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() =>
  useUi.setState({ theme: 'dark', resolvedTheme: 'dark', prefs: { ...DEFAULT_PREFS } }),
);
afterEach(() => useUi.setState({ prefs: { ...DEFAULT_PREFS } }));

describe('Settings ▸ Chats display', () => {
  it('message display: Cozy or Compact, and avatars in Compact', () => {
    useUi.getState().setPref('bubbleStyle', 'classic');
    renderPage();
    const group = screen.getByRole('radiogroup', { name: 'Message display' });
    expect(within(group).getByRole('radio', { name: 'Cozy' })).toBeChecked();
    const avatars = screen.getByRole('switch', { name: 'Show avatars in Compact mode' });
    expect(avatars).toBeDisabled();

    fireEvent.click(within(group).getByRole('radio', { name: 'Compact' }));
    expect(prefs().messageDisplay).toBe('compact');
    // Compact needs rows.
    expect(prefs().bubbleStyle).toBe('cozy');
    expect(avatars).toBeEnabled();
    fireEvent.click(avatars);
    expect(prefs().compactShowAvatars).toBe(false);

    fireEvent.click(within(group).getByRole('radio', { name: 'Cozy' }));
    expect(prefs().messageDisplay).toBe('cozy');
    expect(prefs().bubbleStyle).toBe('cozy');
  });

  it('chat font scaling: 12-24 px, starting from the old text size, with a sample', () => {
    useUi.getState().setPref('fontSize', 'small');
    renderPage();
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Chat font scaling' });
    expect(slider).toHaveAttribute('min', '12');
    expect(slider).toHaveAttribute('max', '24');
    expect(slider.value).toBe('14');
    fireEvent.change(slider, { target: { value: '20' } });
    expect(prefs().chatFontPx).toBe(20);
    // Older clients read the nearest of the three steps.
    expect(prefs().fontSize).toBe('large');
    expect(slider).toHaveAttribute('aria-valuetext', '20 pixels');
    expect(screen.getByTestId('font-sample').querySelectorAll('.text-chat').length).toBeGreaterThan(
      0,
    );
  });

  it('zoom level: the browser steps from 50% to 200%', () => {
    renderPage();
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Zoom level' });
    expect(slider).toHaveAttribute('aria-valuetext', '100%');
    fireEvent.change(slider, { target: { value: '7' } });
    expect(prefs().zoom).toBe(1.25);
    expect(slider).toHaveAttribute('aria-valuetext', '125%');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(prefs().zoom).toBe(0.5);
    expect(screen.getByText(/\+ 0 goes back to 100%/)).toBeInTheDocument();
  });

  it('zoom level: a drag applies on release (zooming moves the slider)', () => {
    renderPage();
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Zoom level' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '8' } });
    expect(prefs().zoom).toBe(1);
    expect(slider).toHaveAttribute('aria-valuetext', '150%');
    fireEvent.pointerUp(slider);
    expect(prefs().zoom).toBe(1.5);
    expect(slider).toHaveAttribute('aria-valuetext', '150%');
  });

  it('UI density: compact, default or spacious', () => {
    renderPage();
    const group = screen.getByRole('radiogroup', { name: 'UI density' });
    expect(within(group).getByRole('radio', { name: 'Default' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'Spacious' }));
    expect(prefs().uiDensity).toBe('spacious');
    fireEvent.click(within(group).getByRole('radio', { name: 'Compact' }));
    expect(prefs().uiDensity).toBe('compact');
  });

  it('colour themes: Default, eight gradients and Custom from two colours', () => {
    renderPage();
    const group = screen.getByRole('radiogroup', { name: 'Colour' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual([
      'Default',
      'Twilight',
      'Aurora',
      'Ember',
      'Lagoon',
      'Blossom',
      'Citrus',
      'Forest',
      'Midnight',
      'Custom',
    ]);
    expect(within(group).getByRole('radio', { name: 'Default' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'Aurora' }));
    expect(prefs().appTheme).toBe('aurora');
    expect(screen.queryByTestId('custom-theme-colors')).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole('radio', { name: 'Custom' }));
    expect(prefs().appTheme).toBe('custom');
    fireEvent.change(screen.getByLabelText('First colour'), { target: { value: '#FF8800' } });
    expect(prefs().customThemeColors).toEqual(['#ff8800', DEFAULT_PREFS.customThemeColors[1]]);
    fireEvent.change(screen.getByLabelText('Second colour'), { target: { value: '#0088ff' } });
    expect(prefs().customThemeColors).toEqual(['#ff8800', '#0088ff']);
  });

  it('sync across clients is on by default and can be turned off here', () => {
    renderPage();
    const sync = screen.getByRole('switch', { name: 'Sync across clients' });
    expect(sync).toBeChecked();
    fireEvent.click(sync);
    expect(prefs().syncPreferences).toBe(false);
  });
});
