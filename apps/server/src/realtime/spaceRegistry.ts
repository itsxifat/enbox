/**
 * Per-process Space registry and virtual channel rooms (docs/design/spaces-at-scale.md
 * "Realtime fan-out").
 *
 * Sockets join one real room per Space (`space:<id>`), never one per space channel (a member of
 * 200 Spaces × 50 channels would hold 10 000 rooms). A space channel's `chat:<id>` is VIRTUAL:
 * the adapter's `apply` (used by every broadcast, socketsJoin/Leave, fetchSockets — locally and
 * for messages from other processes) rewrites it on THIS process to
 * - `space:<spaceId>` when the channel is public (every member can see it), or
 * - the ids of the local sockets whose member can see it (each socket is in a room named after
 *   its own id).
 * So every existing `emitToChat(chatId, …)` reaches exactly the members who can see a space
 * channel, on every process, without per-member work on the sender's side.
 *
 * State per Space with local sockets: roles (spaceAccess.ts cache), channels with overwrites,
 * and the local members' role ids. Loaded when a local socket of a member connects or joins;
 * dropped with the last local socket. Changes publish `space:invalidate` (structure) or
 * `space:member-invalidate` (one member) on the cluster bus and every process reloads. A
 * broadcast racing a reload uses the previous state (documented: a member who just lost
 * access may receive one more event; one who just gained it refetches the channels anyway).
 *
 * Threads (`space_thread`) have no state of their own: a thread's `chat:<id>` resolves exactly
 * like its parent channel's (same audience). Loaded with the Space: open threads and those
 * archived within ARCHIVED_THREAD_WINDOW_MS; a thread created or revived later is registered
 * here by `registerThread` (this process) and by the `space:invalidate` reload (the others).
 */
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import {
  PERM,
  computeChannelPermissions,
  hasPerm,
  isSpaceAdmin,
  isSpaceChatType,
  rooms,
  type PermissionOverwrite,
  type SpaceChannelType,
} from '@enbox/shared';
import { onBus, publish } from '../cluster/bus.js';
import { db } from '../db/index.js';
import { chats, spaceMembers } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import {
  baseBits,
  isTimedOut,
  loadChannelOverwrites,
  loadSpaceMembers,
  loadSpacePermCtx,
  type MemberCtx,
  type SpacePermCtx,
} from '../services/spaceAccess.js';
import type { AppSocket, IO } from './types.js';

interface ChannelState {
  type: SpaceChannelType;
  overwrites: PermissionOverwrite[];
  /** Every member can see it: the virtual room is the whole Space room. */
  public: boolean;
}

interface SpaceState {
  ctx: SpacePermCtx;
  channels: Map<string, ChannelState>;
  /** Local members only. */
  members: Map<string, MemberCtx>;
  /** (userId → chatId → can view), cleared on any change. */
  views: Map<string, Map<string, boolean>>;
  /** Registered threads → their parent channel. */
  threads: Map<string, string>;
}

/** Archived threads stay registered this long after archiving (late edits, reactions). */
const ARCHIVED_THREAD_WINDOW_MS = 7 * 24 * 3600_000;

const states = new Map<string, SpaceState>();
/** chatId → spaceId for the channels of loaded Spaces. */
const channelSpace = new Map<string, string>();
/** socketId → Space ids it was registered in (refcounts). */
const socketSpaces = new Map<string, Set<string>>();
let io: IO | undefined;
/** Reloads in flight (tests wait for them with `spaceRegistryIdle`). */
const pending = new Set<Promise<unknown>>();

function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  void p.finally(() => pending.delete(p)).catch(() => {});
  return p;
}

function isPublic(ctx: SpacePermCtx, ch: { overwrites: PermissionOverwrite[] }): boolean {
  if (ch.overwrites.some((o) => (o.deny & PERM.VIEW_CHANNEL) !== 0)) return false;
  const everyone = ctx.roles.find((r) => r.id === ctx.everyoneRoleId)?.permissions ?? 0;
  const bits = computeChannelPermissions(everyone, {
    channelType: 'space_text',
    overwrites: ch.overwrites,
    everyoneRoleId: ctx.everyoneRoleId,
    memberRoleIds: [],
    viewerId: '',
  });
  return hasPerm(bits, PERM.VIEW_CHANNEL);
}

/** Load (or reload) the structure of these Spaces; members of `userIds` too. */
async function loadSpaces(spaceIds: string[], userIds: string[] = []): Promise<void> {
  if (spaceIds.length === 0) return;
  const channelRows = await db
    .select({ id: chats.id, type: chats.type, spaceId: chats.spaceId, parentId: chats.parentId })
    .from(chats)
    .where(
      and(
        inArray(chats.spaceId, spaceIds),
        or(
          isNull(chats.parentId),
          isNull(chats.threadArchivedAt),
          gt(chats.threadArchivedAt, new Date(Date.now() - ARCHIVED_THREAD_WINDOW_MS)),
        ),
      ),
    );
  const overwrites = await loadChannelOverwrites(
    db,
    channelRows.filter((c) => !c.parentId).map((c) => c.id),
  );
  for (const spaceId of spaceIds) {
    const ctx = await loadSpacePermCtx(db, spaceId);
    if (!ctx) {
      dropSpace(spaceId);
      continue;
    }
    const prev = states.get(spaceId);
    const channels = new Map<string, ChannelState>();
    const threads = new Map<string, string>();
    for (const c of channelRows) {
      if (c.spaceId !== spaceId || !isSpaceChatType(c.type)) continue;
      if (c.parentId) {
        threads.set(c.id, c.parentId);
        continue;
      }
      const ow = overwrites.get(c.id) ?? [];
      channels.set(c.id, {
        type: c.type,
        overwrites: ow,
        public: isPublic(ctx, { overwrites: ow }),
      });
    }
    // Threads registered meanwhile (created or revived during this load) are kept while their
    // channel exists; a deleted thread's id resolves to nobody's events anyway.
    for (const [id, parentId] of prev?.threads ?? [])
      if (!threads.has(id)) threads.set(id, parentId);
    for (const [id, parentId] of threads) if (!channels.has(parentId)) threads.delete(id);
    if (prev)
      for (const id of [...prev.channels.keys(), ...prev.threads.keys()])
        if (!channels.has(id) && !threads.has(id)) channelSpace.delete(id);
    for (const id of channels.keys()) channelSpace.set(id, spaceId);
    for (const id of threads.keys()) channelSpace.set(id, spaceId);
    const memberIds = new Set([...(prev?.members.keys() ?? []), ...userIds]);
    const members = await loadSpaceMembers(db, spaceId, [...memberIds]);
    // A thread registered while the members loaded is not lost.
    for (const [id, parentId] of states.get(spaceId)?.threads ?? [])
      if (!threads.has(id) && channels.has(parentId)) threads.set(id, parentId);
    states.set(spaceId, { ctx, channels, members, views: new Map(), threads });
  }
}

function dropSpace(spaceId: string): void {
  const s = states.get(spaceId);
  if (s) for (const id of [...s.channels.keys(), ...s.threads.keys()]) channelSpace.delete(id);
  states.delete(spaceId);
}

/** The channel whose state decides a chat's audience: a thread's parent, else the chat itself. */
function audienceOf(state: SpaceState, chatId: string): string {
  return state.threads.get(chatId) ?? chatId;
}

function canView(state: SpaceState, userId: string, threadOrChatId: string): boolean {
  const chatId = audienceOf(state, threadOrChatId);
  let mine = state.views.get(userId);
  if (!mine) state.views.set(userId, (mine = new Map()));
  const cached = mine.get(chatId);
  if (cached !== undefined) return cached;
  const ch = state.channels.get(chatId);
  const m = state.members.get(userId);
  let ok = false;
  if (ch && m) {
    const base = baseBits(state.ctx, userId, m);
    ok = hasPerm(
      computeChannelPermissions(base, {
        channelType: ch.type,
        overwrites: ch.overwrites,
        everyoneRoleId: state.ctx.everyoneRoleId,
        memberRoleIds: m.roleIds,
        viewerId: userId,
        timedOut: isTimedOut(m.member) && !isSpaceAdmin(base),
      }),
      PERM.VIEW_CHANNEL,
    );
  }
  mine.set(chatId, ok);
  return ok;
}

/** No such room exists: an empty rewrite must never mean "every socket". */
const NOBODY = '\u0000nobody';

/** The real rooms a (possibly virtual) room means on this process. */
function resolveRoom(room: string, out: Set<string>): void {
  if (!room.startsWith('chat:')) return void out.add(room);
  const chatId = room.slice(5);
  const spaceId = channelSpace.get(chatId);
  const state = spaceId ? states.get(spaceId) : undefined;
  if (!spaceId || !state) return void out.add(room); // not a (loaded) space channel
  const ch = state.channels.get(audienceOf(state, chatId));
  if (!ch) return;
  const spaceRoom = rooms.space(spaceId);
  if (ch.public) return void out.add(spaceRoom);
  const sids = io?.of('/').adapter.rooms.get(spaceRoom);
  if (!sids) return;
  for (const sid of sids) {
    const userId = io?.of('/').sockets.get(sid)?.data.userId;
    if (userId && canView(state, userId, chatId)) out.add(sid);
  }
}

/** Install the virtual-room rewrite on the namespace adapter (once per server). */
export function installSpaceRooms(server: IO): void {
  io = server;
  const adapter = server.of('/').adapter as unknown as {
    apply: (opts: { rooms: Set<string>; except?: Set<string> }, cb: (s: unknown) => void) => void;
    hasRoom?: (room: string) => boolean;
  };
  // The Redis adapter publishes a single-room broadcast on a per-room channel and drops it on
  // processes where `hasRoom` is false: a virtual room has no member sockets of its own, so it
  // must count as present wherever its Space is loaded.
  if (typeof adapter.hasRoom === 'function') {
    const hasRoom = adapter.hasRoom.bind(adapter);
    adapter.hasRoom = (room: string) =>
      hasRoom(room) || (room.startsWith('chat:') && channelSpace.has(room.slice(5)));
  }
  const original = adapter.apply.bind(adapter);
  adapter.apply = (opts, cb) => {
    if (!opts.rooms || opts.rooms.size === 0) return original(opts, cb);
    let virtual = false;
    for (const r of opts.rooms)
      if (r.startsWith('chat:') && channelSpace.has(r.slice(5))) virtual = true;
    if (!virtual) return original(opts, cb);
    const resolved = new Set<string>();
    for (const r of opts.rooms) resolveRoom(r, resolved);
    if (resolved.size === 0) resolved.add(NOBODY);
    return original({ ...opts, rooms: resolved }, cb);
  };
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------

/** The Space ids `userId` belongs to. */
export async function memberSpaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId));
  return rows.map((r) => r.spaceId);
}

/** Register a socket in these Spaces: load their state and its member, join `space:<id>`. */
export async function addSocketToSpaces(socket: AppSocket, spaceIds: string[]): Promise<void> {
  if (spaceIds.length === 0) return;
  const userId = socket.data.userId;
  const missing = spaceIds.filter((id) => !states.has(id));
  await loadSpaces(missing, [userId]);
  // Spaces loaded before: just add this member.
  for (const spaceId of spaceIds) {
    const state = states.get(spaceId);
    if (!state || state.members.has(userId)) continue;
    const m = (await loadSpaceMembers(db, spaceId, [userId])).get(userId);
    if (m) state.members.set(userId, m);
    state.views.delete(userId);
  }
  if (socket.disconnected) return;
  let mine = socketSpaces.get(socket.id);
  if (!mine) socketSpaces.set(socket.id, (mine = new Set()));
  const joined = spaceIds.filter((id) => states.get(id)?.members.has(userId));
  for (const id of joined) mine.add(id);
  await socket.join(joined.map(rooms.space));
}

/** A socket left these Spaces (or disconnected: all of them). Drops unused state. */
export function removeSocketFromSpaces(socketId: string, spaceIds?: string[]): void {
  const mine = socketSpaces.get(socketId);
  if (!mine) return;
  const leaving = spaceIds ?? [...mine];
  for (const id of leaving) mine.delete(id);
  if (mine.size === 0) socketSpaces.delete(socketId);
  for (const spaceId of leaving) {
    const room = io?.of('/').adapter.rooms.get(rooms.space(spaceId));
    const stillHere = room && [...room].some((sid) => sid !== socketId);
    if (!stillHere) dropSpace(spaceId);
  }
}

/** Local sockets of a user. */
function localSocketsOf(userId: string): AppSocket[] {
  const sids = io?.of('/').adapter.rooms.get(rooms.user(userId));
  if (!sids) return [];
  return [...sids]
    .map((sid) => io!.of('/').sockets.get(sid))
    .filter((s): s is AppSocket => !!s && s.connected);
}

// ---------------------------------------------------------------------------
// Cluster-wide changes (publish AFTER commit)
// ---------------------------------------------------------------------------

/** Roles, channels or overwrites of a Space changed: every process reloads it. */
export function spaceStructureChanged(spaceId: string): void {
  publish('space:invalidate', { spaceId });
}

/** One member's roles/timeout changed (or they joined): their processes reload them. */
export function spaceMemberChanged(spaceId: string, userId: string): void {
  publish('space:member-invalidate', { spaceId, userId });
}

/** `userId` joined the Space: their sockets (on every process) join its room. */
export function spaceMemberJoined(spaceId: string, userId: string): void {
  publish('space:member-joined', { spaceId, userId });
}

/** `userId` left / was removed: their sockets leave the Space room. */
export function spaceMemberLeft(spaceId: string, userId: string): void {
  publish('space:member-left', { spaceId, userId });
}

/** The Space was deleted: every socket leaves its room. */
export function spaceDeleted(spaceId: string): void {
  publish('space:deleted', { spaceId });
}

/**
 * A thread was created or revived (after commit): its room resolves like its parent's here at
 * once, and every other process learns it from the Space reload.
 */
export function threadOpened(spaceId: string, threadId: string, parentId: string): void {
  registerThread(spaceId, threadId, parentId);
  spaceStructureChanged(spaceId);
}

/** Register a thread under its parent channel on this process (no-op when not loaded). */
export function registerThread(spaceId: string, threadId: string, parentId: string): void {
  const state = states.get(spaceId);
  if (!state?.channels.has(parentId)) return;
  state.threads.set(threadId, parentId);
  channelSpace.set(threadId, spaceId);
}

function reload(spaceId: string): void {
  if (!states.has(spaceId)) return;
  void track(
    loadSpaces([spaceId]).catch((err: unknown) =>
      logger.error({ err, spaceId }, 'space registry reload failed'),
    ),
  );
}

onBus('space:invalidate', ({ spaceId }) => reload(spaceId));

onBus('space:member-invalidate', ({ spaceId, userId }) => {
  const state = states.get(spaceId);
  if (!state?.members.has(userId)) return;
  void track(
    loadSpaceMembers(db, spaceId, [userId])
      .then((m) => {
        const s = states.get(spaceId);
        if (!s) return;
        const row = m.get(userId);
        if (row) s.members.set(userId, row);
        else s.members.delete(userId);
        s.views.delete(userId);
      })
      .catch((err: unknown) => logger.error({ err, spaceId }, 'space member reload failed')),
  );
});

onBus('space:member-joined', ({ spaceId, userId }) => {
  for (const socket of localSocketsOf(userId))
    void track(
      addSocketToSpaces(socket, [spaceId]).catch((err: unknown) =>
        logger.error({ err, spaceId }, 'joining a Space room failed'),
      ),
    );
});

onBus('space:member-left', ({ spaceId, userId }) => {
  for (const socket of localSocketsOf(userId)) {
    void socket.leave(rooms.space(spaceId));
    void socket.leave(rooms.spaceMembers(spaceId));
    removeSocketFromSpaces(socket.id, [spaceId]);
  }
  const state = states.get(spaceId);
  if (state) {
    state.members.delete(userId);
    state.views.delete(userId);
  }
});

onBus('space:deleted', ({ spaceId }) => {
  io?.in(rooms.space(spaceId)).socketsLeave([rooms.space(spaceId), rooms.spaceMembers(spaceId)]);
  for (const [sid, mine] of socketSpaces) {
    mine.delete(spaceId);
    if (mine.size === 0) socketSpaces.delete(sid);
  }
  dropSpace(spaceId);
});

/** Wait until pending reloads and joins settled (tests). */
export async function spaceRegistryIdle(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** Forget everything (tests). */
export function resetSpaceRegistry(): void {
  states.clear();
  channelSpace.clear();
  socketSpaces.clear();
}

/** Diagnostics/tests: whether this process has the Space loaded. */
export function spaceLoaded(spaceId: string): boolean {
  return states.has(spaceId);
}

/** For `space:focus`: the chat must be a channel of a loaded Space the socket's member can see. */
export function canViewLoaded(userId: string, chatId: string): boolean {
  const spaceId = channelSpace.get(chatId);
  const state = spaceId ? states.get(spaceId) : undefined;
  return !!state && canView(state, userId, chatId);
}

/**
 * A local member's bits in a channel of a loaded Space (typing checks without a query), or
 * null when this process has no state for it (callers fall back to `getChatAccess`).
 */
export function loadedChannelBits(userId: string, chatId: string): number | null {
  const spaceId = channelSpace.get(chatId);
  const state = spaceId ? states.get(spaceId) : undefined;
  const ch = state ? state.channels.get(audienceOf(state, chatId)) : undefined;
  const m = state?.members.get(userId);
  if (!state || !ch || !m) return null;
  const base = baseBits(state.ctx, userId, m);
  return computeChannelPermissions(base, {
    channelType: ch.type,
    overwrites: ch.overwrites,
    everyoneRoleId: state.ctx.everyoneRoleId,
    memberRoleIds: m.roleIds,
    viewerId: userId,
    timedOut: isTimedOut(m.member) && !isSpaceAdmin(base),
  });
}

/** The parent channel of a thread of a Space this process has loaded. */
export function loadedThreadParent(chatId: string): string | undefined {
  const spaceId = channelSpace.get(chatId);
  return spaceId ? states.get(spaceId)?.threads.get(chatId) : undefined;
}

/** Members of a loaded Space on this process (tests). */
export function loadedSpaceOf(chatId: string): string | undefined {
  return channelSpace.get(chatId);
}
