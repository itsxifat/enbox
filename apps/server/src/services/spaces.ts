/**
 * Spaces core (docs/design/spaces-at-scale.md): serializers, membership transitions, audit
 * log, and the post-commit fan-out helpers. Route handlers live in modules/spaces/.
 *
 * Lock order: spaces (this Space) → chats (its channels, sorted) → everything else.
 */
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  ASSIGNABLE_PERMISSIONS,
  CHANNEL_NAME_MAX_LENGTH,
  CHANNEL_TOPIC_MAX_LENGTH,
  DEFAULT_EVERYONE_PERMISSIONS,
  DEFAULT_FORUM_SETTINGS,
  LARGE_SPACE_THRESHOLD,
  MAX_SPACE_CATEGORIES,
  MAX_SPACE_CHANNELS,
  MAX_SPACE_ROLES,
  MAX_VOICE_CHANNEL_PARTICIPANTS,
  PERM,
  ROLE_NAME_MAX_LENGTH,
  SPACE_UNREAD_CAP,
  hasPerm,
  normalizeTextChannelName,
  resolveUserSettings,
  rooms,
  type PermissionOverwrite,
  type SpaceTemplateSnapshot,
  type TemplateOverwrite,
  type Space,
  type SpaceAuditEntry,
  type SpaceCategory,
  type SpaceInfoChanges,
  type SpaceMember,
  type SpaceProfile,
  type SpaceRemovedReason,
  type SpaceRole,
} from '@enbox/shared';
import type { DbOrTx, Tx } from '../db/index.js';
import {
  chatMembers,
  chats,
  media,
  spaceAuditLog,
  spaceCategories,
  spaceCategoryOverwrites,
  spaceChannelOverwrites,
  spaceEventInterests,
  spaceEvents,
  spaceMemberRoles,
  spaceMembers,
  spaceRoles,
  spaces,
  users,
  type MediaRow,
  type SpaceMemberRow,
  type SpaceRoleRow,
  type SpaceRow,
} from '../db/schema.js';
import { runSpaceMemberJoined, runSpaceMemberLeft } from './spaceMemberHooks.js';
import { emitToRooms, emitToUser } from '../realtime/emit.js';
import {
  spaceDeleted,
  spaceMemberChanged,
  spaceMemberJoined,
  spaceMemberLeft,
  spaceStructureChanged,
} from '../realtime/spaceRegistry.js';
import type { Effects } from './effects.js';
import { loadMediaMap, mediaUrl, staticMediaUrl } from './media.js';
import {
  baseBits,
  channelBits,
  loadChannelOverwrites,
  loadSpacePermCtx,
  type MemberCtx,
  type SpacePermCtx,
} from './spaceAccess.js';
import { pairKey, rawRows, uniq, uuidArray } from './sql.js';

// ---------------------------------------------------------------------------
// Small serializers
// ---------------------------------------------------------------------------

/** Media rows by id (the images of per-Space profiles and role icons). */
export type MediaById = ReadonlyMap<string, MediaRow>;

/** The media ids a serializer of these roles needs (`toSpaceRole`'s `media`). */
export function roleMediaIds(roles: readonly Pick<SpaceRoleRow, 'iconMediaId'>[]): string[] {
  return roles.map((r) => r.iconMediaId).filter((x): x is string => !!x);
}

/** The media ids a serializer of these members needs (`toSpaceMember`'s `media`). */
export function memberMediaIds(
  rows: readonly Pick<SpaceMemberRow, 'avatarMediaId' | 'bannerMediaId'>[],
): string[] {
  return rows.flatMap((m) => [m.avatarMediaId, m.bannerMediaId]).filter((x): x is string => !!x);
}

/**
 * A role on the wire. Name style: `solid` uses `color`; `gradient` runs `color` →
 * `colorSecondary` (both required by the routes); `holographic` is drawn by the client from
 * its own palette — the colours are kept and serve as the fallback (mention pills, older
 * clients). The icon image (static, `iconUrl`) wins over `iconEmoji`; `media` must hold the
 * icon's row (else `iconUrl` is null).
 */
export function toSpaceRole(r: SpaceRoleRow, media?: MediaById): SpaceRole {
  const icon = r.iconMediaId ? media?.get(r.iconMediaId) : undefined;
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
    permissions: r.permissions,
    hoist: r.hoist,
    mentionable: r.mentionable,
    isDefault: r.isDefault,
    colorStyle: r.colorStyle,
    colorSecondary: r.colorSecondary,
    iconUrl: icon ? staticMediaUrl(icon) : null,
    iconEmoji: r.iconEmoji,
  };
}

/** A Space's roles in position order, icons resolved (two queries). */
export async function loadSpaceRoles(dbx: DbOrTx, spaceId: string): Promise<SpaceRole[]> {
  const rows = await dbx
    .select()
    .from(spaceRoles)
    .where(eq(spaceRoles.spaceId, spaceId))
    .orderBy(asc(spaceRoles.position));
  const mediaById = await loadMediaMap(dbx, roleMediaIds(rows));
  return rows.map((r) => toSpaceRole(r, mediaById));
}

/**
 * Per-Space profile overrides of a member row (null = the main profile). The images follow the
 * user profile's split: `*Url` is the static image (the poster of an animated upload), the
 * animated original travels as `*AnimatedUrl`. Visible to every member of the Space (the
 * user's own privacy settings govern the main profile only). `media` must hold the rows of
 * `avatarMediaId` / `bannerMediaId` (`memberMediaIds`), else those URLs are null.
 */
export function toSpaceProfile(m: SpaceMemberRow, media?: MediaById): Required<SpaceProfile> {
  const avatar = m.avatarMediaId ? media?.get(m.avatarMediaId) : undefined;
  const banner = m.bannerMediaId ? media?.get(m.bannerMediaId) : undefined;
  return {
    avatarUrl: avatar ? staticMediaUrl(avatar) : null,
    avatarAnimatedUrl: avatar?.animated ? mediaUrl(avatar.storageKey) : null,
    bannerUrl: banner ? staticMediaUrl(banner) : null,
    bannerAnimatedUrl: banner?.animated ? mediaUrl(banner.storageKey) : null,
    bio: m.bio,
    pronouns: m.pronouns,
    profileColor: m.profileColor,
    accentColor: m.accentColor,
    avatarDecoration: m.avatarDecoration,
    profileEffect: m.profileEffect,
    nameplate: m.nameplate,
  };
}

export function toSpaceMember(m: SpaceMemberRow, roleIds: string[], media?: MediaById): SpaceMember {
  return {
    userId: m.userId,
    nickname: m.nickname,
    roleIds,
    joinedAt: m.joinedAt.toISOString(),
    timedOutUntil:
      m.timedOutUntil && m.timedOutUntil.getTime() > Date.now()
        ? m.timedOutUntil.toISOString()
        : null,
    serverMute: m.serverMute,
    serverDeaf: m.serverDeaf,
    ...toSpaceProfile(m, media),
  };
}

/** Members on the wire, their profile images loaded in one query. */
export async function toSpaceMembers(
  dbx: DbOrTx,
  list: readonly { member: SpaceMemberRow; roleIds: string[] }[],
): Promise<SpaceMember[]> {
  const mediaById = await loadMediaMap(
    dbx,
    memberMediaIds(list.map((m) => m.member)),
  );
  return list.map((m) => toSpaceMember(m.member, m.roleIds, mediaById));
}

/** `space_members.sort_name`: the member list order. */
export function sortNameOf(nickname: string | null, displayName: string): string {
  return (nickname?.trim() || displayName).toLowerCase().slice(0, 100);
}

/** Categories of Spaces with their overwrite templates, keyed by Space id. */
export async function loadCategories(
  dbx: DbOrTx,
  spaceIds: readonly string[],
): Promise<Map<string, SpaceCategory[]>> {
  const out = new Map<string, SpaceCategory[]>();
  for (const id of spaceIds) out.set(id, []);
  if (spaceIds.length === 0) return out;
  const rows = await dbx
    .select()
    .from(spaceCategories)
    .where(inArray(spaceCategories.spaceId, [...spaceIds]))
    .orderBy(asc(spaceCategories.position), asc(spaceCategories.createdAt));
  const overwrites = rows.length
    ? await dbx
        .select()
        .from(spaceCategoryOverwrites)
        .where(
          inArray(
            spaceCategoryOverwrites.categoryId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  const owBy = new Map<string, PermissionOverwrite[]>();
  for (const o of overwrites)
    owBy.set(o.categoryId, [
      ...(owBy.get(o.categoryId) ?? []),
      { targetType: o.targetType, targetId: o.targetId, allow: o.allow, deny: o.deny },
    ]);
  for (const r of rows)
    out.get(r.spaceId)?.push({
      id: r.id,
      name: r.name,
      position: r.position,
      overwrites: owBy.get(r.id) ?? [],
    });
  return out;
}

// ---------------------------------------------------------------------------
// Space serializer (viewer-specific)
// ---------------------------------------------------------------------------

/**
 * `Space` objects for a member (the Spaces they are not a member of are omitted). Without
 * `spaceIds`: all their Spaces, by name. A fixed number of queries; the unread/mention
 * aggregates look only at channels with activity after the member's read position.
 */
export async function toSpaces(
  dbx: DbOrTx,
  viewerId: string,
  spaceIds?: readonly string[],
): Promise<Space[]> {
  if (spaceIds && spaceIds.length === 0) return [];
  const memberRows = await dbx
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.userId, viewerId),
        spaceIds ? inArray(spaceMembers.spaceId, [...spaceIds]) : undefined,
      ),
    );
  if (memberRows.length === 0) return [];
  const ids = memberRows.map((m) => m.spaceId);
  const roleRows = await dbx
    .select({ spaceId: spaceMemberRoles.spaceId, roleId: spaceMemberRoles.roleId })
    .from(spaceMemberRoles)
    .where(and(eq(spaceMemberRoles.userId, viewerId), inArray(spaceMemberRoles.spaceId, ids)));
  const myRoles = new Map<string, string[]>();
  for (const r of roleRows) myRoles.set(r.spaceId, [...(myRoles.get(r.spaceId) ?? []), r.roleId]);

  const spaceRows = await dbx.select().from(spaces).where(inArray(spaces.id, ids));
  const categories = await loadCategories(dbx, ids);
  const ctxs = new Map<string, SpacePermCtx>();
  for (const id of ids) {
    const ctx = await loadSpacePermCtx(dbx, id);
    if (ctx) ctxs.set(id, ctx);
  }
  // One media query: Space icons/banners, my per-Space profile images, role icons.
  const mediaIds = uniq([
    ...spaceRows.flatMap((s) => [s.iconMediaId, s.bannerMediaId]).filter((x): x is string => !!x),
    ...memberMediaIds(memberRows),
    ...[...ctxs.values()].flatMap((c) => roleMediaIds(c.roles)),
  ]);
  const mediaRows = mediaIds.length
    ? await dbx.select().from(media).where(inArray(media.id, mediaIds))
    : [];
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

  // Unread channels: activity after my read position (row) or my join (no row), not muted.
  const unreadRows = await rawRows<{ space_id: string; chat_id: string; type: string }>(
    dbx,
    sql`select ch.space_id, ch.id as chat_id, ch.type
        from space_members sm
        join chats ch on ch.space_id = sm.space_id and ch.type = 'space_text'
        left join chat_members cm on cm.chat_id = ch.id and cm.user_id = sm.user_id
        where sm.user_id = ${viewerId} and sm.space_id = any(${uuidArray(ids)})
          and ch.last_message_at is not null
          and (case when cm.chat_id is not null then ch.last_seq > cm.last_read_seq
                    else ch.last_message_at > sm.joined_at end)`,
  );
  const overwrites = await loadChannelOverwrites(
    dbx,
    unreadRows.map((r) => r.chat_id),
  );
  const memberBy = new Map(memberRows.map((m) => [m.spaceId, m]));
  const visibleUnread: { spaceId: string; chatId: string }[] = [];
  for (const r of unreadRows) {
    const ctx = ctxs.get(r.space_id);
    const m = memberBy.get(r.space_id);
    if (!ctx || !m) continue;
    const mc: MemberCtx = { member: m, roleIds: myRoles.get(r.space_id) ?? [] };
    const bits = channelBits(ctx, viewerId, mc, 'space_text', overwrites.get(r.chat_id) ?? []);
    if (hasPerm(bits, PERM.VIEW_CHANNEL))
      visibleUnread.push({ spaceId: r.space_id, chatId: r.chat_id });
  }
  const mentionCounts = new Map<string, number>();
  if (visibleUnread.length) {
    const rows = await rawRows<{ chat_id: string; n: number }>(
      dbx,
      sql`select p.c as chat_id, mc.n
          from unnest(${uuidArray(visibleUnread.map((v) => v.chatId))}) as p(c)
          join chats ch on ch.id = p.c
          join space_members sm on sm.space_id = ch.space_id and sm.user_id = ${viewerId}
          left join chat_members cm on cm.chat_id = p.c and cm.user_id = ${viewerId}
          cross join lateral (
            select count(*)::int as n from (
              select 1 from messages m
              where m.chat_id = p.c
                and (m.mention_everyone or m.mentions <> '{}'::uuid[] or m.mention_role_ids <> '{}'::uuid[])
                and (case when cm.chat_id is not null then m.seq > cm.last_read_seq else m.created_at > sm.joined_at end)
                and m.sender_id is distinct from ${viewerId} and m.deleted_at is null
                and (${viewerId} = any(m.mentions)
                     or (m.mention_everyone and not sm.suppress_everyone)
                     or (not sm.suppress_roles and m.mention_role_ids && coalesce(
                          (select array_agg(r.role_id) from space_member_roles r
                           where r.space_id = ch.space_id and r.user_id = ${viewerId}), '{}'::uuid[])))
              order by m.seq desc limit ${SPACE_UNREAD_CAP}
            ) x
          ) mc
          where mc.n > 0`,
    );
    const spaceOf = new Map(visibleUnread.map((v) => [v.chatId, v.spaceId]));
    for (const r of rows) {
      const s = spaceOf.get(r.chat_id)!;
      mentionCounts.set(s, Math.min(SPACE_UNREAD_CAP, (mentionCounts.get(s) ?? 0) + Number(r.n)));
    }
  }
  const unreadSpaces = new Set(visibleUnread.map((v) => v.spaceId));

  const out: Space[] = [];
  for (const s of spaceRows) {
    const m = memberBy.get(s.id);
    const ctx = ctxs.get(s.id);
    if (!m || !ctx) continue;
    const roleIds = myRoles.get(s.id) ?? [];
    const base = baseBits(ctx, viewerId, { member: m, roleIds });
    const icon = s.iconMediaId ? mediaById.get(s.iconMediaId) : undefined;
    const banner = s.bannerMediaId ? mediaById.get(s.bannerMediaId) : undefined;
    out.push({
      id: s.id,
      name: s.name,
      description: s.description,
      iconUrl: icon ? staticMediaUrl(icon) : null,
      iconAnimatedUrl: icon?.animated ? mediaUrl(icon.storageKey) : null,
      bannerUrl: banner ? staticMediaUrl(banner) : null,
      ownerId: s.ownerId,
      memberCount: s.memberCount,
      large: s.memberCount > LARGE_SPACE_THRESHOLD,
      systemChannelId: s.systemChannelId,
      rulesChannelId: s.rulesChannelId,
      afkChannelId: s.afkChannelId,
      afkTimeoutSec: s.afkTimeoutSec,
      defaultNotifyLevel: s.defaultNotifyLevel,
      systemFlags: s.systemFlags,
      verificationLevel: s.verificationLevel,
      explicitFilter: s.explicitFilter,
      isDiscoverable: s.isDiscoverable,
      vanityCode: hasPerm(base, PERM.MANAGE_SPACE) ? s.vanityCode : null,
      createdAt: s.createdAt.toISOString(),
      roles: ctx.roles.map((r) => toSpaceRole(r, mediaById)),
      categories: categories.get(s.id) ?? [],
      me: {
        ...toSpaceProfile(m, mediaById),
        roleIds,
        nickname: m.nickname,
        joinedAt: m.joinedAt.toISOString(),
        timedOutUntil:
          m.timedOutUntil && m.timedOutUntil.getTime() > Date.now()
            ? m.timedOutUntil.toISOString()
            : null,
        serverMute: m.serverMute,
        serverDeaf: m.serverDeaf,
        notifyLevel: m.notifyLevel,
        mutedUntil: m.mutedUntil?.toISOString() ?? null,
        suppressEveryone: m.suppressEveryone,
        suppressRoles: m.suppressRoles,
        hideMutedChannels: m.hideMutedChannels,
        onboardedAt: m.onboardedAt?.toISOString() ?? null,
        allowDms: m.allowDms,
      },
      myPermissions: base,
      unread: unreadSpaces.has(s.id),
      unreadMentionCount: mentionCounts.get(s.id) ?? 0,
    });
  }
  const order = spaceIds ? new Map(spaceIds.map((id, i) => [id, i])) : null;
  return out.sort((a, b) =>
    order ? order.get(a.id)! - order.get(b.id)! : a.name.localeCompare(b.name),
  );
}

export async function toSpace(
  dbx: DbOrTx,
  viewerId: string,
  spaceId: string,
): Promise<Space | null> {
  return (await toSpaces(dbx, viewerId, [spaceId]))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Fan-out helpers (register in Effects; they run after commit)
// ---------------------------------------------------------------------------

/** `space:upsert` → user:<u> with u's Space as of the end of the transaction. */
export function fxSpaceUpsert(
  fx: Effects,
  userIds: string | readonly string[],
  spaceId: string,
): void {
  const ids = typeof userIds === 'string' ? [userIds] : [...userIds];
  const out = new Map<string, Space>();
  fx.add(
    () => {
      for (const userId of ids) {
        const space = out.get(userId);
        if (space) emitToUser(userId, 'space:upsert', { space });
      }
    },
    async (dbx) => {
      for (const userId of ids) {
        const space = await toSpace(dbx, userId, spaceId);
        if (space) out.set(userId, space);
      }
    },
  );
}

/**
 * `space:updated` changes, plus the Space options that `SpaceInfoChanges` (events.ts) does not
 * list yet; clients shallow-merge whatever arrives into `Space`.
 */
export type SpaceSettingsChanges = SpaceInfoChanges &
  Partial<Pick<Space, 'systemFlags' | 'verificationLevel' | 'explicitFilter'>>;

/** `space:updated` → space:<id> (viewer-neutral changes). */
export function fxSpaceUpdated(fx: Effects, spaceId: string, changes: SpaceSettingsChanges): void {
  fx.add(() => emitToRooms([rooms.space(spaceId)], 'space:updated', { spaceId, changes }));
}

/** Roles as of the end of the transaction → `space:updated { roles }`. */
export function fxRolesChanged(fx: Effects, spaceId: string): void {
  let roles: SpaceRole[] = [];
  fx.add(
    () => emitToRooms([rooms.space(spaceId)], 'space:updated', { spaceId, changes: { roles } }),
    async (dbx) => {
      roles = await loadSpaceRoles(dbx, spaceId);
    },
  );
}

/** Categories as of the end of the transaction → `space:updated { categories }`. */
export function fxCategoriesChanged(fx: Effects, spaceId: string): void {
  let categories: SpaceCategory[] = [];
  fx.add(
    () =>
      emitToRooms([rooms.space(spaceId)], 'space:updated', { spaceId, changes: { categories } }),
    async (dbx) => {
      categories = (await loadCategories(dbx, [spaceId])).get(spaceId) ?? [];
    },
  );
}

/** Channels created/deleted/reordered or visibility changed: members refetch (with jitter). */
export function fxChannelsChanged(fx: Effects, spaceId: string, userId?: string): void {
  fx.add(() =>
    userId
      ? emitToUser(userId, 'space:channels-changed', { spaceId })
      : emitToRooms([rooms.space(spaceId)], 'space:channels-changed', { spaceId }),
  );
}

/** Every process reloads the Space's structure (after commit). */
export function fxStructureChanged(fx: Effects, spaceId: string): void {
  fx.add(() => spaceStructureChanged(spaceId));
}

/** Every process reloads one member (after commit). */
export function fxMemberChanged(fx: Effects, spaceId: string, userId: string): void {
  fx.add(() => spaceMemberChanged(spaceId, userId));
}

/**
 * Member list event: small Spaces → the Space room, large ones → the sockets with the member
 * list open (`space:members-subscribe`).
 */
export function fxMemberEvent(
  fx: Effects,
  space: Pick<SpaceRow, 'id' | 'memberCount'>,
  build: () =>
    | { event: 'space:member-joined' | 'space:member-updated'; member: SpaceMember }
    | { event: 'space:member-left'; userId: string },
): void {
  const room =
    space.memberCount > LARGE_SPACE_THRESHOLD
      ? rooms.spaceMembers(space.id)
      : rooms.space(space.id);
  fx.add(() => {
    const e = build();
    if (e.event === 'space:member-left')
      emitToRooms([room], 'space:member-left', { spaceId: space.id, userId: e.userId });
    else emitToRooms([room], e.event, { spaceId: space.id, member: e.member });
  });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function audit(
  tx: DbOrTx,
  entry: {
    spaceId: string;
    actorId: string | null;
    action: string;
    targetType?: SpaceAuditEntry['targetType'];
    targetId?: string | null;
    changes?: Record<string, unknown> | null;
    reason?: string | null;
  },
): Promise<void> {
  await tx.insert(spaceAuditLog).values({
    spaceId: entry.spaceId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    changes: entry.changes ?? null,
    reason: entry.reason ?? null,
  });
}

export async function auditEntries(
  dbx: DbOrTx,
  spaceId: string,
  q: { before?: string; action?: string; actorId?: string; limit: number },
): Promise<SpaceAuditEntry[]> {
  let beforeAt: Date | undefined;
  if (q.before) {
    const [b] = await dbx
      .select({ at: spaceAuditLog.createdAt })
      .from(spaceAuditLog)
      .where(and(eq(spaceAuditLog.id, q.before), eq(spaceAuditLog.spaceId, spaceId)))
      .limit(1);
    beforeAt = b?.at;
  }
  const rows = await dbx
    .select()
    .from(spaceAuditLog)
    .where(
      and(
        eq(spaceAuditLog.spaceId, spaceId),
        beforeAt ? lt(spaceAuditLog.createdAt, beforeAt) : undefined,
        q.action ? eq(spaceAuditLog.action, q.action) : undefined,
        q.actorId ? eq(spaceAuditLog.actorId, q.actorId) : undefined,
      ),
    )
    .orderBy(desc(spaceAuditLog.createdAt), desc(spaceAuditLog.id))
    .limit(q.limit);
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    action: r.action,
    targetType: (r.targetType as SpaceAuditEntry['targetType']) ?? null,
    targetId: r.targetId,
    changes: r.changes,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreatedSpace {
  space: SpaceRow;
  everyoneRoleId: string;
  generalChatId: string;
  voiceChatId: string;
}

/**
 * A new Space owned by `ownerId`: @everyone (DEFAULT_EVERYONE_PERMISSIONS), the owner as the
 * first member, categories "Text channels" / "Voice channels" with `#general` (the system
 * channel) and a "General" voice channel — or, with `template`, the template's roles,
 * categories, channels and overwrites (`applyTemplateTx`). Registers the owner's JOIN fan-out.
 */
export async function createSpaceTx(
  tx: Tx,
  fx: Effects,
  input: {
    ownerId: string;
    name: string;
    description?: string | null;
    iconMediaId?: string | null;
    createdAt?: Date;
    legacyCommunityId?: string | null;
    /** The conversion makes its own channels. */
    withDefaults?: boolean;
    /** Build from a template (a starter's or a template code's snapshot) instead of the defaults. */
    template?: SpaceTemplateSnapshot | null;
  },
): Promise<CreatedSpace> {
  const now = input.createdAt ?? new Date();
  const [space] = await tx
    .insert(spaces)
    .values({
      name: input.name,
      description: input.description ?? null,
      iconMediaId: input.iconMediaId ?? null,
      ownerId: input.ownerId,
      createdBy: input.ownerId,
      legacyCommunityId: input.legacyCommunityId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [everyone] = await tx
    .insert(spaceRoles)
    .values({
      spaceId: space!.id,
      name: '@everyone',
      position: 0,
      permissions: DEFAULT_EVERYONE_PERMISSIONS,
      isDefault: true,
    })
    .returning();
  let generalChatId = '';
  let voiceChatId = '';
  if (input.template) {
    ({ generalChatId, voiceChatId } = await applyTemplateTx(
      tx,
      space!.id,
      input.ownerId,
      everyone!.id,
      input.template,
    ));
  } else if (input.withDefaults !== false) {
    const [textCat, voiceCat] = await tx
      .insert(spaceCategories)
      .values([
        { spaceId: space!.id, name: 'Text channels', position: 0 },
        { spaceId: space!.id, name: 'Voice channels', position: 1 },
      ])
      .returning();
    const [general, voice] = await tx
      .insert(chats)
      .values([
        {
          type: 'space_text',
          name: 'general',
          spaceId: space!.id,
          categoryId: textCat!.id,
          position: 0,
          createdBy: input.ownerId,
        },
        {
          type: 'space_voice',
          name: 'General',
          spaceId: space!.id,
          categoryId: voiceCat!.id,
          position: 0,
          createdBy: input.ownerId,
        },
      ])
      .returning();
    generalChatId = general!.id;
    voiceChatId = voice!.id;
    await tx.update(spaces).set({ systemChannelId: generalChatId }).where(eq(spaces.id, space!.id));
  }
  await addSpaceMemberTx(tx, fx, space!.id, input.ownerId, { joinedAt: now, silent: true });
  const [fresh] = await tx.select().from(spaces).where(eq(spaces.id, space!.id));
  await audit(tx, {
    spaceId: space!.id,
    actorId: input.ownerId,
    action: input.legacyCommunityId ? 'space.migrated' : 'space.create',
    targetType: 'space',
    targetId: space!.id,
  });
  return { space: fresh!, everyoneRoleId: everyone!.id, generalChatId, voiceChatId };
}

/** Channel types a template carries (threads never travel). */
const TEMPLATE_CHANNEL_TYPES = new Set(['space_text', 'space_voice', 'space_forum', 'space_stage']);
const ROLE_COLOR = /^#[0-9a-f]{6}$/;

const sameOverwriteSet = (a: readonly PermissionOverwrite[], b: readonly PermissionOverwrite[]) => {
  const key = (o: PermissionOverwrite) => `${o.targetType}:${o.targetId}:${o.allow}:${o.deny}`;
  const keys = new Set(a.map(key));
  return a.length === b.length && b.every((o) => keys.has(key(o)));
};

/**
 * A new Space's structure from a template snapshot (the mirror of `buildSnapshot`,
 * modules/templates/service.ts): @everyone takes the snapshot's permissions; the other roles
 * are created above it in their order (index = position); categories, then channels in order
 * with dense positions per category; overwrites mapped from role indexes (allow wins over
 * deny); a channel whose overwrites equal its category's stays synced; the system (text) and
 * AFK (voice) channels by index. Space limits apply (a snapshot never exceeds them). Returns
 * the system channel (else the first text channel) and the first voice channel, '' for none.
 */
async function applyTemplateTx(
  tx: Tx,
  spaceId: string,
  ownerId: string,
  everyoneRoleId: string,
  t: SpaceTemplateSnapshot,
): Promise<{ generalChatId: string; voiceChatId: string }> {
  const roleIdByIndex = new Map<number, string>();
  const defaultIndex = t.roles.findIndex((r) => r.isDefault);
  if (defaultIndex >= 0) {
    const d = t.roles[defaultIndex]!;
    await tx
      .update(spaceRoles)
      .set({ permissions: d.permissions & ASSIGNABLE_PERMISSIONS, mentionable: d.mentionable })
      .where(eq(spaceRoles.id, everyoneRoleId));
    roleIdByIndex.set(defaultIndex, everyoneRoleId);
  }
  const others = t.roles
    .map((role, index) => ({ role, index }))
    .filter((r) => r.index !== defaultIndex)
    .slice(0, MAX_SPACE_ROLES - 1);
  if (others.length) {
    const rows = await tx
      .insert(spaceRoles)
      .values(
        others.map(({ role }, k) => ({
          spaceId,
          name: role.name.trim().slice(0, ROLE_NAME_MAX_LENGTH) || 'new role',
          color: role.color && ROLE_COLOR.test(role.color) ? role.color : null,
          position: k + 1,
          permissions: role.permissions & ASSIGNABLE_PERMISSIONS,
          hoist: role.hoist,
          mentionable: role.mentionable,
        })),
      )
      .returning({ id: spaceRoles.id, position: spaceRoles.position });
    for (const r of rows) roleIdByIndex.set(others[r.position - 1]!.index, r.id);
  }
  const overwritesOf = (list: readonly TemplateOverwrite[]): PermissionOverwrite[] => {
    const out = new Map<string, PermissionOverwrite>();
    for (const o of list) {
      const targetId = roleIdByIndex.get(o.role);
      if (!targetId) continue;
      const allow = o.allow & ASSIGNABLE_PERMISSIONS;
      const deny = o.deny & ASSIGNABLE_PERMISSIONS & ~allow;
      out.set(targetId, { targetType: 'role', targetId, allow, deny });
    }
    return [...out.values()];
  };

  const cats = t.categories.slice(0, MAX_SPACE_CATEGORIES);
  const catIdByIndex = new Map<number, string>();
  const catOverwrites = new Map<string, PermissionOverwrite[]>();
  if (cats.length) {
    const rows = await tx
      .insert(spaceCategories)
      .values(
        cats.map((c, position) => ({
          spaceId,
          name: c.name.trim().slice(0, CHANNEL_NAME_MAX_LENGTH) || 'Category',
          position,
        })),
      )
      .returning({ id: spaceCategories.id, position: spaceCategories.position });
    for (const r of rows) catIdByIndex.set(r.position, r.id);
    const values = cats.flatMap((c, i) => {
      const categoryId = catIdByIndex.get(i)!;
      const ow = overwritesOf(c.overwrites);
      catOverwrites.set(categoryId, ow);
      return ow.map((o) => ({ categoryId, ...o }));
    });
    if (values.length) await tx.insert(spaceCategoryOverwrites).values(values);
  }

  const nextPosition = new Map<string, number>();
  const planned: {
    index: number;
    key: string;
    overwrites: PermissionOverwrite[];
    values: typeof chats.$inferInsert;
  }[] = [];
  for (const [index, c] of t.channels.entries()) {
    if (planned.length >= MAX_SPACE_CHANNELS || !TEMPLATE_CHANNEL_TYPES.has(c.type)) continue;
    const categoryId = c.category === null ? null : (catIdByIndex.get(c.category) ?? null);
    const position = nextPosition.get(categoryId ?? '') ?? 0;
    nextPosition.set(categoryId ?? '', position + 1);
    const textLike = c.type === 'space_text' || c.type === 'space_forum';
    const voiceLike = c.type === 'space_voice' || c.type === 'space_stage';
    const overwrites = overwritesOf(c.overwrites);
    const name = (textLike ? normalizeTextChannelName(c.name) : c.name.trim()).slice(
      0,
      CHANNEL_NAME_MAX_LENGTH,
    );
    planned.push({
      index,
      key: `${categoryId ?? ''}:${position}`,
      overwrites,
      values: {
        type: c.type,
        name: name || (voiceLike ? 'Voice' : 'channel'),
        spaceId,
        categoryId,
        position,
        topic:
          c.type === 'space_text' || c.type === 'space_stage'
            ? (c.topic?.slice(0, CHANNEL_TOPIC_MAX_LENGTH) ?? null)
            : null,
        nsfw: !!c.nsfw,
        slowmodeSeconds: voiceLike
          ? 0
          : Math.min(21_600, Math.max(0, Math.trunc(c.slowmodeSeconds) || 0)),
        userLimit:
          voiceLike && c.userLimit ? Math.min(MAX_VOICE_CHANNEL_PARTICIPANTS, c.userLimit) : null,
        isNews: c.type === 'space_text' && !!c.isNews,
        ...(c.type === 'space_forum'
          ? { forumTags: [], forumSettings: { ...DEFAULT_FORUM_SETTINGS } }
          : {}),
        permissionsSynced:
          categoryId === null || sameOverwriteSet(overwrites, catOverwrites.get(categoryId) ?? []),
        createdBy: ownerId,
      },
    });
  }
  const idByIndex = new Map<number, string>();
  if (planned.length) {
    const rows = await tx
      .insert(chats)
      .values(planned.map((p) => p.values))
      .returning({ id: chats.id, categoryId: chats.categoryId, position: chats.position });
    const idByKey = new Map(rows.map((r) => [`${r.categoryId ?? ''}:${r.position}`, r.id]));
    const values: (PermissionOverwrite & { chatId: string })[] = [];
    for (const p of planned) {
      const chatId = idByKey.get(p.key)!;
      idByIndex.set(p.index, chatId);
      for (const o of p.overwrites) values.push({ chatId, ...o });
    }
    if (values.length) await tx.insert(spaceChannelOverwrites).values(values);
  }
  const pick = (index: number | null, type: string) =>
    index !== null && t.channels[index]?.type === type ? idByIndex.get(index) : undefined;
  const system = pick(t.systemChannel, 'space_text');
  const afk = pick(t.afkChannel, 'space_voice');
  if (system || afk)
    await tx
      .update(spaces)
      .set({ systemChannelId: system ?? null, afkChannelId: afk ?? null })
      .where(eq(spaces.id, spaceId));
  const first = (type: string) => {
    const p = planned.find((x) => x.values.type === type);
    return p ? idByIndex.get(p.index) : undefined;
  };
  return {
    generalChatId: system ?? first('space_text') ?? '',
    voiceChatId: first('space_voice') ?? '',
  };
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * Add a member (caller holds the Space lock and checked bans/limits): row, member count,
 * and after commit: their sockets join the Space room on every process, `space:upsert` →
 * them, `space:member-joined` → room. `silent` skips the system-channel notice.
 */
export async function addSpaceMemberTx(
  tx: Tx,
  fx: Effects,
  spaceId: string,
  userId: string,
  opts: { joinedAt?: Date; silent?: boolean; roleIds?: string[] } = {},
): Promise<SpaceMemberRow | null> {
  const [user] = await tx
    .select({ displayName: users.displayName, settings: users.settings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [row] = await tx
    .insert(spaceMembers)
    .values({
      spaceId,
      userId,
      sortName: sortNameOf(null, user?.displayName ?? 'member'),
      joinedAt: opts.joinedAt ?? new Date(),
      // Per-Space DM privacy starts from "Allow DMs from new Spaces' members" (dmGate.ts).
      allowDms: resolveUserSettings(user?.settings).allowSpaceDms,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  if (opts.roleIds?.length)
    await tx
      .insert(spaceMemberRoles)
      .values(opts.roleIds.map((roleId) => ({ spaceId, userId, roleId })))
      .onConflictDoNothing();
  const [space] = await tx
    .update(spaces)
    .set({ memberCount: sql`${spaces.memberCount} + 1` })
    .where(eq(spaces.id, spaceId))
    .returning();
  fx.add(() => spaceMemberJoined(spaceId, userId));
  fxSpaceUpsert(fx, userId, spaceId);
  fxMemberEvent(fx, space!, () => ({
    event: 'space:member-joined',
    member: toSpaceMember(row, opts.roleIds ?? []),
  }));
  if (space!.memberCount <= LARGE_SPACE_THRESHOLD)
    fxSpaceUpdated(fx, spaceId, { memberCount: space!.memberCount, large: false });
  await runSpaceMemberJoined(tx, fx, {
    spaceId,
    userId,
    silent: !!opts.silent,
    at: row.joinedAt,
  });
  return row;
}

/**
 * Remove a member (left, kicked, banned): their roles and channel read rows, the count;
 * after commit: their sockets leave the rooms, `space:removed` → them, `space:member-left` →
 * room. The owner cannot be removed (callers check).
 */
export async function removeSpaceMemberTx(
  tx: Tx,
  fx: Effects,
  spaceId: string,
  userId: string,
  reason: SpaceRemovedReason,
): Promise<boolean> {
  const [gone] = await tx
    .delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .returning({ userId: spaceMembers.userId });
  if (!gone) return false;
  // Read state of the Space's channels goes with the membership.
  await tx
    .delete(chatMembers)
    .where(
      and(
        eq(chatMembers.userId, userId),
        inArray(
          chatMembers.chatId,
          tx.select({ id: chats.id }).from(chats).where(eq(chats.spaceId, spaceId)),
        ),
      ),
    );
  // Interest in the Space's events goes too (the counts follow).
  const dropped = await tx
    .delete(spaceEventInterests)
    .where(
      and(
        eq(spaceEventInterests.userId, userId),
        inArray(
          spaceEventInterests.eventId,
          tx.select({ id: spaceEvents.id }).from(spaceEvents).where(eq(spaceEvents.spaceId, spaceId)),
        ),
      ),
    )
    .returning({ eventId: spaceEventInterests.eventId });
  if (dropped.length)
    await tx
      .update(spaceEvents)
      .set({ interestedCount: sql`greatest(${spaceEvents.interestedCount} - 1, 0)` })
      .where(
        inArray(
          spaceEvents.id,
          dropped.map((d) => d.eventId),
        ),
      );
  // Member overwrites of the channels stay (Discord keeps them; harmless without membership).
  const [space] = await tx
    .update(spaces)
    .set({ memberCount: sql`greatest(${spaces.memberCount} - 1, 0)` })
    .where(eq(spaces.id, spaceId))
    .returning();
  fx.add(() => spaceMemberLeft(spaceId, userId));
  fx.toUser(userId, 'space:removed', { spaceId, reason });
  if (space) {
    fxMemberEvent(fx, space, () => ({ event: 'space:member-left', userId }));
    if (space.memberCount <= LARGE_SPACE_THRESHOLD)
      fxSpaceUpdated(fx, spaceId, { memberCount: space.memberCount, large: false });
  }
  await runSpaceMemberLeft(tx, fx, { spaceId, userId, reason, at: new Date() });
  return true;
}

/** Delete a Space (owner): everything cascades; every member gets `space:removed { deleted }`. */
export async function deleteSpaceTx(tx: Tx, fx: Effects, spaceId: string, memberIds: string[]) {
  await tx.delete(spaces).where(eq(spaces.id, spaceId));
  for (const userId of memberIds)
    fx.toUser(userId, 'space:removed', { spaceId, reason: 'deleted' });
  fx.add(() => spaceDeleted(spaceId));
}

/** The members' ids (deletion fan-out; bounded by MAX_SPACE_MEMBERS). */
export async function spaceMemberIds(dbx: DbOrTx, spaceId: string): Promise<string[]> {
  const rows = await dbx
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId));
  return rows.map((r) => r.userId);
}

/** Members with their role ids, keyed by `pairKey(spaceId, userId)` (helpers for routes). */
export function memberKey(spaceId: string, userId: string): string {
  return pairKey(spaceId, userId);
}
