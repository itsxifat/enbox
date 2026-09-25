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

// --- Groups, communities, channels, invites (agent 3) ---------------------------------

/** Open the info panel of the conversation on screen by clicking its header title. */
export async function openChatInfo(page: Page, title: string): Promise<void> {
  await page.locator('header').getByText(title, { exact: true }).first().click();
}

/** Create a group via the API as `owner` (members are added directly). */
export async function createGroupAs(
  owner: E2EUser,
  name: string,
  members: E2EUser[] = [],
  extra: Record<string, unknown> = {},
): Promise<{ id: string; inviteCode: string | null }> {
  const r = await apiAs<{ chat: { id: string; inviteCode: string | null } }>(
    owner,
    'POST',
    '/api/groups',
    {
      name,
      memberIds: members.map((m) => m.user.id),
      ...extra,
    },
  );
  return r.chat;
}
