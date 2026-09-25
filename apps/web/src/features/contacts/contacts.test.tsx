import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeUser } from '@/test/factories';
import { useContacts } from '@/stores/contacts';
import { useUsers } from '@/stores/users';
import { extractLinks } from './ChatMediaGallery';
import { guessIdentifier } from './ContactDialogs';
import { ContactPickerList } from './ContactPickerList';

describe('extractLinks', () => {
  it('finds http(s) and www links, trims trailing punctuation and dedupes', () => {
    expect(
      extractLinks(
        'See https://example.com/a?b=1, and www.enbox.app/help. Also https://example.com/a?b=1!',
      ),
    ).toEqual(['https://example.com/a?b=1', 'https://www.enbox.app/help']);
    expect(extractLinks(null)).toEqual([]);
    expect(extractLinks('no links here')).toEqual([]);
  });
});

describe('guessIdentifier', () => {
  it('detects phone numbers vs usernames', () => {
    expect(guessIdentifier('+1 555 123 4567')).toEqual({
      method: 'phone',
      value: '+1 555 123 4567',
    });
    expect(guessIdentifier('@Ada.L')).toEqual({ method: 'username', value: 'ada.l' });
    expect(guessIdentifier('ada')).toEqual({ method: 'username', value: 'ada' });
  });
});

describe('ContactPickerList', () => {
  it('filters contacts and toggles selection', () => {
    const ada = makeUser({ id: 'a', displayName: 'Ada', isContact: true });
    const bo = makeUser({ id: 'b', displayName: 'Bo', isContact: true });
    useUsers.getState().upsertUsers([ada, bo]);
    useContacts.setState({
      contacts: [
        { userId: 'a', name: null, createdAt: '' },
        { userId: 'b', name: null, createdAt: '' },
      ],
      loaded: true,
    });
    const toggled: [string, boolean][] = [];
    render(
      <ContactPickerList
        selected={new Set(['b'])}
        onToggle={(u, on) => toggled.push([u.id, on])}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /Bo/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: /Ada/ }));
    expect(toggled).toEqual([['a', true]]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bo' } });
    expect(screen.queryByRole('checkbox', { name: /Ada/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Bo/ })).toBeInTheDocument();
  });
});
