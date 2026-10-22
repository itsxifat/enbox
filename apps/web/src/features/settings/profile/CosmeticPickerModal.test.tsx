import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AVATAR_DECORATIONS, COSMETIC_COLLECTIONS, NAMEPLATES } from '@enbox/shared';
import { selfCardUser } from '@/features/profile/model';
import { makeMe } from '@/test/factories';
import { CosmeticPickerModal, type CosmeticPickerModalProps } from './CosmeticPickerModal';

const user = selfCardUser(makeMe({ id: 'me', displayName: 'Ada' }));

function renderPicker(p: Partial<CosmeticPickerModalProps> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const props: CosmeticPickerModalProps = {
    kind: 'decoration',
    value: null,
    user,
    onApply,
    onClose,
    ...p,
  };
  const view = render(<CosmeticPickerModal {...props} />);
  return { ...view, onApply, onClose, props };
}

describe('CosmeticPickerModal', () => {
  it('renders nothing while closed', () => {
    renderPicker({ kind: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('groups every item by collection after a None tile', () => {
    renderPicker();
    const dialog = screen.getByRole('dialog', { name: 'Choose an Avatar Decoration' });
    const group = within(dialog).getByRole('radiogroup', { name: 'Avatar Decorations' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(AVATAR_DECORATIONS.length + 1);
    expect(radios[0]).toHaveAccessibleName('None');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    for (const c of COSMETIC_COLLECTIONS)
      expect(within(group).getByRole('heading', { name: c.name })).toBeInTheDocument();
    const cosmic = within(group).getByRole('region', { name: 'Cosmic' });
    expect(within(cosmic).getByRole('radio', { name: 'Orbit' })).toBeInTheDocument();
    expect(within(cosmic).queryByRole('radio', { name: 'Cherry Blossom' })).toBeNull();
  });

  it('starts on the current choice and previews the selection live', () => {
    renderPicker({ kind: 'nameplate', value: 'sakura' });
    expect(screen.getByRole('radio', { name: 'Sakura' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('picker-selection')).toHaveTextContent('Sakura');
    expect(screen.getByTestId('picker-preview')).toHaveTextContent('Bloom collection');
    fireEvent.click(screen.getByRole('radio', { name: 'Galaxy' }));
    expect(screen.getByTestId('picker-selection')).toHaveTextContent('Galaxy');
    expect(screen.getAllByRole('radio')).toHaveLength(NAMEPLATES.length + 1);
  });

  it('is keyboard navigable: arrows move and select, Home / End jump', () => {
    renderPicker();
    const none = screen.getByRole('radio', { name: 'None' });
    expect(none).toHaveAttribute('tabindex', '0');
    none.focus();
    fireEvent.keyDown(none, { key: 'ArrowRight' });
    const orbit = screen.getByRole('radio', { name: 'Orbit' });
    expect(orbit).toHaveFocus();
    expect(orbit).toHaveAttribute('aria-checked', 'true');
    expect(orbit).toHaveAttribute('tabindex', '0');
    expect(none).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(orbit, { key: 'End' });
    const last = AVATAR_DECORATIONS[AVATAR_DECORATIONS.length - 1]!;
    expect(screen.getByRole('radio', { name: last.name })).toHaveFocus();
    expect(screen.getByTestId('picker-selection')).toHaveTextContent(last.name);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(none).toHaveFocus();
    expect(screen.getByTestId('picker-selection')).toHaveTextContent('None');
  });

  it('hovering a tile animates it', () => {
    renderPicker({ kind: 'effect' });
    const tile = screen.getByRole('radio', { name: 'Aurora' });
    expect(tile).not.toHaveAttribute('data-hot');
    fireEvent.pointerEnter(tile);
    expect(tile).toHaveAttribute('data-hot', 'true');
    fireEvent.pointerLeave(tile);
    expect(tile).not.toHaveAttribute('data-hot');
  });

  it('Apply returns the choice; None returns null', () => {
    const { onApply, onClose } = renderPicker({ value: 'orbit' });
    fireEvent.click(screen.getByRole('radio', { name: 'Halo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith('halo');
    expect(onClose).toHaveBeenCalled();
  });

  it('None applies null', () => {
    const { onApply } = renderPicker({ value: 'orbit' });
    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('Esc and Cancel close without applying', () => {
    const { onApply, onClose } = renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Halo' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });
});
