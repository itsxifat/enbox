/**
 * Helpers for the calls tests: extra devices (sessions), raw acks, polling.
 */
import { asc, eq } from 'drizzle-orm';
import type { Ack, Call, ClientToServerEvents } from '@enbox/shared';
import type { Socket as ClientSocket } from 'socket.io-client';
import { db } from '../../src/db/index.js';
import { callParticipants, calls } from '../../src/db/schema.js';
import { createSession } from '../../src/services/sessions.js';
import type { TestServer, TestSocket, TestUser } from '../helpers.js';

/** A second signed-in device of `user` (new session) with a connected socket. */
export async function device(t: TestServer, user: TestUser): Promise<{ user: TestUser; socket: TestSocket }> {
  const { token, session } = await createSession({ userId: user.id, deviceName: 'extra' });
  const u = { ...user, token, sessionId: session.id };
  return { user: u, socket: await t.connect(u) };
}

/** Emit with ack and resolve with the raw `{ ok, … }` envelope. */
export function rawAck<T = unknown>(socket: TestSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    (socket as unknown as ClientSocket).timeout(5000).emit(event as string, payload, (err: unknown, res: Ack<T>) => (err ? reject(err) : resolve(res)));
  });
}

/** Emit with ack and expect an error; resolves with it. */
export async function ackError(socket: TestSocket, event: keyof ClientToServerEvents, payload: unknown) {
  const res = await rawAck(socket, event, payload);
  if (res.ok) throw new Error(`expected ${String(event)} to fail, got ${JSON.stringify(res.data)}`);
  return res.error;
}

/** Emit with ack and expect `{ call }`. */
export async function ackCall(socket: TestSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<Call> {
  const res = await rawAck<{ call: Call }>(socket, event, payload);
  if (!res.ok) throw new Error(`${String(event)} failed: ${res.error.code} ${res.error.message}`);
  return res.data.call;
}

/** Emit without ack. */
export function send(socket: TestSocket, event: keyof ClientToServerEvents, payload: unknown): void {
  (socket as unknown as ClientSocket).emit(event as string, payload);
}

/** Poll until `cond` holds (or throw after `timeoutMs`). */
export async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 3000, what = 'condition'): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export async function callRow(callId: string) {
  const [row] = await db.select().from(calls).where(eq(calls.id, callId));
  return row!;
}

export async function partRows(callId: string) {
  return db.select().from(callParticipants).where(eq(callParticipants.callId, callId)).orderBy(asc(callParticipants.userId));
}

export async function partOf(callId: string, userId: string) {
  return (await partRows(callId)).find((p) => p.userId === userId)!;
}

export const statusOf = (call: Call, userId: string) => call.participants.find((p) => p.userId === userId)?.status;
