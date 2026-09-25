/**
 * Status expiry (every minute, docs "Jobs" / "Status updates"): delete statuses past
 * `expires_at` in batches of 500 (`FOR UPDATE SKIP LOCKED`). Views cascade; deleting the row
 * drops its media reference so the media GC can collect the file. No events: clients drop
 * statuses at `expiresAt`.
 */
import { purgeExpiredStatuses } from '../modules/status/service.js';
import { registerJob } from './index.js';

registerJob({ name: 'status-expiry', intervalMs: 60_000, run: async () => void (await purgeExpiredStatuses()) });
