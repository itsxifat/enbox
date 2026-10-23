/**
 * Rate limits of the public webhook routes: Discord's 5 requests per 2 seconds per webhook
 * (execute, edit and delete share the bucket), and a per-IP limit that is counted before
 * anything is looked up. Fixed windows in memory, like lib/userLimit.ts: per process, off
 * when `config.rateLimit` is off (tests switch it on for their limit cases). Over the limit
 * → `429 rate_limited` with `retry_after` (seconds), answered Discord-style by the routes.
 */
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';

export interface WindowRule {
  limit: number;
  windowMs: number;
}

/** Per webhook (Discord's). */
export const WEBHOOK_RATE_LIMIT: WindowRule = { limit: 5, windowMs: 2_000 };
/** Per client IP across all webhooks (wrong tokens included). */
export const WEBHOOK_IP_RATE_LIMIT: WindowRule = { limit: 60, windowMs: 10_000 };

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** A 429 that says when to come back (`details.retry_after`, seconds). */
export class WebhookRateLimited extends HttpError {
  constructor(public readonly retryAfterMs: number) {
    super(429, 'rate_limited', 'You are being rate limited.', {
      retry_after: Math.max(0.001, retryAfterMs / 1000),
    });
  }

  get retryAfter(): number {
    return Math.max(0.001, this.retryAfterMs / 1000);
  }
}

/** Count one request for `key` under `rule`; throws WebhookRateLimited when over. */
export function takeWebhookLimit(key: string, rule: WindowRule): void {
  if (!config.rateLimit) return;
  const now = Date.now();
  sweep(now);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(key, b);
  }
  if (b.count >= rule.limit) throw new WebhookRateLimited(b.resetAt - now);
  b.count += 1;
}

/** Tests: forget every counter. */
export function resetWebhookLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
