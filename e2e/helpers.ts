/**
 * E2E helpers. Users are created through the real REST API (fast) and signed in by seeding the
 * session token into localStorage, so specs can focus on the feature under test. One spec
 * (auth.spec.ts) covers the actual login/register UI.
 */
import { expect, type Browser, type BrowserContext, type Page, request as pwRequest } from '@playwright/test';
import type { AuthResponse } from '@enbox/shared';

const apiPort = Number(process.env.E2E_API_PORT ?? 4400);
export const API_URL = `http://localhost:${apiPort}`;

let seq = 0;
export function uniqueName(prefix = 'user'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`.toLowerCase().slice(0, 30);
}

export interface E2EUser extends AuthResponse {
  password: string;
}

/** Register a user via the API. */
export async function registerUser(opts: { username?: string; displayName?: string; phone?: string } = {}): Promise<E2EUser> {
  const username = opts.username ?? uniqueName();
  const password = 'password123';
  const ctx = await pwRequest.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/auth/register', {
    data: { username, displayName: opts.displayName ?? username, password, phone: opts.phone, deviceName: 'e2e' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as AuthResponse;
  await ctx.dispose();
  return { ...body, password };
}

/** Authenticated API call as `user` (for arranging state quickly). */
export async function apiAs<T = unknown>(user: Pick<AuthResponse, 'token'>, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<T> {
  const ctx = await pwRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: { Authorization: `Bearer ${user.token}` } });
  const res = await ctx.fetch(path, { method, data });
  const text = await res.text();
  await ctx.dispose();
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Open a new browser context signed in as `user` and navigate to `path`. */
export async function openAs(browser: Browser, user: Pick<AuthResponse, 'token'>, path = '/chats'): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    try {
      window.localStorage.setItem('enbox.token', token);
    } catch {
      /* ignore */
    }
  }, user.token);
  const page = await context.newPage();
  await page.goto(path);
  return { context, page };
}

/** Make `a` and `b` mutual contacts (so contact-only privacy rules pass). */
export async function makeContacts(a: E2EUser, b: E2EUser): Promise<void> {
  await apiAs(a, 'POST', '/api/contacts', { userId: b.user.id });
  await apiAs(b, 'POST', '/api/contacts', { userId: a.user.id });
}

// ---------------------------------------------------------------------------
// Chats & messages (appended by the chats/conversation slice)
// ---------------------------------------------------------------------------

/** Open (create) the direct chat between `a` and `b` as `a`; returns the chat id. */
export async function directChat(a: E2EUser, b: E2EUser): Promise<string> {
  const chat = await apiAs<{ id: string }>(a, 'POST', '/api/chats/direct', { userId: b.user.id });
  return chat.id;
}

let e2eClientSeq = 0;
/** Send a message through the API (body is a SendMessageRequest without clientId). */
export async function sendAs<T = { id: string; seq: number }>(
  user: E2EUser,
  chatId: string,
  body: Record<string, unknown>,
): Promise<T> {
  e2eClientSeq += 1;
  return apiAs<T>(user, 'POST', `/api/chats/${chatId}/messages`, {
    clientId: `e2e-${Date.now()}-${e2eClientSeq}`,
    ...body,
  });
}

/** Upload a buffer to POST /api/media as `user`. */
export async function uploadAs(
  user: E2EUser,
  file: { name: string; mimeType: string; buffer: Buffer },
  meta: Record<string, string>,
): Promise<{ id: string }> {
  const ctx = await pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${user.token}` },
  });
  const res = await ctx.post('/api/media', { multipart: { ...meta, file } });
  const text = await res.text();
  await ctx.dispose();
  if (!res.ok()) throw new Error(`upload → ${res.status()}: ${text}`);
  return JSON.parse(text) as { id: string };
}

/** A tiny valid PNG (solid color) generated in memory — no fixture files needed. */
export async function pngFixture(
  width = 64,
  height = 48,
  rgb: [number, number, number] = [109, 93, 252],
): Promise<Buffer> {
  const { deflateSync } = await import('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A short 16-bit mono WAV tone (valid audio for voice-note uploads). */
export function wavFixture(seconds = 2, rate = 8000): Buffer {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
