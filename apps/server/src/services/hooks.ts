/**
 * Cross-module hook registries.
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
