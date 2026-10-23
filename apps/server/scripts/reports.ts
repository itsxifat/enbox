/**
 * Operator review queue: prints reports, newest first (open ones by default), with the
 * reporter, the target and its evidence snapshot. Reads the same environment as the server
 * (DATABASE_URL, or PGLITE_DIR / DATA_DIR; stop the server first when it uses PGlite).
 *
 *   npx tsx scripts/reports.ts                    # open reports, 50 at a time
 *   npx tsx scripts/reports.ts --status all --limit 200
 *   npx tsx scripts/reports.ts --before <cursor>  # the next page (printed at the end)
 *   npx tsx scripts/reports.ts --json             # one JSON object per line
 *
 * Read-only: it never changes a report (moderators resolve Space reports in the app).
 */
import { REPORT_CATEGORIES, REPORT_STATUSES, truncate, type ReportStatus } from '@enbox/shared';

// The server's info logs would mix with the listing (the logger reads this on import).
process.env.LOG_LEVEL ??= 'warn';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const statusArg = arg('status') ?? 'open';
  if (statusArg !== 'all' && !(REPORT_STATUSES as readonly string[]).includes(statusArg))
    throw new Error(`--status must be one of all, ${REPORT_STATUSES.join(', ')}`);
  const status = statusArg === 'all' ? undefined : (statusArg as ReportStatus);
  const limit = Math.min(Math.max(Number(arg('limit') ?? 50) || 50, 1), 500);
  const json = process.argv.includes('--json');

  const { config } = await import('../src/config.js');
  // `dbm.db` is a live binding, set by initDb.
  const dbm = await import('../src/db/index.js');
  const { listReports } = await import('../src/modules/reports/service.js');
  const { getUserRows } = await import('../src/services/users.js');
  const { closeDb, initDb } = dbm;

  await initDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir, migrate: false });
  try {
    const db = dbm.db;
    const { rows, nextCursor } = await listReports(db, { status, before: arg('before'), limit });
    const reporters = await getUserRows(
      db,
      rows.map((r) => r.reporterId).filter((id): id is string => !!id),
    );
    for (const r of rows) {
      const reporter = r.reporterId ? reporters.get(r.reporterId) : undefined;
      if (json) {
        console.log(JSON.stringify({ ...r, reporter: reporter?.username ?? null }));
        continue;
      }
      const e = r.evidence;
      const about =
        r.targetType === 'message'
          ? `message ${r.targetId} by ${e.user ? `@${e.user.username}` : 'a webhook'}`
          : r.targetType === 'user'
            ? `user @${e.user?.username ?? r.targetId}`
            : `Space "${e.space?.name ?? r.targetId}"`;
      console.log(
        `${r.createdAt.toISOString()}  ${r.status.toUpperCase().padEnd(9)} ${r.category.padEnd(13)} ${about}`,
      );
      console.log(`  id ${r.id} · reporter ${reporter ? `@${reporter.username}` : '(deleted)'}`);
      if (r.spaceId) console.log(`  Space ${e.space?.name ?? ''} (${r.spaceId})`);
      if (e.message) {
        console.log(`  in chat ${e.message.chatId} at ${e.message.createdAt}`);
        if (e.message.text)
          console.log(`  "${truncate(e.message.text.replace(/\s+/g, ' '), 200)}"`);
        for (const url of e.message.mediaUrls) console.log(`  file ${url}`);
      }
      if (r.details) console.log(`  details: ${truncate(r.details.replace(/\s+/g, ' '), 300)}`);
      if (r.resolvedAt)
        console.log(`  ${r.status} at ${r.resolvedAt.toISOString()} by ${r.resolvedBy}`);
      console.log('');
    }
    if (!json) {
      console.log(
        `${rows.length} report(s)${status ? ` (${status})` : ''}. Categories: ${REPORT_CATEGORIES.join(', ')}.`,
      );
      if (nextCursor) console.log(`More: --before ${nextCursor}`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
