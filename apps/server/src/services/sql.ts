/**
 * Small SQL helpers shared by the services (raw queries, uuid[] parameters, number coercion).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A `uuid[]` SQL value bound as ONE text parameter (`'{a,b,c}'::uuid[]`), so large id lists
 * don't explode into thousands of bind parameters. Ids must be UUIDs (they come from the DB
 * or from zod-validated input); anything else is a programming error.
 */
export function uuidArray(ids: Iterable<string>): SQL {
  const list = [...ids];
  for (const id of list)
    if (!UUID_RE.test(id)) throw new Error(`uuidArray: invalid uuid ${JSON.stringify(id)}`);
  return sql`${`{${list.join(',')}}`}::uuid[]`;
}

/** Run a raw query and return its rows (snake_case keys; int8 → number; timestamps → strings). */
export async function rawRows<T>(dbx: DbOrTx, query: SQL): Promise<T[]> {
  const res = await dbx.execute(query);
  return res.rows as T[];
}

/** Coerce a raw numeric column (int8/numeric/null) to a JS number. */
export function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

/** Raw timestamp column (string or Date) → Date. */
export function toDate(v: unknown): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v as string);
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Key for (viewer, subject) / (chat, user) pair maps. */
export function pairKey(a: string, b: string): string {
  return `${a}|${b}`;
}
