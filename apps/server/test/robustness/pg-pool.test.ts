/**
 * R4: an idle pooled PostgreSQL connection dying (`docker compose restart postgres`, a
 * failover) is logged, never an uncaught exception that kills the process.
 * Uses a minimal fake PostgreSQL wire-protocol server; no real database needed.
 */
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { closeDb, db, initDb } from '../../src/db/index.js';
import { sleep } from '../helpers.js';

describe('pg driver', () => {
  it('a Postgres restart terminating an idle pooled connection does not raise an uncaught exception', async () => {
    // AuthenticationOk + ReadyForQuery on connect; later the FATAL 57P01 a real server sends
    // to every backend when it shuts down.
    const conns: net.Socket[] = [];
    const fake = net.createServer((sock) => {
      conns.push(sock);
      sock.once('data', () => {
        const authOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
        const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
        sock.write(Buffer.concat([authOk, ready]));
      });
      sock.on('error', () => {});
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const { port } = fake.address() as AddressInfo;
    const adminShutdown = () => {
      const fields = Buffer.from(
        'SFATAL\0VFATAL\0C57P01\0Mterminating connection due to administrator command\0\0',
        'utf8',
      );
      const len = Buffer.alloc(4);
      len.writeInt32BE(fields.length + 4);
      for (const c of conns) c.end(Buffer.concat([Buffer.from('E'), len, fields]));
    };

    const saved = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      await initDb({ databaseUrl: `postgres://enbox@127.0.0.1:${port}/enbox`, migrate: false });
      const pool = (db as unknown as { $client: { connect(): Promise<{ release(): void }> } })
        .$client;
      const client = await pool.connect();
      client.release(); // idle in the pool, like between requests
      adminShutdown();
      await sleep(300);
    } finally {
      process.off('uncaughtException', onUncaught);
      for (const l of saved) process.on('uncaughtException', l as never);
      await closeDb().catch(() => {});
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
    expect(uncaught.map((e) => (e as Error).message)).toEqual([]);
  });
});
