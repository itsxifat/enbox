/**
 * Database client. Uses PostgreSQL (node-postgres) when DATABASE_URL is set, otherwise an
 * embedded PGlite instance (on disk for dev, in memory for tests). Both expose the same
 * Drizzle query API; the PGlite instance is typed as the node-postgres database.
 *
 * Transaction rule: inside `db.transaction(async (tx) => ...)` use ONLY `tx` — pass it down
 * to every service (`dbx: DbOrTx` first parameter). Using the global `db` (or starting a
 * nested `db.transaction`) inside a transaction deadlocks forever on PGlite (single
 * connection) and can self-deadlock on row locks with pg. Never await network/file I/O
 * inside a transaction; emit socket events after commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';
import { logger } from '../lib/logger.js';
import { ADVISORY_MIGRATE, ADVISORY_NAMESPACE } from '../cluster/constants.js';

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
  /** node-postgres pool (pg driver only): dedicated connections for session advisory locks. */
  pool?: Pool;
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
  if (!found)
    throw new Error(`Drizzle migrations folder not found (tried ${candidates.join(', ')})`);
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
    const pg = (await import('pg')).default;
    // int8 (count(*), seqs, watermarks) and numeric come back as strings from node-postgres but
    // as numbers from PGlite; parse them as JS numbers on both drivers (all our values < 2^53).
    pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));
    pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
    const { Pool } = pg;
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 20 });
    // An idle pooled client whose connection dies (Postgres restart/failover, network blip)
    // is re-emitted as a pool 'error'; unhandled, it would crash the process. The pool
    // replaces the client on the next checkout.
    pool.on('error', (err) => logger.error({ err }, 'idle PostgreSQL client error'));
    const database = drizzle(pool, { schema });
    if (shouldMigrate) {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      // Several processes boot together (docs "Cluster"): the advisory lock makes the others
      // wait, then find nothing pending. It is held on its own connection; the migrator uses
      // the pool's other connections.
      await withSessionLock(pool, ADVISORY_MIGRATE, () =>
        migrate(database, { migrationsFolder: migrationsFolder() }),
      );
    }
    handle = { db: database, close: () => pool.end(), driver: 'pg', pool };
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
    if (dir !== 'memory')
      logger.info({ dir }, 'Using embedded PGlite database (set DATABASE_URL for PostgreSQL)');
  }
  db = handle.db;
  return handle;
}

/**
 * Run `fn` while holding the session advisory lock (ADVISORY_NAMESPACE, key) on a dedicated
 * connection of `pool` (waits for the lock). PGlite has one connection and one process: no lock.
 */
export async function withSessionLock<T>(
  pool: Pool,
  key: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1::int, $2::int)', [ADVISORY_NAMESPACE, key]);
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock($1::int, $2::int)', [ADVISORY_NAMESPACE, key]);
    }
  } finally {
    client.release();
  }
}

/** The node-postgres pool, or undefined on PGlite. */
export function pgPool(): Pool | undefined {
  return handle?.pool;
}

/** Which driver the process database uses. */
export function dbDriver(): DbHandle['driver'] | undefined {
  return handle?.driver;
}

export async function closeDb(): Promise<void> {
  if (handle) {
    await handle.close();
    handle = undefined;
  }
}
