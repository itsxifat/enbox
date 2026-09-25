/**
 * Cross-module hook registries.
 *
 * Chat deletion (community deactivation deletes the announcement group, channel deletion):
 * modules holding state attached to a chat that the `ON DELETE CASCADE` would drop silently
 * (the calls module: a live call, its in-memory bindings and timers) register a handler that
 * winds it down properly inside the deleting transaction, BEFORE the chat row is deleted
 * (the chat is locked by the caller).
 *
 * Account deletion touches every domain (groups, communities, channels, calls, status...).
 * The accounts module orchestrates `DELETE /api/me`; each domain module registers a handler
 * here (at import time, from its own module folder) that cleans up its own state inside the
 * same transaction. Handlers run in registration order after the accounts module has scrubbed
 * the user row and removed sessions/contacts/blocks/push subscriptions.
 */
import type { Tx } from '../db/index.js';
import type { Effects } from './effects.js';

export type AccountDeletionHook = (tx: Tx, fx: Effects, userId: string) => Promise<void>;

const accountDeletionHooks: { name: string; run: AccountDeletionHook }[] = [];

/** Register a domain's account-deletion cleanup (idempotent by name). */
export function registerAccountDeletionHook(name: string, run: AccountDeletionHook): void {
  const existing = accountDeletionHooks.findIndex((h) => h.name === name);
  if (existing >= 0) accountDeletionHooks[existing] = { name, run };
  else accountDeletionHooks.push({ name, run });
}

/** Run every registered account-deletion hook inside the caller's transaction. */
export async function runAccountDeletionHooks(tx: Tx, fx: Effects, userId: string): Promise<void> {
  for (const hook of accountDeletionHooks) await hook.run(tx, fx, userId);
}

export type ChatDeletionHook = (tx: Tx, fx: Effects, chatIds: string[]) => Promise<void>;

const chatDeletionHooks: { name: string; run: ChatDeletionHook }[] = [];

/** Register a domain's chat-deletion cleanup (idempotent by name). */
export function registerChatDeletionHook(name: string, run: ChatDeletionHook): void {
  const existing = chatDeletionHooks.findIndex((h) => h.name === name);
  if (existing >= 0) chatDeletionHooks[existing] = { name, run };
  else chatDeletionHooks.push({ name, run });
}

/** Run every chat-deletion hook inside the caller's transaction, before the chats are deleted. */
export async function runChatDeletionHooks(tx: Tx, fx: Effects, chatIds: string[]): Promise<void> {
  if (chatIds.length === 0) return;
  for (const hook of chatDeletionHooks) await hook.run(tx, fx, chatIds);
}
