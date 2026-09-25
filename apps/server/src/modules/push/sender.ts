/**
 * Web Push transport and delivery (docs "Push").
 *
 * - The sender is `web-push` with the VAPID keys from config (timeout, no redirects: web-push
 *   issues a single https request); push is disabled when the keys are missing.
 * - `setPushSender(fn)` injects a different transport (tests assert payloads without network).
 * - `deliverPush` sends each entry to every subscription of its user (bounded concurrency); a
 *   404/410 from the push service deletes the subscription, and so do repeated other failures
 *   (MAX_CONSECUTIVE_FAILURES in a row, e.g. junk keys). Failures are logged, never thrown.
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
export type PushSender = (
  target: PushTarget,
  payload: PushPayload,
  opts: PushOptions,
) => Promise<void>;

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

/** At most this many push requests of one `deliverPush` call are in flight at once. */
const PUSH_CONCURRENCY = 16;
/** A subscription failing this many times in a row (other than 404/410) is dropped too (junk keys, dead endpoint). */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Consecutive non-gone failures per subscription id (this process). */
const failures = new Map<string, number>();

async function dropSubscription(sub: { id: string; endpoint: string }): Promise<void> {
  failures.delete(sub.id);
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.endpoint, sub.endpoint)))
    .catch((e: unknown) => logger.error({ err: e }, 'failed to delete a push subscription'));
}

/** Send every entry to all of its user's subscriptions (≤ PUSH_CONCURRENCY requests in flight). */
export async function deliverPush(entries: PushEntry[]): Promise<void> {
  const sender = getPushSender();
  if (!sender || entries.length === 0) return;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, uniq(entries.map((e) => e.userId))));
  const byUser = new Map<string, typeof subs>();
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);

  const jobs = entries.flatMap((entry) =>
    (byUser.get(entry.userId) ?? []).map((sub) => ({ entry, sub })),
  );
  const sendOne = async ({ entry, sub }: (typeof jobs)[number]) => {
    try {
      await sender(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        entry.payload,
        entry.opts,
      );
      failures.delete(sub.id);
    } catch (err) {
      if (isGone(err)) return dropSubscription(sub);
      const n = (failures.get(sub.id) ?? 0) + 1;
      failures.set(sub.id, n);
      logger.warn({ err, type: entry.payload.type, failures: n }, 'push delivery failed');
      if (n >= MAX_CONSECUTIVE_FAILURES) await dropSubscription(sub);
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await sendOne(jobs[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, jobs.length) }, worker));
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
