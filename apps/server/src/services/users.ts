/**
 * Users: rows, relationships (contacts/blocks in both directions), privacy-aware
 * serialization (`UserPublic`, `Presence`, `UserSelf`) and account scrubbing.
 *
 * Privacy (docs/ARCHITECTURE.md "Users, privacy and presence"), for viewer V and subject S:
 * - "contacts" = people S saved (S's contact rows); only S's settings apply (no reciprocity).
 * - avatar per `profilePhotoVisibility`, about per `aboutVisibility`, phone only if S saved V;
 * - S blocked V → avatar/about/phone/presence null (V never learns about the block);
 * - V blocked S → presence null (no block either way is required for presence), profile per
 *   settings, `isBlocked: true`;
 * - deleted S → `isDeleted: true`, name DELETED_ACCOUNT_NAME, everything optional null;
 * - V = S (self view) → everything visible.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  DELETED_ACCOUNT_NAME,
  DELETED_USERNAME_PREFIX,
  resolveUserSettings,
  type Presence,
  type UserPublic,
  type UserSelf,
  type UserSettings,
} from '@enbox/shared';
import type { DbOrTx, Tx } from '../db/index.js';
import { blocks, contacts, media, pushSubscriptions, sessions, statuses, users, type UserRow } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { isOnline } from '../realtime/presence.js';
import { mediaUrl } from './media.js';
import { pairKey, rawRows, uniq, uuidArray } from './sql.js';

/** A users row plus its avatar's storage key (left join on media). */
export type UserWithAvatar = UserRow & { avatarKey: string | null };

/** Complete settings of a user row (stored overrides merged over DEFAULT_USER_SETTINGS). */
export function settingsOf(row: Pick<UserRow, 'settings'>): UserSettings {
  return resolveUserSettings(row.settings);
}

/** Same as shared `resolveUserSettings` (kept for discoverability). */
export const resolveSettings = resolveUserSettings;

/** `deleted_` + first 12 hex chars of the id (docs "Account deletion"). */
export function deletedUsername(userId: string): string {
  return `${DELETED_USERNAME_PREFIX}${userId.replace(/-/g, '').slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** User rows (deleted included) with avatar keys, keyed by id. Unknown ids are absent. */
export async function getUserRows(dbx: DbOrTx, ids: Iterable<string>): Promise<Map<string, UserWithAvatar>> {
  const list = uniq(ids);
  const out = new Map<string, UserWithAvatar>();
  if (list.length === 0) return out;
  const rows = await dbx
    .select({ user: users, avatarKey: media.storageKey })
    .from(users)
    .leftJoin(media, eq(media.id, users.avatarMediaId))
    .where(inArray(users.id, list));
  for (const r of rows) out.set(r.user.id, { ...r.user, avatarKey: r.avatarKey });
  return out;
}

export async function getUserRow(dbx: DbOrTx, id: string): Promise<UserWithAvatar | null> {
  return (await getUserRows(dbx, [id])).get(id) ?? null;
}

/** The user row, or 404 when unknown (or deleted, unless `allowDeleted`). */
export async function requireUser(dbx: DbOrTx, id: string, opts: { allowDeleted?: boolean } = {}): Promise<UserWithAvatar> {
  const row = await getUserRow(dbx, id);
  if (!row || (row.deletedAt && !opts.allowDeleted)) throw notFound('User');
  return row;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/** How viewer V and subject S relate (both directions). */
export interface Relationship {
  /** V saved S as a contact (UserPublic.isContact). */
  viewerSavedSubject: boolean;
  /** The name V saved S under. */
  contactName: string | null;
  /** S saved V (drives S's "contacts" privacy levels and phone visibility). */
  subjectSavedViewer: boolean;
  /** V blocked S (UserPublic.isBlocked). */
  viewerBlockedSubject: boolean;
  /** S blocked V (never revealed to V). */
  subjectBlockedViewer: boolean;
}

export const NO_RELATIONSHIP: Readonly<Relationship> = Object.freeze({
  viewerSavedSubject: false,
  contactName: null,
  subjectSavedViewer: false,
  viewerBlockedSubject: false,
  subjectBlockedViewer: false,
});

export interface UserPair {
  viewerId: string;
  subjectId: string;
}

/**
 * Relationships for many (viewer, subject) pairs in two queries (contacts, blocks), each
 * matching both directions. Result keyed by `pairKey(viewerId, subjectId)`; pairs without
 * any row are absent (use NO_RELATIONSHIP).
 */
export async function loadRelationships(dbx: DbOrTx, pairs: UserPair[]): Promise<Map<string, Relationship>> {
  const out = new Map<string, Relationship>();
  const real = pairs.filter((p) => p.viewerId !== p.subjectId);
  if (real.length === 0) return out;
  const v = uuidArray(real.map((p) => p.viewerId));
  const s = uuidArray(real.map((p) => p.subjectId));

  const [contactRows, blockRows] = await Promise.all([
    rawRows<{ owner_id: string; contact_id: string; name: string | null }>(
      dbx,
      sql`select c.owner_id, c.contact_id, c.name from unnest(${v}, ${s}) as p(v, s)
          join contacts c on c.owner_id = p.v and c.contact_id = p.s
          union
          select c.owner_id, c.contact_id, c.name from unnest(${v}, ${s}) as p(v, s)
          join contacts c on c.owner_id = p.s and c.contact_id = p.v`,
    ),
    rawRows<{ blocker_id: string; blocked_id: string }>(
      dbx,
      sql`select b.blocker_id, b.blocked_id from unnest(${v}, ${s}) as p(v, s)
          join blocks b on b.blocker_id = p.v and b.blocked_id = p.s
          union
          select b.blocker_id, b.blocked_id from unnest(${v}, ${s}) as p(v, s)
          join blocks b on b.blocker_id = p.s and b.blocked_id = p.v`,
    ),
  ]);

  const contactOf = new Map<string, string | null>(); // owner|contact → name
  for (const r of contactRows) contactOf.set(pairKey(r.owner_id, r.contact_id), r.name);
  const blocked = new Set<string>(); // blocker|blocked
  for (const r of blockRows) blocked.add(pairKey(r.blocker_id, r.blocked_id));

  for (const { viewerId, subjectId } of real) {
    const vs = pairKey(viewerId, subjectId);
    const sv = pairKey(subjectId, viewerId);
    const rel: Relationship = {
      viewerSavedSubject: contactOf.has(vs),
      contactName: contactOf.get(vs) ?? null,
      subjectSavedViewer: contactOf.has(sv),
      viewerBlockedSubject: blocked.has(vs),
      subjectBlockedViewer: blocked.has(sv),
    };
    if (rel.viewerSavedSubject || rel.subjectSavedViewer || rel.viewerBlockedSubject || rel.subjectBlockedViewer) out.set(vs, rel);
  }
  return out;
}

/** Relationship between one viewer and one subject. */
export async function loadRelationship(dbx: DbOrTx, viewerId: string, subjectId: string): Promise<Relationship> {
  return (await loadRelationships(dbx, [{ viewerId, subjectId }])).get(pairKey(viewerId, subjectId)) ?? { ...NO_RELATIONSHIP };
}

/** `blockerId` has blocked `blockedId`. */
export async function isBlocked(dbx: DbOrTx, blockerId: string, blockedId: string): Promise<boolean> {
  const [row] = await dbx
    .select({ x: sql<number>`1` })
    .from(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
    .limit(1);
  return !!row;
}

/** A block exists between a and b in either direction. */
export async function blockedEitherWay(dbx: DbOrTx, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [row] = await dbx
    .select({ x: sql<number>`1` })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))))
    .limit(1);
  return !!row;
}

/** Those of `otherIds` with a block between them and `userId` in either direction. */
export async function blockedEitherWayIds(dbx: DbOrTx, userId: string, otherIds: Iterable<string>): Promise<Set<string>> {
  const others = uniq(otherIds).filter((id) => id !== userId);
  if (others.length === 0) return new Set();
  const rows = await dbx
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, userId), inArray(blocks.blockedId, others)),
        and(eq(blocks.blockedId, userId), inArray(blocks.blockerId, others)),
      ),
    );
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

/** Those of `blockerIds` who blocked `userId` (e.g. direct-chat recipients who withhold my messages). */
export async function blockersOf(dbx: DbOrTx, userId: string, blockerIds: Iterable<string>): Promise<Set<string>> {
  const list = uniq(blockerIds).filter((id) => id !== userId);
  if (list.length === 0) return new Set();
  const rows = await dbx
    .select({ id: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockedId, userId), inArray(blocks.blockerId, list)));
  return new Set(rows.map((r) => r.id));
}

/** `ownerId` saved `userId` as a contact ("contacts" privacy levels are evaluated this way round: owner = subject). */
export async function isContactOf(dbx: DbOrTx, ownerId: string, userId: string): Promise<boolean> {
  const [row] = await dbx
    .select({ x: sql<number>`1` })
    .from(contacts)
    .where(and(eq(contacts.ownerId, ownerId), eq(contacts.contactId, userId)))
    .limit(1);
  return !!row;
}

/** Those of `ownerIds` who saved `userId` as a contact. */
export async function ownersWhoSaved(dbx: DbOrTx, userId: string, ownerIds: Iterable<string>): Promise<Set<string>> {
  const list = uniq(ownerIds);
  if (list.length === 0) return new Set();
  const rows = await dbx
    .select({ id: contacts.ownerId })
    .from(contacts)
    .where(and(eq(contacts.contactId, userId), inArray(contacts.ownerId, list)));
  return new Set(rows.map((r) => r.id));
}

/** Ids of every user who saved `userId` as a contact (e.g. `user:changed` fan-out after PATCH /me). */
export async function usersWhoSaved(dbx: DbOrTx, userId: string): Promise<string[]> {
  const rows = await dbx.select({ id: contacts.ownerId }).from(contacts).where(eq(contacts.contactId, userId));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Privacy & serialization
// ---------------------------------------------------------------------------

function levelAllows(level: 'everyone' | 'contacts' | 'nobody', rel: Relationship): boolean {
  return level === 'everyone' || (level === 'contacts' && rel.subjectSavedViewer);
}

/**
 * Presence visibility for viewer V and subject S (docs "Presence"):
 * canSeeLastSeen = no block either way and (lastSeen = everyone or (contacts and S saved V));
 * canSeeOnline = no block and (online = everyone or canSeeLastSeen). Self: both true;
 * deleted subjects: both false.
 */
export function canSeePresence(
  viewerId: string,
  subject: Pick<UserRow, 'id' | 'settings' | 'deletedAt'>,
  rel: Relationship,
): { canSeeOnline: boolean; canSeeLastSeen: boolean } {
  if (subject.deletedAt) return { canSeeOnline: false, canSeeLastSeen: false };
  if (viewerId === subject.id) return { canSeeOnline: true, canSeeLastSeen: true };
  if (rel.viewerBlockedSubject || rel.subjectBlockedViewer) return { canSeeOnline: false, canSeeLastSeen: false };
  const s = settingsOf(subject);
  const canSeeLastSeen = levelAllows(s.lastSeenVisibility, rel);
  const canSeeOnline = s.onlineVisibility === 'everyone' || canSeeLastSeen;
  return { canSeeOnline, canSeeLastSeen };
}

/** Per-viewer presence (hidden = `{ online: null, lastSeenAt: null }`). Online = ≥ 1 socket on this instance. */
export function buildPresence(viewerId: string, subject: Pick<UserRow, 'id' | 'settings' | 'deletedAt' | 'lastSeenAt'>, rel: Relationship): Presence {
  const { canSeeOnline, canSeeLastSeen } = canSeePresence(viewerId, subject, rel);
  const online = isOnline(subject.id);
  return {
    userId: subject.id,
    online: canSeeOnline ? online : null,
    lastSeenAt: canSeeLastSeen && !online && subject.lastSeenAt ? subject.lastSeenAt.toISOString() : null,
  };
}

/** Pure: a subject row + relationship → the viewer's UserPublic (all privacy rules). */
export function buildUserPublic(viewerId: string, subject: UserWithAvatar, rel: Relationship = NO_RELATIONSHIP): UserPublic {
  if (subject.deletedAt) {
    return {
      id: subject.id,
      username: subject.username,
      displayName: DELETED_ACCOUNT_NAME,
      avatarUrl: null,
      about: null,
      phone: null,
      online: null,
      lastSeenAt: null,
      isContact: false,
      contactName: null,
      isBlocked: false,
      isDeleted: true,
    };
  }
  const self = viewerId === subject.id;
  const s = settingsOf(subject);
  const hiddenByBlock = !self && rel.subjectBlockedViewer;
  const avatarUrl = subject.avatarKey && (self || (!hiddenByBlock && levelAllows(s.profilePhotoVisibility, rel))) ? mediaUrl(subject.avatarKey) : null;
  const about = self || (!hiddenByBlock && levelAllows(s.aboutVisibility, rel)) ? subject.about : null;
  const phone = self || (!hiddenByBlock && rel.subjectSavedViewer) ? subject.phone : null;
  const presence = buildPresence(viewerId, subject, rel);
  return {
    id: subject.id,
    username: subject.username,
    displayName: subject.displayName,
    avatarUrl,
    about,
    phone,
    online: presence.online,
    lastSeenAt: presence.lastSeenAt,
    isContact: rel.viewerSavedSubject,
    contactName: rel.contactName,
    isBlocked: !self && rel.viewerBlockedSubject,
    isDeleted: false,
  };
}

/**
 * UserPublic for many (viewer, subject) pairs: 3 queries (users, contacts, blocks) whatever
 * the number of pairs. Pass `rows` to reuse already loaded subject rows. Keyed by
 * `pairKey(viewerId, subjectId)`; unknown subjects are absent.
 */
export async function toUserPublicsForPairs(
  dbx: DbOrTx,
  pairs: UserPair[],
  rows?: Map<string, UserWithAvatar>,
): Promise<Map<string, UserPublic>> {
  const out = new Map<string, UserPublic>();
  if (pairs.length === 0) return out;
  const missing = uniq(pairs.map((p) => p.subjectId)).filter((id) => !rows?.has(id));
  const loaded = missing.length ? await getUserRows(dbx, missing) : new Map<string, UserWithAvatar>();
  const rowOf = (id: string) => rows?.get(id) ?? loaded.get(id);
  const known = pairs.filter((p) => rowOf(p.subjectId));
  const rels = await loadRelationships(dbx, known);
  for (const p of known) {
    const key = pairKey(p.viewerId, p.subjectId);
    out.set(key, buildUserPublic(p.viewerId, rowOf(p.subjectId)!, rels.get(key) ?? NO_RELATIONSHIP));
  }
  return out;
}

/** Viewer-specific UserPublic map for `ids` (unknown ids absent, deleted users included). */
export async function toUserPublicMap(dbx: DbOrTx, viewerId: string, ids: Iterable<string>): Promise<Map<string, UserPublic>> {
  const list = uniq(ids);
  const byPair = await toUserPublicsForPairs(
    dbx,
    list.map((subjectId) => ({ viewerId, subjectId })),
  );
  const out = new Map<string, UserPublic>();
  for (const id of list) {
    const u = byPair.get(pairKey(viewerId, id));
    if (u) out.set(id, u);
  }
  return out;
}

/** `toUserPublics(dbx, viewerId, userIds)` (docs): UserPublic[] in input order, unknown ids omitted. */
export async function toUserPublics(dbx: DbOrTx, viewerId: string, ids: Iterable<string>): Promise<UserPublic[]> {
  const map = await toUserPublicMap(dbx, viewerId, ids);
  return [...map.values()];
}

export async function toUserPublic(dbx: DbOrTx, viewerId: string, id: string): Promise<UserPublic | null> {
  return (await toUserPublicMap(dbx, viewerId, [id])).get(id) ?? null;
}

/** Per-viewer presence for `ids` (unknown ids omitted) — `POST /users/presence`, `presence:subscribe` acks and emits. */
export async function loadPresences(dbx: DbOrTx, viewerId: string, ids: Iterable<string>): Promise<Presence[]> {
  const list = uniq(ids);
  const rows = await getUserRows(dbx, list);
  const known = list.filter((id) => rows.has(id));
  const rels = await loadRelationships(
    dbx,
    known.map((subjectId) => ({ viewerId, subjectId })),
  );
  return known.map((id) => buildPresence(viewerId, rows.get(id)!, rels.get(pairKey(viewerId, id)) ?? NO_RELATIONSHIP));
}

/** The signed-in user's own profile. */
export function toUserSelf(row: UserWithAvatar): UserSelf {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarKey ? mediaUrl(row.avatarKey) : null,
    about: row.about,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    settings: settingsOf(row),
  };
}

export async function loadUserSelf(dbx: DbOrTx, userId: string): Promise<UserSelf> {
  return toUserSelf(await requireUser(dbx, userId));
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/**
 * Steps (3) + (4) of account deletion (docs "Accounts, sessions and deletion"): delete
 * sessions, push subscriptions, contacts and blocks (both directions) and statuses, then
 * scrub the row. Run inside the deletion transaction AFTER the membership pipeline (steps
 * 1–2: forced call leave, groups/communities/channels). Returns the revoked session ids
 * (after commit: `invalidateSessions(ids)`, then `disconnectUser`). `keepStatuses`: leave the
 * statuses for the account-deletion hooks (the status module fans out `status:deleted`);
 * the caller deletes the rest afterwards.
 */
export async function scrubDeletedUser(tx: Tx, userId: string, opts: { keepStatuses?: boolean } = {}): Promise<{ sessionIds: string[] }> {
  const revoked = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await tx.delete(contacts).where(or(eq(contacts.ownerId, userId), eq(contacts.contactId, userId)));
  await tx.delete(blocks).where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  if (!opts.keepStatuses) await tx.delete(statuses).where(eq(statuses.userId, userId));
  await tx
    .update(users)
    .set({
      username: deletedUsername(userId),
      displayName: DELETED_ACCOUNT_NAME,
      phone: null,
      about: '',
      avatarMediaId: null,
      passwordHash: '!',
      settings: {},
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return { sessionIds: revoked.map((r) => r.id) };
}
