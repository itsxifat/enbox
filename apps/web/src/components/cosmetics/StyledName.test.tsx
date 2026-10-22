import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NAME_EFFECTS, NAME_FONTS, type NameStyle } from '@enbox/shared';
import { ChatAnimationsPage } from '@/features/settings/ChatsSettingsPage';
import { isNameFontRequested } from '@/lib/nameFonts';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { StyledName } from './StyledName';

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS });
});

const NEON: NameStyle = { font: 'bangers', effect: 'neon', colors: ['#ff3fd1'] };

function name(el: HTMLElement = document.body) {
  return el.querySelector('.cos-name') as HTMLElement;
}

describe('StyledName', () => {
  it('renders a plain name without a style', () => {
    render(<StyledName name="Ada" className="truncate" />);
    const n = name();
    expect(n).toHaveTextContent('Ada');
    expect(n).toHaveClass('truncate');
    expect(n).not.toHaveAttribute('data-font');
    expect(n).not.toHaveAttribute('data-effect');
    expect(n.getAttribute('style')).toBeNull();
  });

  it("'full' wears the font and the effect", () => {
    render(<StyledName name="Ada" style={NEON} mode="full" />);
    const n = name();
    expect(n).toHaveAttribute('data-font', 'bangers');
    expect(n).toHaveAttribute('data-effect', 'neon');
    expect(n.style.fontFamily).toContain('Bangers');
    expect(n.style.getPropertyValue('--n1')).toBe('#ff3fd1');
    expect(isNameFontRequested('bangers')).toBe(true);
  });

  it.each(NAME_FONTS.map((f) => f.id))('font %s × every effect', (font) => {
    for (const { id: effect } of NAME_EFFECTS) {
      const colors = effect === 'gradient' ? ['#ff0000', '#0000ff'] : ['#22cc88'];
      const { container, unmount } = render(
        <StyledName name="Ada" style={{ font, effect, colors }} mode="full" />,
      );
      const n = name(container);
      expect(n).toHaveTextContent('Ada');
      expect(n).toHaveAttribute('data-effect', effect);
      if (font === 'default') expect(n).not.toHaveAttribute('data-font');
      else expect(n).toHaveAttribute('data-font', font);
      if (effect === 'gradient') expect(n.style.getPropertyValue('--n2')).toBe('#0000ff');
      if (effect === 'solid') expect(n.style.color).toBe('rgb(34, 204, 136)');
      // One colour: the stylesheet picks a theme-aware shadow tint.
      if (effect === 'pop') expect(n.style.getPropertyValue('--np')).toBe('');
      unmount();
    }
  });

  it("'font' (message rows) wears the font only", () => {
    render(<StyledName name="Ada" style={NEON} mode="font" />);
    const n = name();
    expect(n).toHaveAttribute('data-font', 'bangers');
    expect(n).not.toHaveAttribute('data-effect');
    expect(n.style.getPropertyValue('--n1')).toBe('');
  });

  it("a Space role's colour wins over the user's colours; the font stays", () => {
    render(<StyledName name="Ada" style={NEON} role={{ color: '#3498db' }} mode="full" />);
    const n = name();
    expect(n).toHaveAttribute('data-font', 'bangers');
    expect(n).toHaveAttribute('data-role', 'solid');
    expect(n).not.toHaveAttribute('data-effect');
    expect(n.style.color).toBe('rgb(52, 152, 219)');
  });

  it('role gradient and holographic styles', () => {
    const { container: g } = render(
      <StyledName name="Ada" role={{ color: '#ff0000', colorSecondary: '#00ff00', colorStyle: 'gradient' }} mode="font" />,
    );
    expect(name(g)).toHaveAttribute('data-role', 'gradient');
    expect(name(g).style.getPropertyValue('--r2')).toBe('#00ff00');
    // A gradient without its second colour is solid.
    const { container: s } = render(<StyledName name="Ada" role={{ color: '#ff0000', colorStyle: 'gradient' }} />);
    expect(name(s)).toHaveAttribute('data-role', 'solid');
    // Holographic needs no colour; it shimmers on row hover by default.
    const { container: h } = render(<StyledName name="Ada" role={{ color: null, colorStyle: 'holographic' }} />);
    expect(name(h)).toHaveAttribute('data-role', 'holographic');
    expect(name(h)).toHaveAttribute('data-play', 'hover');
    const { container: a } = render(
      <StyledName name="Ada" role={{ color: null, colorStyle: 'holographic' }} animate="always" />,
    );
    expect(name(a)).toHaveAttribute('data-play', 'always');
    // A role without a colour leaves the user's style.
    const { container: none } = render(<StyledName name="Ada" style={NEON} role={{ color: null }} />);
    expect(name(none)).toHaveAttribute('data-effect', 'neon');
  });

  it('the "Show display name styles" pref off renders plain names; role colours stay', () => {
    useUi.getState().setPref('showNameStyles', false);
    const { container } = render(<StyledName name="Ada" style={NEON} mode="full" />);
    expect(name(container)).not.toHaveAttribute('data-font');
    expect(name(container)).not.toHaveAttribute('data-effect');
    const { container: r } = render(<StyledName name="Ada" style={NEON} role={{ color: '#3498db' }} />);
    expect(name(r)).toHaveAttribute('data-role', 'solid');
    expect(name(r)).not.toHaveAttribute('data-font');
  });

  it('ignores unknown fonts and effects from a newer catalogue', () => {
    render(
      <StyledName name="Ada" style={{ font: 'future-font', effect: 'sparkle', colors: ['#ffffff'] } as unknown as NameStyle} />,
    );
    const n = name();
    expect(n).not.toHaveAttribute('data-font');
    expect(n).not.toHaveAttribute('data-effect');
  });
});

describe('Settings → Chats → Animations: name styles', () => {
  it('is on by default and the switch turns it off', () => {
    expect(DEFAULT_PREFS.showNameStyles).toBe(true);
    render(
      <MemoryRouter>
        <ChatAnimationsPage />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('switch', { name: /show display name styles/i });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(useUi.getState().prefs.showNameStyles).toBe(false);
  });

  it('is persisted with the other device prefs (older stores default it on)', () => {
    const persist = useUi.persist.getOptions();
    const kept = persist.partialize!(useUi.getState());
    expect(kept.prefs).toHaveProperty('showNameStyles');
    const merged = persist.merge!({ prefs: { sounds: false } }, useUi.getState());
    expect(merged.prefs.showNameStyles).toBe(true);
  });
});
