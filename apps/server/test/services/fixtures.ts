/**
 * Service-level fixtures: build chats/messages through the domain primitives (the REST
 * modules are implemented separately). All helpers use `transact` so their fan-out is
 * emitted exactly like a real mutation's.
 */
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_CHANNEL_SETTINGS, DEFAULT_GROUP_SETTINGS, directChatKey, type ChannelSettings, type GroupSettings, type ServerToClientEvents } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks, chatMembers, chats, communities, contacts, users } from '../../src/db/schema.js';
import { transact } from '../../src/services/effects.js';
import { generateUniqueInviteCode } from '../../src/services/invites.js';
import { upsertMembership } from '../../src/services/membership.js';
import { createMessage, type CreateMessageInput } from '../../src/services/messages.js';
import { postSystemMessage } from '../../src/services/system.js';
import { isOnline } from '../../src/realtime/presence.js';
import type { TestSocket } from '../helpers.js';

type Id = string;
const idOf = (u: Id | { id: Id }) => (typeof u === 'string' ? u : u.id);

export async function createGroup(
  owner: Id | { id: Id },
  members: (Id | { id: Id })[] = [],
  opts: { name?: string; settings?: Partial<GroupSettings>; disappearingSeconds?: number | null; admins?: (Id | { id: Id })[] } = {},
): Promise<Id> {
  const ownerId = idOf(owner);
  const memberIds = members.map(idOf);
  const name = opts.name ?? 'Group';
  return transact(async (tx, fx) => {
    const [chat] = await tx
      .insert(chats)
      .values({
        type: 'group',
        name,
        createdBy: ownerId,
        groupSettings: { ...DEFAULT_GROUP_SETTINGS, ...opts.settings },
        inviteCode: await generateUniqueInviteCode(tx),
        disappearingSeconds: opts.disappearingSeconds ?? null,
      })
      .returning();
    const roles: Record<string, 'owner' | 'admin'> = { [ownerId]: 'owner' };
    for (const a of opts.admins ?? []) roles[idOf(a)] = 'admin';
    await upsertMembership(tx, fx, { kind: 'activate', chatId: chat!.id, userIds: [ownerId, ...memberIds], roles, addedBy: ownerId, initial: true });
    await postSystemMessage(tx, fx, chat!, { kind: 'group_created', actorId: ownerId, name });
    if (memberIds.length) await postSystemMessage(tx, fx, chat!, { kind: 'members_added', actorId: ownerId, userIds: memberIds });
    return chat!.id;
  });
}

/** Direct chat as `POST /chats/direct` creates it: caller visible, peer row hidden (self chat: one row). */
export async function createDirect(a: Id | { id: Id }, b: Id | { id: Id }): Promise<Id> {
  const aId = idOf(a);
  const bId = idOf(b);
  return transact(async (tx, fx) => {
    const [existing] = await tx.select({ id: chats.id }).from(chats).where(eq(chats.directKey, directChatKey(aId, bId)));
    if (existing) return existing.id;
    const [chat] = await tx.insert(chats).values({ type: 'direct', directKey: directChatKey(aId, bId), createdBy: aId }).returning();
    await tx.insert(chatMembers).values({ chatId: chat!.id, userId: aId });
    if (aId !== bId) await tx.insert(chatMembers).values({ chatId: chat!.id, userId: bId, hidden: true });
    fx.join(aId, chat!.id);
    return chat!.id;
  });
}

export async function createChannel(owner: Id | { id: Id }, opts: { name?: string; settings?: Partial<ChannelSettings>; admins?: (Id | { id: Id })[] } = {}): Promise<Id> {
  const ownerId = idOf(owner);
  const name = opts.name ?? 'Channel';
  return transact(async (tx, fx) => {
    const [chat] = await tx
      .insert(chats)
      .values({ type: 'channel', name, createdBy: ownerId, channelSettings: { ...DEFAULT_CHANNEL_SETTINGS, ...opts.settings }, inviteCode: await generateUniqueInviteCode(tx) })
      .returning();
    await upsertMembership(tx, fx, { kind: 'activate', chatId: chat!.id, userIds: [ownerId], role: 'owner', addedBy: ownerId });
    await postSystemMessage(tx, fx, chat!, { kind: 'channel_created', actorId: ownerId, name });
    if (opts.admins?.length) {
      await upsertMembership(tx, fx, { kind: 'activate', chatId: chat!.id, userIds: opts.admins.map(idOf), role: 'admin', addedBy: ownerId });
    }
    return chat!.id;
  });
}

/** A community with its announcement group (owner only). Returns both ids. */
export async function createCommunity(owner: Id | { id: Id }, name = 'Community'): Promise<{ communityId: Id; announcementChatId: Id }> {
  const ownerId = idOf(owner);
  return transact(async (tx, fx) => {
    const [community] = await tx.insert(communities).values({ name, createdBy: ownerId, inviteCode: await generateUniqueInviteCode(tx) }).returning();
    const [ann] = await tx
      .insert(chats)
      .values({ type: 'group', name, createdBy: ownerId, communityId: community!.id, isAnnouncement: true, groupSettings: { onlyAdminsCanSend: true, onlyAdminsCanEditInfo: true, onlyAdminsCanAddMembers: true } })
      .returning();
    await tx.update(communities).set({ announcementChatId: ann!.id }).where(eq(communities.id, community!.id));
    await upsertMembership(tx, fx, { kind: 'activate', chatId: ann!.id, userIds: [ownerId], role: 'owner', addedBy: ownerId, initial: true });
    await postSystemMessage(tx, fx, ann!, { kind: 'community_created', actorId: ownerId, name });
    return { communityId: community!.id, announcementChatId: ann!.id };
  });
}

let clientCounter = 0;

/** Send a message through `createMessage` (default: text with a fresh clientId). */
export async function send(
  sender: Id | { id: Id },
  chatId: Id,
  textOrInput: string | Partial<CreateMessageInput> = 'hello',
) {
  const input: CreateMessageInput =
    typeof textOrInput === 'string'
      ? { chatId, senderId: idOf(sender), type: 'text', text: textOrInput, clientId: `c${++clientCounter}` }
      : { chatId, senderId: idOf(sender), type: 'text', text: 'hello', clientId: `c${++clientCounter}`, ...textOrInput };
  return transact((tx, fx) => createMessage(tx, fx, input));
}

export async function block(blocker: Id | { id: Id }, blocked: Id | { id: Id }) {
  await db.insert(blocks).values({ blockerId: idOf(blocker), blockedId: idOf(blocked) });
}

export async function saveContact(owner: Id | { id: Id }, contact: Id | { id: Id }, name: string | null = null) {
  await db.insert(contacts).values({ ownerId: idOf(owner), contactId: idOf(contact), name });
}

export async function setSettings(user: Id | { id: Id }, patch: Record<string, unknown>) {
  await db
    .update(users)
    .set({ settings: sql`${users.settings} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(users.id, idOf(user)));
}

export async function memberRow(chatId: Id, user: Id | { id: Id }) {
  const [row] = await db
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, idOf(user))));
  return row!;
}

/** Record every event a socket receives, in order. */
export function recordEvents(socket: TestSocket) {
  const log: { event: keyof ServerToClientEvents; payload: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  socket.onAny((event: keyof ServerToClientEvents, payload: unknown) => log.push({ event, payload }));
  return {
    log,
    names: () => log.map((e) => e.event),
    of: <E extends keyof ServerToClientEvents>(event: E) => log.filter((e) => e.event === event).map((e) => e.payload as Parameters<ServerToClientEvents[E]>[0]),
    clear: () => void log.splice(0),
  };
}

/** Let in-flight socket packets arrive. */
export const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** Count database round trips made by `fn` (PGlite client). */
export async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const client = (db as unknown as { $client: { query: (...args: unknown[]) => Promise<unknown> } }).$client;
  const original = client.query;
  let queries = 0;
  client.query = function (this: unknown, ...args: unknown[]) {
    queries++;
    return original.apply(this, args);
  };
  try {
    const result = await fn();
    return { result, queries };
  } finally {
    client.query = original;
  }
}

/** Disconnect sockets and wait until the server no longer counts the user as online. */
export async function goOffline(user: Id | { id: Id }, ...sockets: TestSocket[]) {
  for (const s of sockets) s.disconnect();
  for (let i = 0; i < 100 && isOnline(idOf(user)); i++) await new Promise((r) => setTimeout(r, 10));
  if (isOnline(idOf(user))) throw new Error('user still online');
}
