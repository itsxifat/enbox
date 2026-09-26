/**
 * 0001_profiles: the profile/presence columns on `users`, the animated/metadata columns on
 * `media`, their CHECKs, partial indexes and the banner FK (docs/design/ux-programme.md
 * "Data model → 0001_profiles"). The fresh PGlite behind startTestServer() applied every
 * migration in apps/server/drizzle, so this also proves the migration chain is consistent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, users } from '../../src/db/schema.js';
import { rawRows } from '../../src/services/sql.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';

/**
 * The statement fails with a check_violation (SQLSTATE 23514) of this constraint. Drizzle
 * wraps the driver error (`DrizzleQueryError.cause`), so walk the cause chain like
 * `pgError()` in modules/auth/service.ts does.
 */
async function expectCheckViolation(run: Promise<unknown>, constraint: string) {
  let err: unknown;
  await run.then(
    () => {
      throw new Error(`expected a violation of ${constraint}`);
    },
    (e: unknown) => {
      err = e;
    },
  );
  for (let i = 0; i < 3 && err && typeof err === 'object'; i++) {
    const x = err as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof x.code === 'string') {
      expect(x.code).toBe('23514');
      expect(x.constraint ?? x.message).toContain(constraint);
      return;
    }
    err = x.cause;
  }
  throw new Error(`no PostgreSQL error in the cause chain for ${constraint}`);
}

describe('db/0001_profiles', () => {
  let t: TestServer;
  let u: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    u = await t.createUser();
  });
  afterAll(() => t.close());

  const userRow = async () => (await db.select().from(users).where(eq(users.id, u.id)))[0]!;
  const insertMedia = async () =>
    (
      await db
        .insert(media)
        .values({
          uploaderId: u.id,
          kind: 'image',
          mimeType: 'image/gif',
          size: 1,
          storageKey: `test/${crypto.randomUUID()}.gif`,
        })
        .returning()
    )[0]!;

  it('defaults the new user columns', async () => {
    expect(await userRow()).toMatchObject({
      bannerMediaId: null,
      pronouns: null,
      bio: '',
      profileColor: null,
      accentColor: null,
      availability: 'online',
      availabilityUntil: null,
      presenceNoteText: null,
      presenceNoteEmoji: null,
      presenceNoteExpiresAt: null,
    });
  });

  it('defaults the new media columns', async () => {
    expect(await insertMedia()).toMatchObject({
      animated: false,
      frameCount: null,
      metadataStripped: false,
    });
  });

  it('accepts lowercase #rrggbb colours and rejects anything else', async () => {
    await db
      .update(users)
      .set({ profileColor: '#1a2b3c', accentColor: '#ffffff' })
      .where(eq(users.id, u.id));
    expect(await userRow()).toMatchObject({ profileColor: '#1a2b3c', accentColor: '#ffffff' });
    for (const bad of ['#ABCDEF', '#fff', 'red', '1a2b3c', '#1a2b3c ', '']) {
      await expectCheckViolation(
        db.update(users).set({ profileColor: bad }).where(eq(users.id, u.id)),
        'users_profile_color_ck',
      );
      await expectCheckViolation(
        db.update(users).set({ accentColor: bad }).where(eq(users.id, u.id)),
        'users_accent_color_ck',
      );
    }
    await db.update(users).set({ profileColor: null, accentColor: null }).where(eq(users.id, u.id));
    expect(await userRow()).toMatchObject({ profileColor: null, accentColor: null });
  });

  it('restricts availability to online/idle/dnd/invisible', async () => {
    for (const ok of ['idle', 'dnd', 'invisible', 'online'] as const) {
      await db.update(users).set({ availability: ok }).where(eq(users.id, u.id));
      expect((await userRow()).availability).toBe(ok);
    }
    await expectCheckViolation(
      db
        .update(users)
        .set({ availability: sql`'away'` })
        .where(eq(users.id, u.id)),
      'users_availability_ck',
    );
    expect((await userRow()).availability).toBe('online');
  });

  it('links the banner (relation + SET NULL on media delete)', async () => {
    const m = await insertMedia();
    await db.update(users).set({ bannerMediaId: m.id }).where(eq(users.id, u.id));
    const withBanner = await db.query.users.findFirst({
      where: eq(users.id, u.id),
      with: { banner: true },
    });
    expect(withBanner?.banner?.id).toBe(m.id);
    await db.delete(media).where(eq(media.id, m.id));
    expect((await userRow()).bannerMediaId).toBeNull();
  });

  it('creates the partial indexes for the banner and the expiry job', async () => {
    const rows = await rawRows<{ indexname: string; indexdef: string }>(
      db,
      sql`select indexname, indexdef from pg_indexes
          where tablename = 'users'
            and indexname in ('users_banner_idx', 'users_availability_until_idx', 'users_presence_note_expires_idx')
          order by indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'users_availability_until_idx',
      'users_banner_idx',
      'users_presence_note_expires_idx',
    ]);
    for (const r of rows) expect(r.indexdef).toMatch(/WHERE \(\w+ IS NOT NULL\)$/);
  });
});
