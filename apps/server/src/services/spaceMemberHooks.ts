/**
 * Hooks run inside the transaction that adds or removes a Space member, after the row
 * changed: raid alerts and join/leave audit (moderation), daily joins and leaves (insights).
 * Handlers register at import time from their own modules.
 */
import type { SpaceRemovedReason } from '@enbox/shared';
import type { Tx } from '../db/index.js';
import type { Effects } from './effects.js';

export interface SpaceMemberJoined {
  spaceId: string;
  userId: string;
  /** Joins without a notice (the creator, conversions): no raid counting. */
  silent: boolean;
  at: Date;
}

export interface SpaceMemberLeft {
  spaceId: string;
  userId: string;
  reason: SpaceRemovedReason;
  at: Date;
}

type Handler<E> = (tx: Tx, fx: Effects, event: E) => Promise<void> | void;

const joinedHandlers: Handler<SpaceMemberJoined>[] = [];
const leftHandlers: Handler<SpaceMemberLeft>[] = [];

export function onSpaceMemberJoined(handler: Handler<SpaceMemberJoined>): void {
  joinedHandlers.push(handler);
}

export function onSpaceMemberLeft(handler: Handler<SpaceMemberLeft>): void {
  leftHandlers.push(handler);
}

export async function runSpaceMemberJoined(
  tx: Tx,
  fx: Effects,
  e: SpaceMemberJoined,
): Promise<void> {
  for (const h of joinedHandlers) await h(tx, fx, e);
}

export async function runSpaceMemberLeft(tx: Tx, fx: Effects, e: SpaceMemberLeft): Promise<void> {
  for (const h of leftHandlers) await h(tx, fx, e);
}
