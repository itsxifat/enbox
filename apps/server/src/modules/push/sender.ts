/**
 * Web Push transport and delivery (docs "Push").
 *
 * - The sender is `web-push` with the VAPID keys from config (timeout, no redirects: web-push
 *   issues a single https request); push is disabled when the keys are missing.
 * - `setPushSender(fn)` injects a different transport (tests assert payloads without network).
 * - `deliverPush` sends each entry to every subscription of its user; a 404/410 from the push
 *   service deletes the subscription. Failures are logged, never thrown.
 * - Everything runs after commit (domain events); in-flight deliveries are tracked so tests
 *   can await them (`pushIdle`).
 */
import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import type { PushPayload } from '@enbox/shared';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { pushSubscriptions } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { uniq } from '../../services/sql.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushOptions {
  /** Seconds the push service keeps an undelivered message. */
  ttl: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

/**
 * Sends one push message. Rejects on failure; an error with `statusCode` 404 or 410 means the
 * subscription is gone (it is then deleted).
 */
export type PushSender = (target: PushTarget, payload: PushPayload, opts: PushOptions) => Promise<void>;

const PUSH_TIMEOUT_MS = 10_000;

const webPushSender: PushSender = async (target, payload, opts) => {
  const { publicKey, privateKey, subject } = config.vapid;
  await webpush.sendNotification(target, JSON.stringify(payload), {
    vapidDetails: { subject, publicKey: publicKey!, privateKey: privateKey! },
    TTL: opts.ttl,
    urgency: opts.urgency,
    timeout: PUSH_TIMEOUT_MS,
  });
};

let injected: PushSender | null | undefined;

/** Replace the transport (tests). `undefined` restores the default (web-push when VAPID is configured). */
export function setPushSender(sender: PushSender | null | undefined): void {
  injected = sender;
}

/** The active transport, or null when push is disabled (no VAPID keys and nothing injected). */
export function getPushSender(): PushSender | null {
  if (injected !== undefined) return injected;
  return config.vapid.publicKey && config.vapid.privateKey ? webPushSender : null;
}

export interface PushEntry {
  userId: string;
  payload: PushPayload;
  opts: PushOptions;
}

function isGone(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return status === 404 || status === 410;
}

/** Send every entry to all of its user's subscriptions. */
export async function deliverPush(entries: PushEntry[]): Promise<void> {
  const sender = getPushSender();
  if (!sender || entries.length === 0) return;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, uniq(entries.map((e) => e.userId))));
  const byUser = new Map<string, typeof subs>();
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);

  const sends: Promise<void>[] = [];
  for (const entry of entries) {
    for (const sub of byUser.get(entry.userId) ?? []) {
      sends.push(
        sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, entry.payload, entry.opts).catch(async (err: unknown) => {
          if (isGone(err)) {
            await db
              .delete(pushSubscriptions)
              .where(and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.endpoint, sub.endpoint)))
              .catch((e: unknown) => logger.error({ err: e }, 'failed to delete an expired push subscription'));
          } else {
            logger.warn({ err, type: entry.payload.type }, 'push delivery failed');
          }
        }),
      );
    }
  }
  await Promise.all(sends);
}

const inflight = new Set<Promise<unknown>>();

/** Track background push work (so tests can await it with `pushIdle`). */
export function trackPush(work: Promise<unknown>): void {
  const p = work.catch((err: unknown) => logger.error({ err }, 'push notification failed'));
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

/** Resolve once every tracked push job has finished (tests). */
export async function pushIdle(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}
