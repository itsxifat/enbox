import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Menu, contextMenuAnchor, type MenuEntry } from './Menu';

function setup(items: MenuEntry[]) {
  const onClose = vi.fn();
  render(<Menu open onClose={onClose} anchor={{ x: 10, y: 10 }} items={items} aria-label="Test menu" />);
  return { onClose };
}

describe('Menu submenus, checkboxes and radios', () => {
  it('opens a submenu with → / Enter, closes it with ←, and an item there closes the whole menu', () => {
    const pick = vi.fn();
    const { onClose } = setup([
      { label: 'Mark As Read', onSelect: vi.fn() },
      { label: 'Mute Space', submenu: [{ label: 'For 15 minutes', onSelect: pick }] },
    ]);
    const parent = screen.getByRole('menuitem', { name: 'Mute Space' });
    expect(parent).toHaveAttribute('aria-haspopup', 'menu');
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    act(() => parent.focus());
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(parent).toHaveAttribute('aria-expanded', 'true');
    const sub = screen.getByRole('menu', { name: 'Mute Space' });
    expect(sub).toBeInTheDocument();
    const item = screen.getByRole('menuitem', { name: 'For 15 minutes' });
    fireEvent.keyDown(item, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Mute Space' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(parent);
    fireEvent.click(screen.getByRole('menuitem', { name: 'For 15 minutes' }));
    expect(pick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hovering an item with a submenu opens it; hovering another item closes it', () => {
    setup([
      { label: 'Notification Settings', submenu: [{ label: 'All Messages', onSelect: vi.fn() }] },
      { label: 'Copy Space ID', onSelect: vi.fn() },
    ]);
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Notification Settings' }));
    expect(screen.getByRole('menuitem', { name: 'All Messages' })).toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Copy Space ID' }));
    expect(screen.queryByRole('menuitem', { name: 'All Messages' })).toBeNull();
  });

  it('checkbox items report their state and can stay open; radio items close the menu', () => {
    const toggle = vi.fn();
    const choose = vi.fn();
    const { onClose } = setup([
      { label: 'Hide Muted Channels', checked: true, keepOpen: true, onSelect: toggle },
      { label: 'Only @mentions', checked: false, radio: true, onSelect: choose },
    ]);
    const box = screen.getByRole('menuitemcheckbox', { name: 'Hide Muted Channels' });
    expect(box).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(box);
    expect(toggle).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    const radio = screen.getByRole('menuitemradio', { name: 'Only @mentions' });
    expect(radio).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(radio);
    expect(choose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a description is the accessible description, not part of the name', () => {
    setup([{ label: 'Unmute Space', description: 'Muted until 3:45 PM', onSelect: vi.fn() }]);
    const item = screen.getByRole('menuitem', { name: 'Unmute Space' });
    expect(item).toHaveAccessibleDescription('Muted until 3:45 PM');
  });
});

describe('contextMenuAnchor', () => {
  it('uses the pointer position, or the element for keyboard-opened context menus', () => {
    const el = document.createElement('button');
    expect(contextMenuAnchor({ clientX: 5, clientY: 6, currentTarget: el })).toEqual({ x: 5, y: 6 });
    expect(contextMenuAnchor({ clientX: 0, clientY: 0, currentTarget: el })).toBe(el);
  });
});
