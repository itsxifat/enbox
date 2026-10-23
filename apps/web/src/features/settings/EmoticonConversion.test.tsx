/** Settings → Chats → Chat settings: the "Convert emoticons to emoji" switch (a device pref). */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { ChatsSettingsPage } from './ChatsSettingsPage';

afterEach(() => useUi.setState({ prefs: { ...DEFAULT_PREFS } }));

describe('Convert emoticons to emoji', () => {
  it('is on by default and the switch turns it off', () => {
    useUi.setState({ prefs: { ...DEFAULT_PREFS } });
    render(
      <MemoryRouter>
        <ChatsSettingsPage />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('switch', { name: /Convert emoticons to emoji/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(useUi.getState().prefs.emoticonConversion).toBe(false);
    expect(toggle).not.toBeChecked();
  });
});
