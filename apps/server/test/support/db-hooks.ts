/**
 * Deterministic race/failure injection for regression tests (PGlite or node-postgres root
 * client). Races are reproduced by controlling WHEN a query's result is delivered (network
 * latency on PostgreSQL) and failures by making one statement fail — never by changing
 * product code.
 */
import { db } from '../../src/db/index.js';

type AnyFn = (...args: unknown[]) => Promise<unknown>;
type TxClient = { query: AnyFn };
type RootClient = {
  query: AnyFn;
  transaction: (cb: (tx: TxClient) => Promise<unknown>) => Promise<unknown>;
};

const rootClient = () => (db as unknown as { $client: RootClient }).$client;
export const textOf = (a0: unknown) =>
  typeof a0 === 'string' ? a0 : ((a0 as { text?: string } | undefined)?.text ?? '');

/**
 * Delay the RESULT of the next global-db query (outside transactions) matching `match` until
 * `release()`: the query itself runs at once, so its snapshot is taken now.
 */
export function delayNextResult(match: (text: string, params: unknown[]) => boolean) {
  const client = rootClient();
  const original = client.query;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let onHit!: () => void;
  const hit = new Promise<void>((r) => (onHit = r));
  let armed = true;
  client.query = function (this: unknown, ...args: unknown[]) {
    const params = (args[1] as unknown[] | undefined) ?? [];
    const p = original.apply(this, args);
    if (armed && match(textOf(args[0]), params)) {
      armed = false;
      onHit();
      return p.then(async (res) => {
        await gate;
        return res;
      });
    }
    return p;
  } as AnyFn;
  return {
    hit,
    release: () => {
      client.query = original;
      release();
    },
  };
}

/** Run `onHit` right after the next global-db query matching `match` returned (before its caller continues). */
export function afterNextResult(
  match: (text: string, params: unknown[]) => boolean,
  onHit: () => Promise<void>,
) {
  const client = rootClient();
  const original = client.query;
  let fired = false;
  client.query = async function (this: unknown, ...args: unknown[]) {
    const result = await original.apply(this, args);
    if (!fired && match(textOf(args[0]), (args[1] as unknown[] | undefined) ?? [])) {
      fired = true;
      await onHit();
    }
    return result;
  } as AnyFn;
  return { restore: () => void (client.query = original), fired: () => fired };
}

/** Make the next global-db query matching `match` fail (a transient DB error). */
export function failNextGlobalQuery(match: (text: string) => boolean) {
  const client = rootClient();
  const original = client.query;
  let failed = false;
  client.query = function (this: unknown, ...args: unknown[]) {
    if (!failed && match(textOf(args[0]))) {
      failed = true;
      client.query = original;
      return Promise.reject(new Error('injected: connection terminated unexpectedly'));
    }
    return original.apply(this, args);
  } as AnyFn;
  return { restore: () => void (client.query = original), failed: () => failed };
}

/** Make the next statement matching `match` inside a transaction fail (PGlite driver). */
export function failNextTxQuery(match: (text: string) => boolean) {
  const client = rootClient();
  const original = client.transaction;
  let failed = false;
  client.transaction = function (this: unknown, cb: (tx: TxClient) => Promise<unknown>) {
    return original.call(this, (tx) => {
      const q = tx.query;
      tx.query = function (this: unknown, ...args: unknown[]) {
        if (!failed && match(textOf(args[0]))) {
          failed = true;
          return Promise.reject(new Error('injected: deadlock detected'));
        }
        return q.apply(this, args);
      } as AnyFn;
      return cb(tx);
    });
  } as RootClient['transaction'];
  return { restore: () => void (client.transaction = original), failed: () => failed };
}

/**
 * Delay the RESULT of the next statement matching `match` run inside a transaction (PGlite
 * driver) until `release()`; the transaction stays open meanwhile.
 */
export function delayNextTxResult(match: (text: string, params: unknown[]) => boolean) {
  const client = rootClient();
  const original = client.transaction;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let onHit!: () => void;
  const hit = new Promise<void>((r) => (onHit = r));
  let armed = true;
  client.transaction = function (this: unknown, cb: (tx: TxClient) => Promise<unknown>) {
    return original.call(this, (tx) => {
      const q = tx.query;
      tx.query = function (this: unknown, ...args: unknown[]) {
        const p = q.apply(this, args);
        if (armed && match(textOf(args[0]), (args[1] as unknown[] | undefined) ?? [])) {
          armed = false;
          onHit();
          return p.then(async (res) => {
            await gate;
            return res;
          });
        }
        return p;
      } as AnyFn;
      return cb(tx);
    });
  } as RootClient['transaction'];
  return {
    hit,
    release: () => {
      client.transaction = original;
      release();
    },
  };
}

/** Record the parameters of every `SELECT … FROM "chats" … FOR UPDATE` run inside transactions (lock-order checks). */
export function recordChatLocks() {
  const client = rootClient();
  const original = client.transaction;
  /** Chat-lock batches in order, tagged with the transaction that took them. */
  const batches: { tx: number; ids: string[] }[] = [];
  let txSeq = 0;
  client.transaction = function (this: unknown, cb: (tx: TxClient) => Promise<unknown>) {
    const txId = ++txSeq;
    return original.call(this, (tx) => {
      const query = tx.query.bind(tx);
      tx.query = ((q: string, params?: unknown[], opts?: unknown) => {
        if (/from "chats"/i.test(q) && /for update/i.test(q))
          batches.push({ tx: txId, ids: (params ?? []).map(String) });
        return query(q, params, opts);
      }) as AnyFn;
      return cb(tx);
    });
  } as RootClient['transaction'];
  return {
    batches,
    restore: () => void (client.transaction = original),
    /**
     * Chat ids newly locked while a higher id was already held BY THE SAME TRANSACTION
     * (normative order: sorted). Locks from other, concurrent transactions (e.g. post-commit
     * listeners) are independent and must not be mixed in.
     */
    violations(): string[] {
      const heldByTx = new Map<number, Set<string>>();
      const out: string[] = [];
      for (const { tx, ids } of batches) {
        let held = heldByTx.get(tx);
        if (!held) heldByTx.set(tx, (held = new Set()));
        for (const id of ids) {
          if (held.has(id)) continue;
          const higher = [...held].filter((h) => h > id);
          if (higher.length) out.push(`${id} locked after ${higher.join(',')} (tx ${tx})`);
          held.add(id);
        }
      }
      return out;
    },
    held(): Set<string> {
      return new Set(batches.flatMap((b) => b.ids));
    },
  };
}
