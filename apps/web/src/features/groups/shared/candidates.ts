/**
 * People you can add to a group/community: saved contacts, people you chat with, and
 * (for 3+ characters or a phone number) server-side user search results. Pure helpers are
 * unit-tested; `useCandidates` wires them to the API/stores.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  USER_SEARCH_MIN_PREFIX,
  userDisplayName,
  type Contact,
  type ID,
  type UserPublic,
} from '@enbox/shared';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/lib/api';
import { getMyId } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUsers } from '@/stores/users';

export interface CandidateSection {
  id: 'contacts' | 'recent' | 'search';
  title: string;
  users: UserPublic[];
}

/** Case/diacritic-insensitive match on name, saved name and username. */
export function matchesUser(user: UserPublic, query: string): boolean {
  const q = normalize(query.replace(/^@/, ''));
  if (!q) return true;
  return [user.displayName, user.contactName ?? '', user.username].some((s) =>
    normalize(s).includes(q),
  );
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function byName(a: UserPublic, b: UserPublic): number {
  return userDisplayName(a).localeCompare(userDisplayName(b), undefined, { sensitivity: 'base' });
}

/** Whether a query is worth sending to `GET /api/users/search`. */
export function isRemoteQuery(query: string): boolean {
  const q = query.trim().replace(/^@/, '');
  if (/^\+?[\d\s\-().]{7,}$/.test(q)) return true;
  return q.length >= USER_SEARCH_MIN_PREFIX;
}

/**
 * Sections for the picker: contacts, then recent chat peers who aren't contacts, then search
 * results not already listed. Excludes me and deleted accounts; each user appears once.
 */
export function buildSections(input: {
  contacts: UserPublic[];
  peers: UserPublic[];
  results: UserPublic[];
  query: string;
  meId: ID | null;
}): CandidateSection[] {
  const seen = new Set<ID>();
  const take = (list: UserPublic[], filter: boolean) => {
    const out: UserPublic[] = [];
    for (const u of list) {
      if (seen.has(u.id) || u.id === input.meId || u.isDeleted) continue;
      if (filter && !matchesUser(u, input.query)) continue;
      seen.add(u.id);
      out.push(u);
    }
    return out;
  };
  const contacts = take([...input.contacts].sort(byName), true);
  const recent = take(input.peers, true);
  const search = take(input.results, false);
  const sections: CandidateSection[] = [];
  if (contacts.length) sections.push({ id: 'contacts', title: 'Contacts', users: contacts });
  if (recent.length) sections.push({ id: 'recent', title: 'Recent chats', users: recent });
  if (search.length) sections.push({ id: 'search', title: 'Other people on Enbox', users: search });
  return sections;
}

export interface CandidatesState {
  sections: CandidateSection[];
  loading: boolean;
  searching: boolean;
  error: string | null;
}

/** Candidates for a picker, filtered by `query`. */
export function useCandidates(query: string): CandidatesState {
  const [contacts, setContacts] = useState<UserPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const chats = useChats((s) => s.byId);
  const debounced = useDebouncedValue(query, 250);

  useEffect(() => {
    let alive = true;
    api
      .get<Contact[]>('/api/contacts')
      .then((list) => {
        if (!alive) return;
        const users = list.map((c) => c.user);
        useUsers.getState().upsertUsers(users);
        setContacts(users);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setContacts([]);
        setError(e instanceof Error ? e.message : 'Could not load contacts');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = debounced.trim();
    if (!isRemoteQuery(q)) {
      setResults([]);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    api
      .get<UserPublic[]>('/api/users/search', { query: { q }, signal: ctrl.signal })
      .then((users) => {
        useUsers.getState().upsertUsers(users);
        setResults(users);
      })
      .catch(() => setResults([]))
      .finally(() => {
        if (!ctrl.signal.aborted) setSearching(false);
      });
    return () => ctrl.abort();
  }, [debounced]);

  const peers = useMemo(() => {
    const list = Object.values(chats)
      .filter((c) => c.type === 'direct' && c.peer && !c.peer.isBlocked)
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
      .map((c) => c.peer!);
    return list;
  }, [chats]);

  const sections = useMemo(
    () =>
      buildSections({
        contacts: contacts ?? [],
        peers,
        results,
        query,
        meId: getMyId(),
      }),
    [contacts, peers, results, query],
  );

  return { sections, loading: contacts === null, searching, error };
}
