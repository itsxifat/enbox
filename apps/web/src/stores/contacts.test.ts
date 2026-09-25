import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '@enbox/shared';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { makeChat, makeUser } from '@/test/factories';
import { useChats } from './chats';
import { groupByInitial, initialOf, matchesUser, useContacts } from './contacts';
import { useUsers } from './users';
import '@/realtime/users';

const contact = (id: string, displayName: string, name: string | null = null): Contact => ({
  user: makeUser({ id, displayName, isContact: true, contactName: name }),
  name,
  createdAt: '2025-01-01T00:00:00.000Z',
});

describe('contacts helpers', () => {
  it('initialOf folds diacritics and buckets non-letters under #', () => {
    expect(initialOf('zoë')).toBe('Z');
    expect(initialOf('Émile')).toBe('E');
    expect(initialOf('  maya')).toBe('M');
    expect(initialOf('8bit')).toBe('#');
    expect(initialOf('🙂 Smile')).toBe('#');
    expect(initialOf('')).toBe('#');
  });

  it('groupByInitial sorts sections alphabetically with # last and keeps item order', () => {
    const names = ['Émile', 'ada', '42 Club', 'Adam', 'Zed', 'eve'];
    const groups = groupByInitial(names, (n) => n);
    expect(groups.map((g) => g.letter)).toEqual(['A', 'E', 'Z', '#']);
    expect(groups[0]!.items).toEqual(['ada', 'Adam']);
    expect(groups[1]!.items).toEqual(['Émile', 'eve']);
    expect(groups[3]!.items).toEqual(['42 Club']);
  });

  it('matchesUser matches saved name, display name, username and phone digits', () => {
    const u = makeUser({
      displayName: 'Zoë Adams',
      contactName: 'Zo from climbing',
      username: 'zoe.a',
      phone: '+15550001234',
    });
    expect(matchesUser(u, 'zoe')).toBe(true); // diacritics folded
    expect(matchesUser(u, 'CLIMB')).toBe(true);
    expect(matchesUser(u, '@zoe.a')).toBe(true);
    expect(matchesUser(u, '555 000')).toBe(true);
    expect(matchesUser(u, '12')).toBe(false); // too few digits for a phone match
    expect(matchesUser(u, 'maya')).toBe(false);
    expect(matchesUser(u, '  ')).toBe(true);
  });
});

describe('contacts store', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
  });

  it('loadContacts upserts profiles and dedupes concurrent loads', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue([contact('a', 'Ada'), contact('b', 'Bo', 'Bobby')]);
    await Promise.all([
      useContacts.getState().loadContacts(),
      useContacts.getState().loadContacts(),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(useContacts.getState().contacts.map((c) => c.userId)).toEqual(['a', 'b']);
    expect(useUsers.getState().byId.b?.contactName).toBe('Bobby');
    await useContacts.getState().loadContacts(); // cached
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('addContact / renameContact patch the users store and direct-chat peers', async () => {
    const peer = makeUser({ id: 'p', displayName: 'Pat' });
    useChats.getState().upsertChat(makeChat({ id: 'dm', type: 'direct', name: null, peer }));
    vi.spyOn(api, 'post').mockResolvedValue(contact('p', 'Pat', 'Patty'));
    await useContacts.getState().addContact({ userId: 'p', name: 'Patty' });
    expect(useChats.getState().byId.dm?.peer?.contactName).toBe('Patty');
    expect(useChats.getState().byId.dm?.peer?.isContact).toBe(true);
    expect(useContacts.getState().contacts).toHaveLength(1);

    vi.spyOn(api, 'patch').mockResolvedValue(contact('p', 'Pat', null));
    await useContacts.getState().renameContact('p', null);
    expect(useChats.getState().byId.dm?.peer?.contactName).toBeNull();
    expect(useUsers.getState().byId.p?.contactName).toBeNull();
  });

  it('removeContact clears isContact/contactName everywhere', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([contact('p', 'Pat', 'Patty')]);
    await useContacts.getState().loadContacts();
    useChats
      .getState()
      .upsertChat(
        makeChat({ id: 'dm', type: 'direct', name: null, peer: useUsers.getState().byId.p! }),
      );
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    await useContacts.getState().removeContact('p');
    expect(del).toHaveBeenCalledWith('/api/contacts/p');
    expect(useContacts.getState().contacts).toEqual([]);
    expect(useUsers.getState().byId.p).toMatchObject({ isContact: false, contactName: null });
    expect(useChats.getState().byId.dm?.peer).toMatchObject({
      isContact: false,
      contactName: null,
    });
  });

  it('block/unblock maintain blockedIds and the peer flag, then refresh the profile', async () => {
    const peer = makeUser({ id: 'x', displayName: 'Xan' });
    useUsers.getState().upsertUsers([peer]);
    useChats.getState().upsertChat(makeChat({ id: 'dm', type: 'direct', name: null, peer }));
    vi.spyOn(api, 'put').mockResolvedValue(undefined);
    vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    const batch = vi
      .spyOn(api, 'post')
      .mockImplementation(async () => [makeUser({ id: 'x', displayName: 'Xan', isBlocked: true })]);
    await useContacts.getState().block('x');
    expect(useContacts.getState().blockedIds).toEqual(['x']);
    expect(useChats.getState().byId.dm?.peer?.isBlocked).toBe(true);
    expect(batch).toHaveBeenCalledWith('/api/users/batch', { userIds: ['x'] });

    batch.mockImplementation(async () => [
      makeUser({ id: 'x', displayName: 'Xan', isBlocked: false }),
    ]);
    await useContacts.getState().unblock('x');
    expect(useContacts.getState().blockedIds).toEqual([]);
    expect(useChats.getState().byId.dm?.peer?.isBlocked).toBe(false);
  });

  it('contacts:changed (another device) resyncs names and drops removed contacts', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([contact('a', 'Ada'), contact('b', 'Bo')]);
    await useContacts.getState().loadContacts();
    useChats
      .getState()
      .upsertChat(
        makeChat({ id: 'dm', type: 'direct', name: null, peer: useUsers.getState().byId.b! }),
      );

    get.mockResolvedValue([contact('a', 'Ada', 'Aunt Ada')]);
    bus.emit('contacts:changed');
    await vi.waitFor(() => expect(useContacts.getState().contacts).toHaveLength(1));
    expect(useUsers.getState().byId.a?.contactName).toBe('Aunt Ada');
    expect(useUsers.getState().byId.b?.isContact).toBe(false);
    expect(useChats.getState().byId.dm?.peer?.isContact).toBe(false);
  });

  it('drops responses that arrive after logout', async () => {
    let resolve!: (v: Contact[]) => void;
    vi.spyOn(api, 'get').mockReturnValue(new Promise((r) => (resolve = r)));
    const p = useContacts.getState().loadContacts();
    resetSessionState();
    resolve([contact('a', 'Ada')]);
    await p;
    expect(useContacts.getState().contacts).toEqual([]);
    expect(useContacts.getState().loaded).toBe(false);
  });
});
