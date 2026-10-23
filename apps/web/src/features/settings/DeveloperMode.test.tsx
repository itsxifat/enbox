/** Settings → Chats → Advanced: the Developer Mode switch (a device pref). */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { ChatsSettingsPage } from './ChatsSettingsPage';

afterEach(() => useUi.setState({ prefs: { ...DEFAULT_PREFS } }));

describe('Developer Mode', () => {
  it('is off by default and the switch turns it on', () => {
    useUi.setState({ prefs: { ...DEFAULT_PREFS } });
    render(
      <MemoryRouter>
        <ChatsSettingsPage />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('switch', { name: /Developer Mode/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(useUi.getState().prefs.developerMode).toBe(true);
    expect(toggle).toBeChecked();
  });
});
