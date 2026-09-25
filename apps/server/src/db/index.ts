/**
 * Database client. Uses PostgreSQL (node-postgres) when DATABASE_URL is set, otherwise an
 * embedded PGlite instance (on disk for dev, in memory for tests). Both expose the same
 * Drizzle query API; the PGlite instance is typed as the node-postgres database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';
import { logger } from '../lib/logger.js';

export { schema };
export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the root db or a transaction. */
export type DbOrTx = Database | Tx;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
  driver: 'pg' | 'pglite';
}

/** Process-wide database (live ESM binding, set by `initDb`). */
export let db: Database = undefined as unknown as Database;
let handle: DbHandle | undefined;

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(here, '../../drizzle'), // src/db -> apps/server/drizzle
    path.resolve(here, '../drizzle'), // dist -> apps/server/drizzle
    path.resolve(process.cwd(), 'drizzle'),
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`Drizzle migrations folder not found (tried ${candidates.join(', ')})`);
  return found;
}

export interface InitDbOptions {
  databaseUrl?: string;
  /** PGlite directory, or 'memory'. */
  pgliteDir?: string;
  migrate?: boolean;
}

export async function initDb(opts: InitDbOptions): Promise<DbHandle> {
  if (handle) await handle.close();
  const shouldMigrate = opts.migrate ?? true;
  if (opts.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 20 });
    const database = drizzle(pool, { schema });
    if (shouldMigrate) {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(database, { migrationsFolder: migrationsFolder() });
    }
    handle = { db: database, close: () => pool.end(), driver: 'pg' };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const dir = opts.pgliteDir ?? 'memory';
    if (dir !== 'memory') fs.mkdirSync(dir, { recursive: true });
    const client = dir === 'memory' ? new PGlite() : new PGlite(dir);
    const database = drizzle(client, { schema });
    if (shouldMigrate) {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(database, { migrationsFolder: migrationsFolder() });
    }
    handle = { db: database as unknown as Database, close: () => client.close(), driver: 'pglite' };
    if (dir !== 'memory') logger.info({ dir }, 'Using embedded PGlite database (set DATABASE_URL for PostgreSQL)');
  }
  db = handle.db;
  return handle;
}

export async function closeDb(): Promise<void> {
  if (handle) {
    await handle.close();
    handle = undefined;
  }
}
