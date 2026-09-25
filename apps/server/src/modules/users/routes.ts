import { Router } from 'express';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  USER_RATE_LIMITS,
  addContactSchema,
  deleteAccountSchema,
  directChatKey,
  idParamSchema,
  updateContactSchema,
  updateProfileSchema,
  updateSettingsSchema,
  userSearchQuerySchema,
  usernameParamsSchema,
  usersBatchSchema,
  type Contact,
  type UserSelf,
  type UserSettings,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { blocks, chats, contacts, users, type UserRow } from '../../db/schema.js';
import { authCtx, authUserId } from '../../http/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { authLimiter } from '../../lib/rateLimit.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { emitToUser } from '../../realtime/emit.js';
import { lockChats } from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { requireAvatarMedia } from '../../services/media.js';
import { rawRows, uniq } from '../../services/sql.js';
import { toChatSummaries } from '../../services/summaries.js';
import {
  isBlocked,
  loadPresences,
  loadUserSelf,
  requireUser,
  settingsOf,
  toUserPublic,
  toUserPublicMap,
  toUserPublics,
} from '../../services/users.js';
import { readReceiptsChanged } from '../../services/watermarks.js';
import { checkPassword, isUniqueViolation } from '../auth/service.js';
import { deleteAccount } from './account.js';
import { userChangedEffect } from './fanout.js';
import { reevaluatePresence } from './presence.js';
import { searchUserIds } from './search.js';

/**
 * Users module — owns: /me, /me/settings, /users/*, /contacts*, /blocks*.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth.
 * Normative rules: docs/ARCHITECTURE.md "Users, privacy and presence", "Accounts, sessions
 * and deletion" and the mutation → event matrix (PATCH /me, PATCH /me/settings, contacts,
 * blocks, DELETE /me). Literal `/users/*` paths are registered before `/users/:userId`.
 */
export const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `me:updated { user }` → user:<me>, with my profile as of the end of the transaction. */
function meUpdatedEffect(fx: Effects, userId: string): Effects {
  let user: UserSelf | null = null;
  return fx.add(
    () => {
      if (user) emitToUser(userId, 'me:updated', { user });
    },
    async (dbx) => {
      user = await loadUserSelf(dbx, userId);
    },
  );
}

/**
 * Lock my users row (profile/settings changes are serialized per user). `NO KEY UPDATE`: it
 * doesn't block FK checks (`KEY SHARE`) of concurrent inserts referencing me (e.g. my sends).
 */
async function lockMe(tx: DbOrTx, userId: string): Promise<UserRow> {
  const [row] = await tx.select().from(users).where(eq(users.id, userId)).for('no key update');
  if (!row || row.deletedAt) throw notFound('User');
  return row;
}

/** Register "re-evaluate these subjects' presence subscribers" after commit. */
function presenceEffect(fx: Effects, ...subjectIds: string[]): Effects {
  return fx.add(() => {
    for (const id of subjectIds) void reevaluatePresence(id);
  });
}

async function directChatId(dbx: DbOrTx, a: string, b: string): Promise<string | null> {
  const [row] = await dbx
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.directKey, directChatKey(a, b)))
    .limit(1);
  return row?.id ?? null;
}

async function toContacts(
  dbx: DbOrTx,
  ownerId: string,
  rows: { contactId: string; name: string | null; createdAt: Date }[],
): Promise<Contact[]> {
  const publics = await toUserPublicMap(
    dbx,
    ownerId,
    rows.map((r) => r.contactId),
  );
  const out: Contact[] = [];
  for (const r of rows) {
    const user = publics.get(r.contactId);
    if (user) out.push({ user, name: r.name, createdAt: r.createdAt.toISOString() });
  }
  return out;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

router.get('/me', async (req, res) => {
  res.json(await loadUserSelf(db, authUserId(req)));
});

/**
 * PATCH /me — displayName, about, avatar (own image upload or null), username, phone (null
 * removes it). Unchanged/omitted fields are ignored; with no change nothing is emitted.
 * Events: `me:updated` → me; `user:changed` → rooms of my direct/group chats + users who saved me.
 */
router.patch('/me', async (req, res) => {
  const me = authUserId(req);
  const body = parse(updateProfileSchema, req.body ?? {});
  const user = await transact(async (tx, fx) => {
    const row = await lockMe(tx, me);
    const patch: Partial<typeof users.$inferInsert> = {};
    if (body.displayName !== undefined && body.displayName !== row.displayName)
      patch.displayName = body.displayName;
    if (body.about !== undefined && body.about !== row.about) patch.about = body.about;
    if (body.avatarMediaId !== undefined && body.avatarMediaId !== row.avatarMediaId) {
      if (body.avatarMediaId) await requireAvatarMedia(tx, body.avatarMediaId, me);
      patch.avatarMediaId = body.avatarMediaId;
    }
    if (body.username !== undefined && body.username !== row.username) {
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, body.username))
        .limit(1);
      if (taken) throw conflict('This username is taken');
      patch.username = body.username;
    }
    if (body.phone !== undefined && body.phone !== row.phone) {
      if (body.phone) {
        const [used] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phone, body.phone))
          .limit(1);
        if (used) throw conflict('This phone number is already registered');
      }
      patch.phone = body.phone;
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, me));
      meUpdatedEffect(fx, me);
      userChangedEffect(fx, me);
    }
    return loadUserSelf(tx, me);
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, 'users_username_uq')) throw conflict('This username is taken');
    if (isUniqueViolation(err, 'users_phone_uq'))
      throw conflict('This phone number is already registered');
    throw err;
  });
  res.json(user);
});

/**
 * PATCH /me/settings — atomic merge (`settings || patch`). Status privacy lists keep only my
 * contacts (unknown ids dropped). Events (only for real changes): `me:updated` → me;
 * lastSeen/online visibility → presence re-evaluation; readReceipts → direct-chat
 * watermarks (`chat:watermarks` → me/peers whose value changed); profile photo/about
 * visibility → `user:changed` (others' view of me changed).
 */
router.patch('/me/settings', async (req, res) => {
  const me = authUserId(req);
  const body = parse(updateSettingsSchema, req.body ?? {});
  const settings = await transact(async (tx, fx) => {
    const row = await lockMe(tx, me);
    const prev = settingsOf(row);
    const patch: Partial<UserSettings> = { ...body };
    const listed = uniq([
      ...(patch.statusExcludeUserIds ?? []),
      ...(patch.statusOnlyShareWithUserIds ?? []),
    ]);
    if (listed.length) {
      const saved = new Set(
        (
          await tx
            .select({ id: contacts.contactId })
            .from(contacts)
            .where(and(eq(contacts.ownerId, me), inArray(contacts.contactId, listed)))
        ).map((r) => r.id),
      );
      const keep = (ids: string[] | undefined) =>
        ids ? uniq(ids).filter((id) => saved.has(id)) : undefined;
      if (patch.statusExcludeUserIds) patch.statusExcludeUserIds = keep(patch.statusExcludeUserIds);
      if (patch.statusOnlyShareWithUserIds)
        patch.statusOnlyShareWithUserIds = keep(patch.statusOnlyShareWithUserIds);
    }
    const next: UserSettings = { ...prev, ...patch };
    const changed = (Object.keys(patch) as (keyof UserSettings)[]).filter(
      (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
    );
    if (changed.length === 0) return next;

    await tx
      .update(users)
      .set({
        settings: sql`${users.settings} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, me));
    meUpdatedEffect(fx, me);
    if (changed.includes('lastSeenVisibility') || changed.includes('onlineVisibility'))
      presenceEffect(fx, me);
    if (changed.includes('readReceipts')) await readReceiptsChanged(tx, fx, me, prev.readReceipts);
    if (changed.includes('profilePhotoVisibility') || changed.includes('aboutVisibility'))
      userChangedEffect(fx, me);
    return next;
  });
  res.json(settings);
});

/** DELETE /me — password required (per-IP `authLimiter`: it verifies a password); soft delete (see account.ts). */
router.delete('/me', authLimiter, async (req, res) => {
  const { userId } = authCtx(req);
  const body = parse(deleteAccountSchema, req.body ?? {});
  const row = await requireUser(db, userId);
  if (!(await checkPassword(row, body.password))) throw forbidden('Incorrect password');
  await deleteAccount(userId);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Users (literal paths before /users/:userId)
// ---------------------------------------------------------------------------

router.get('/users/search', async (req, res) => {
  const me = authUserId(req);
  const { q } = parse(userSearchQuerySchema, req.query);
  assertUserLimit(me, 'userSearch', USER_RATE_LIMITS.userSearch);
  const ids = await searchUserIds(db, me, q);
  res.json(await toUserPublics(db, me, ids));
});

/** Exact username lookup; deleted accounts and users who blocked me are not found. */
router.get('/users/by-username/:username', async (req, res) => {
  const me = authUserId(req);
  const { username } = parse(usernameParamsSchema, req.params);
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), isNull(users.deletedAt)))
    .limit(1);
  if (!row || (row.id !== me && (await isBlocked(db, row.id, me)))) throw notFound('User');
  const user = await toUserPublic(db, me, row.id);
  if (!user) throw notFound('User');
  res.json(user);
});

/** Privacy-filtered profiles; unknown ids omitted, deleted users included (isDeleted). */
router.post('/users/batch', async (req, res) => {
  const me = authUserId(req);
  const { userIds } = parse(usersBatchSchema, req.body ?? {});
  res.json(await toUserPublics(db, me, userIds));
});

/** Per-viewer presence (same function as presence:subscribe); one entry per known id. */
router.post('/users/presence', async (req, res) => {
  const me = authUserId(req);
  const { userIds } = parse(usersBatchSchema, req.body ?? {});
  res.json(await loadPresences(db, me, userIds));
});

router.get('/users/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const user = await toUserPublic(db, me, userId);
  if (!user) throw notFound('User');
  res.json(user);
});

/**
 * Active regular groups both users are members of (never channels; community announcement
 * groups are excluded too — their member lists are admin-only), newest activity first.
 */
router.get('/users/:userId/common-groups', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  await requireUser(db, userId, { allowDeleted: true });
  const rows = await rawRows<{ id: string }>(
    db,
    sql`select c.id from chats c
        join chat_members a on a.chat_id = c.id and a.user_id = ${me} and a.left_at is null and not a.hidden
        join chat_members b on b.chat_id = c.id and b.user_id = ${userId} and b.left_at is null
        where c.type = 'group' and not c.is_announcement`,
  );
  const list = await toChatSummaries(
    db,
    me,
    rows.map((r) => r.id),
  );
  list.sort((x, y) =>
    x.lastActivityAt < y.lastActivityAt ? 1 : x.lastActivityAt > y.lastActivityAt ? -1 : 0,
  );
  res.json(list);
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

router.get('/contacts', async (req, res) => {
  const me = authUserId(req);
  const rows = await db
    .select({ contactId: contacts.contactId, name: contacts.name, createdAt: contacts.createdAt })
    .from(contacts)
    .where(eq(contacts.ownerId, me));
  const list = await toContacts(db, me, rows);
  list.sort(
    (a, b) =>
      collator.compare(a.name ?? a.user.displayName, b.name ?? b.user.displayName) ||
      collator.compare(a.user.username, b.user.username),
  );
  res.json(list);
});

/**
 * POST /contacts — by exactly one of userId / username / phone (+ optional saved name).
 * Rate-limited with user search. Deleted/unknown → 404; by username/phone also a user who
 * blocked me (like search and by-username: the block stays invisible); myself → 400.
 * Existing contact (also one added concurrently, e.g. a double tap): 200 (name updated when
 * given); new: 201.
 * Events (matrix): `contacts:changed` → me; new contact: `user:changed {me}` → them (their
 * view of me changed) and presence re-evaluation of my subscribers.
 */
router.post('/contacts', async (req, res) => {
  const me = authUserId(req);
  const body = parse(addContactSchema, req.body ?? {});
  assertUserLimit(me, 'userSearch', USER_RATE_LIMITS.userSearch);
  const where = body.userId
    ? eq(users.id, body.userId)
    : body.username
      ? eq(users.username, body.username)
      : eq(users.phone, body.phone!);
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(where, isNull(users.deletedAt)))
    .limit(1);
  if (!target) throw notFound('User');
  if (target.id === me) throw badRequest("You can't add yourself as a contact");
  if (!body.userId && (await isBlocked(db, target.id, me))) throw notFound('User');

  const result = await transact(async (tx, fx) => {
    const mine = and(eq(contacts.ownerId, me), eq(contacts.contactId, target.id));
    /** Existing contact: 200, with the saved name updated when given. */
    const keep = async (existing: typeof contacts.$inferSelect) => {
      if (body.name === undefined || body.name === existing.name)
        return { row: existing, created: false };
      const [row] = await tx.update(contacts).set({ name: body.name }).where(mine).returning();
      fx.toUser(me, 'contacts:changed', {});
      return { row: row!, created: false };
    };
    const [existing] = await tx.select().from(contacts).where(mine).for('update');
    if (existing) return keep(existing);
    const [row] = await tx
      .insert(contacts)
      .values({ ownerId: me, contactId: target.id, name: body.name ?? null })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      // Added concurrently (the unique index made us wait for it): idempotent, like above.
      const [added] = await tx.select().from(contacts).where(mine).for('update');
      if (!added) throw conflict('The contact changed, try again');
      return keep(added);
    }
    fx.toUser(me, 'contacts:changed', {}).toUser(target.id, 'user:changed', { userId: me });
    presenceEffect(fx, me);
    return { row, created: true };
  });
  const [contact] = await toContacts(db, me, [result.row]);
  if (!contact) throw notFound('User');
  res.status(result.created ? 201 : 200).json(contact);
});

/**
 * PATCH /contacts/:userId — rename (null = use their display name). Only `contacts:changed`
 * → me: the contact's view of me doesn't depend on the saved name.
 */
router.patch('/contacts/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const body = parse(updateContactSchema, req.body ?? {});
  const row = await transact(async (tx, fx) => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.ownerId, me), eq(contacts.contactId, userId)))
      .for('update');
    if (!existing) throw notFound('Contact');
    if (existing.name === body.name) return existing;
    const [updated] = await tx
      .update(contacts)
      .set({ name: body.name })
      .where(and(eq(contacts.ownerId, me), eq(contacts.contactId, userId)))
      .returning();
    fx.toUser(me, 'contacts:changed', {});
    return updated!;
  });
  const [contact] = await toContacts(db, me, [row]);
  if (!contact) throw notFound('Contact');
  res.json(contact);
});

router.delete('/contacts/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  await transact(async (tx, fx) => {
    const removed = await tx
      .delete(contacts)
      .where(and(eq(contacts.ownerId, me), eq(contacts.contactId, userId)))
      .returning({ id: contacts.contactId });
    if (removed.length === 0) throw notFound('Contact');
    fx.toUser(me, 'contacts:changed', {}).toUser(userId, 'user:changed', { userId: me });
    presenceEffect(fx, me);
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

router.get('/blocks', async (req, res) => {
  const me = authUserId(req);
  const rows = await db
    .select({ id: blocks.blockedId })
    .from(blocks)
    .where(eq(blocks.blockerId, me))
    .orderBy(desc(blocks.createdAt), asc(blocks.blockedId));
  res.json(
    await toUserPublics(
      db,
      me,
      rows.map((r) => r.id),
    ),
  );
});

/**
 * Block (idempotent: already blocked → 204 without events). Events (matrix):
 * `blocks:changed` → me; `chat:upsert` (our direct chat, if visible to me) → me;
 * `user:changed {me}` → them; presence re-evaluated both ways; domain `user.blocked`
 * (calls: forced leave of a live call between us). Our direct chat is locked first, which
 * serializes the block with a `call:start` in it: either the start sees the block, or the
 * block waits for the call to commit and the forced leave then finds it.
 */
router.put('/blocks/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  if (userId === me) throw badRequest("You can't block yourself");
  await requireUser(db, userId);
  await transact(async (tx, fx) => {
    const chatId = await directChatId(tx, me, userId);
    if (chatId) await lockChats(tx, [chatId]);
    const inserted = await tx
      .insert(blocks)
      .values({ blockerId: me, blockedId: userId })
      .onConflictDoNothing()
      .returning({ id: blocks.blockedId });
    if (inserted.length === 0) return;
    await blockChangedEffects(tx, fx, me, userId);
    fx.domain('user.blocked', { blockerId: me, blockedId: userId });
  });
  res.status(204).end();
});

/** Unblock (idempotent). Same events as blocking, without the call leave. */
router.delete('/blocks/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  await requireUser(db, userId, { allowDeleted: true });
  await transact(async (tx, fx) => {
    const removed = await tx
      .delete(blocks)
      .where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, userId)))
      .returning({ id: blocks.blockedId });
    if (removed.length === 0) return;
    await blockChangedEffects(tx, fx, me, userId);
  });
  res.status(204).end();
});

async function blockChangedEffects(
  tx: DbOrTx,
  fx: Effects,
  me: string,
  other: string,
): Promise<void> {
  fx.toUser(me, 'blocks:changed', {});
  const chatId = await directChatId(tx, me, other);
  if (chatId) fx.chatUpsert(me, chatId);
  fx.toUser(other, 'user:changed', { userId: me });
  presenceEffect(fx, me, other);
}
