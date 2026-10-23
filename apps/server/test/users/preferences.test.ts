/**
 * Synced preferences (`GET|PATCH /api/me/preferences`): an opaque document per user, merged
 * key by key (null deletes), size-capped, ordered by `updatedAt`, and pushed whole to every
 * device of mine as `me:preferences`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PREFERENCES_MAX_BYTES, type SyncedPreferences } from '@enbox/shared';
import { mergePreferences } from '../../src/modules/preferences/routes.js';
import { newDevice } from '../accounts/util.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';

describe('synced preferences', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const get = async (user: TestUser) =>
    (await t.api(user).get('/api/me/preferences').expect(200)).body as SyncedPreferences;
  const patch = async (user: TestUser, body: unknown, status = 200) =>
    (
      await t
        .api(user)
        .patch('/api/me/preferences')
        .send(body as object)
        .expect(status)
    ).body as SyncedPreferences;

  it('starts empty and needs a session', async () => {
    const me = await t.createUser();
    expect(await get(me)).toEqual({ prefs: {}, updatedAt: null });
    await t.api().get('/api/me/preferences').expect(401);
    await t.api().patch('/api/me/preferences').send({ theme: 'light' }).expect(401);
  });

  it('merges keys, deletes on null and keeps everything else as given', async () => {
    const me = await t.createUser();
    const first = await patch(me, { theme: 'light', zoom: 1.25, roleColors: 'dot' });
    expect(first.prefs).toEqual({ theme: 'light', zoom: 1.25, roleColors: 'dot' });
    expect(first.updatedAt).not.toBeNull();

    const second = await patch(me, {
      zoom: null,
      customThemeColors: ['#112233', '#445566'],
      nested: { a: [1, 2] },
    });
    expect(second.prefs).toEqual({
      theme: 'light',
      roleColors: 'dot',
      customThemeColors: ['#112233', '#445566'],
      nested: { a: [1, 2] },
    });
    expect(Date.parse(second.updatedAt!)).toBeGreaterThan(Date.parse(first.updatedAt!));
    expect(await get(me)).toEqual(second);
    // Someone else's document is their own.
    expect(await get(await t.createUser())).toEqual({ prefs: {}, updatedAt: null });
  });

  it('moves updatedAt strictly forward on every change, not on a no-op', async () => {
    const me = await t.createUser();
    const stamps: number[] = [];
    for (let i = 0; i < 5; i++) stamps.push(Date.parse((await patch(me, { zoom: i })).updatedAt!));
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]!);

    const same = await patch(me, { zoom: 4, missing: null });
    expect(Date.parse(same.updatedAt!)).toBe(stamps[4]);
    expect((await patch(me, {})).updatedAt).toBe(same.updatedAt);
  });

  it('rejects bodies that are not a map of short keys, and documents over the cap', async () => {
    const me = await t.createUser();
    await patch(me, ['theme'], 400);
    await patch(me, { ['k'.repeat(65)]: true }, 400);
    await patch(me, { '': true }, 400);
    await patch(me, { blob: 'x'.repeat(PREFERENCES_MAX_BYTES) }, 400);

    // Each patch fits, the merged document would not: 400 and nothing saved.
    const half = 'y'.repeat(PREFERENCES_MAX_BYTES / 2 + 10);
    await patch(me, { a: half });
    const before = await get(me);
    const res = await t.api(me).patch('/api/me/preferences').send({ b: half }).expect(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(await get(me)).toEqual(before);
  });

  it('sends the whole document to all my devices, and only mine', async () => {
    const me = await t.createUser();
    const other = await t.createUser();
    const laptop = await t.connect(me);
    const phone = await t.connect(await newDevice(me));
    const stranger = await t.connect(other);

    const atLaptop = waitForEvent(laptop, 'me:preferences');
    const atPhone = waitForEvent(phone, 'me:preferences');
    const nothingForThem = expectNoEvent(stranger, 'me:preferences');
    const saved = await patch(me, { theme: 'onyx', uiDensity: 'compact' });
    expect(await atPhone).toEqual(saved);
    // The device that saved it gets the echo too (it already has that updatedAt).
    expect(await atLaptop).toEqual(saved);
    await nothingForThem;

    // A no-op sends nothing.
    const quiet = expectNoEvent(phone, 'me:preferences');
    await patch(me, { theme: 'onyx' });
    await quiet;
  });

  it('merges without prototype tricks', () => {
    const patchWithProto = JSON.parse(
      '{"__proto__": {"polluted": true}, "theme": "dark"}',
    ) as Record<string, unknown>;
    const merged = mergePreferences({ zoom: 1 }, patchWithProto);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(merged.theme).toBe('dark');
    expect(mergePreferences({ a: 1, b: 2 }, { a: null, c: false })).toEqual({ b: 2, c: false });
  });
});
