/**
 * Valkey/Redis clients (REDIS_URL). Every consumer gets its own connection: a subscribed
 * connection can't run other commands, and the Socket.IO adapter manages its own pair.
 * node-redis reconnects by itself; without an 'error' listener an error would be thrown.
 */
import { createClient } from 'redis';
import { logger } from '../lib/logger.js';

export type RedisClient = ReturnType<typeof createClient>;

export function createRedis(url: string, name: string): RedisClient {
  const client = createClient({ url });
  client.on('error', (err) => logger.error({ err, client: name }, 'redis error'));
  return client;
}
