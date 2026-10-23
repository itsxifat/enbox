# Enbox — working notes for Claude Code

Read this first. It carries the context of the long build sessions so far (the chat history
does not travel between computers). Normative design: `docs/ARCHITECTURE.md`. Feature matrix and
what is left: `docs/design/discord-parity.md` (see "Remaining gaps (audit 2026-10-23)").

## What Enbox is

A web chat app being brought to **full Discord parity** ("we need every single feature from
discord no matter what", including profiles, themes, profile and banner decorations).
Spaces = Discord servers (roles, channel permissions, categories, text / voice / forum / Stage /
announcement / media channels, threads), plus DMs, group DMs and friends.

- Stack: Node 22, Express 5, Socket.IO with the redis adapter (Valkey), Drizzle (PGlite in
  tests, Postgres 18 in production); React 19, Vite, Zustand, Tailwind 4, react-virtuoso,
  react-router 7, lucide-react, livekit-client / livekit-server-sdk, highlight.js (lazy).
- Workspaces: `packages/shared` (types, zod schemas, permission maths — used by both sides),
  `apps/server`, `apps/web`, `e2e/` (Playwright). `mobile/` is an Expo Android app that is
  **on hold: don't touch it** (the user wants the web version only for now).

## Branches

- **Active branch: `claude/discord`.** Production runs it. Always work and push here.
- `claude/zen-bohr-u65h97` is the old default branch (far behind; not merged).
- Check out the active branch (or a worktree of it) before starting:
  `git fetch origin && git checkout claude/discord` (or `git worktree add ../enbox-spaces claude/discord`).

## How the user wants to work

- Discord's look and feel everywhere. Layout = rounded **card panes** separated by gaps
  (`.card-pane`, `--pane-gap`), no 1px divider lines, the Enbox violet brand.
- **Never show Discord's name, logo or mascot** in user-visible text or assets.
- Keep shipping feature batches **without asking**; after every batch **push and deploy**.
  Visible progress matters more to them than exhaustive review.
- Ask the user only for things that need them: accounts and keys (a GIF provider key, SMTP for
  email, a CAPTCHA key), and product decisions that affect every user (see "Waiting on the user").
- Commits end with `Co-Authored-By: Claude …` attribution lines per the harness instructions.

## Batch workflow (this is what worked)

1. An Explore agent maps the code for the batch (paths, what exists, what's missing).
2. The integrator writes the **contracts** and commits them:
   - shared types in a new `packages/shared/src/<batch>.ts` (exported from `index.ts`), routes in
     `api.ts`, events in `events.ts`;
   - one Drizzle migration: edit `apps/server/src/db/schema.ts`, then
     `cd apps/server && npx drizzle-kit generate --name <batch>`. **Read the generated SQL**:
     drizzle-kit once put a new primary key before the column it used (0013 was hand-reordered);
   - stub routers registered in `apps/server/src/modules/index.ts` (before the spaces router when
     the path starts with `/spaces/:id/…`), stub jobs in `apps/server/src/jobs/register.ts`;
   - web stubs mounted at their final spots (menus, rows, AppShell hosts, settings registries,
     realtime handler files registered in `apps/web/src/realtime/index.ts`), so builders never
     fight over shared files.
3. **Six general-purpose builder agents** in parallel in the same worktree, with disjoint file
   ownership and strict rules: no git writes, re-read shared files right before small edits,
   targeted `vitest --maxWorkers=1` only, at most 3 `tsc` runs, no `npm install`, no dev servers.
   (The machine has 16 GB; full suites with 4+ workers ran out of memory.)
4. Integrate: do every "needed from others / integrator" item from their reports, then lint,
   typecheck, full tests, e2e, a smoke dry run and a web build.
5. Commit, push, deploy (below), run the smoke scripts on the host, update this file.

## Commands

- Lint `npm run lint` (root). Typecheck: `npx tsc --noEmit -p .` in each package and
  `npx tsc -p e2e/tsconfig.json`.
- Tests: shared `cd packages/shared && npx vitest run`; web `cd apps/web && npx vitest run --maxWorkers=3`;
  server `cd apps/server && ENBOX_TEST_PG_URL=postgres://enbox:enbox@127.0.0.1:5442/enbox ENBOX_TEST_REDIS_URL=redis://127.0.0.1:6390 npx vitest run --maxWorkers=2`
  (docker containers `enbox-spaces-pg` on 5442 and `enbox-spaces-valkey` on 6390 back the
  cluster/PG tests; everything else uses in-memory PGlite).
- E2E against servers you start yourself:
  - LiveKit dev server: `livekit-server --dev --bind 127.0.0.1`
  - API: in `apps/server`, `PORT=4477 PGLITE_DIR=memory DATA_DIR=./data-e2e-4477 RATE_LIMIT=off MESSAGE_REQUESTS=off LOG_LEVEL=warn NODE_ENV=development PUBLIC_URL=http://localhost:5477 LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_URL=http://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npx tsx src/index.ts`
  - web: in `apps/web`, `WEB_PORT=5477 ENBOX_API_URL=http://localhost:4477 npx vite --port 5477`
  - run: `E2E_REUSE=1 E2E_API_PORT=4477 E2E_WEB_PORT=5477 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npx playwright test`
- Windows: stopping a background `npx tsx` / `npx vite` shell leaves node listening. Free ports
  by killing the listener (`Get-NetTCPConnection -LocalPort <port>` → its process and its
  tsx/vite parent), or the next run talks to stale code.
- Prettier: the repo is not prettier-clean and this Windows checkout uses CRLF (every file
  "fails" the check). Format only files you created: `npx prettier --write --end-of-line auto <files>`.
- Keep heavy panels lazy (`lazyNamed` + Suspense): the main web chunk is ~1.32 MB.

## Production

Ask the user for the host address and use their office SSH key
(`ssh -i ~/.ssh/<office key> -o IdentitiesOnly=yes enfinito@<host>`; plain `ssh` is refused).

- Domains (all three must keep working): enbox.enfinito.cloud, enbox.cloud, enbox.dev.
- **The host is shared with other services**: keep every change isolated, gate nginx reloads on
  `nginx -t`, never touch other units, never vacuum journald.
- Layout: systemd `enbox@4000` and `enbox@4001` (rolling), Valkey on 127.0.0.1:6379, LiveKit
  (`livekit.service`; its keys exist only on the server, in `/etc/livekit/livekit.yaml` and
  `/etc/enbox/enbox.env`), coturn for calls, Postgres 18 database `enbox`. Releases in
  `/opt/enbox/releases`, active `/opt/enbox/current`, config `/etc/enbox/enbox.env`, uploads
  `/var/lib/enbox`, server notes `/opt/enbox/README.md`. nginx proxies `location /` to node.
- **Deploy** (from the repo root, Git Bash):
  `git -c core.autocrlf=false archive --format=tar HEAD | ssh … "/opt/enbox/deploy.sh $(git rev-parse --short HEAD)"`.
  `core.autocrlf=false` matters: CRLF files break the CSP hash of the inline theme script. The
  script builds, rolls the instances one by one, health-checks and rolls back on failure; add
  `--full-stop` only for a migration old code cannot run beside.
- Before a migration: `sudo -u postgres pg_dump -Fc enbox | sudo tee /var/backups/enbox/enbox-<ts>-pre-<name>.dump >/dev/null`
  then **`sudo chmod 600` it** (dumps hold password hashes and TOTP secrets; the folder is
  world-readable). Rehearse risky migrations: copy the dump down, restore it into the local docker
  Postgres (`createdb rehearsal`, `pg_restore --no-owner --no-privileges`), boot the new server
  against it, check `drizzle.__drizzle_migrations`, then **drop the copy and delete the file**
  (it holds user data).
- After a deploy: every instance's cwd is the new release
  (`sudo readlink /proc/$(systemctl show -p MainPID --value enbox@<port>)/cwd`), the migration
  count, `journalctl -u enbox@4000 -u enbox@4001 -p err --since -5min`, the smoke scripts
  (`deploy/smoke/README.md`), the three domains' `/api/health`, and the inline script hash
  against the CSP **`<meta http-equiv>` in index.html** (not a response header).

## Status

Shipped to production on `claude/discord` (newest first; each with a migration, dump and smoke):

| Batch | Commit | Highlights |
| --- | --- | --- |
| polish | b21a9c6 | super reactions, timed polls + results, formatting toolbar, forward with comment/source, ANSI, Settings ▸ Accessibility, server tags, forum post actions, media channels |
| community-2 | 8471d6b | text chat in voice, moderation tools + raid alerts, insights, Server Guide, Active Now, Go Live watching, Space preview, invite unfurls |
| safety + integrations | 65b9331 | message requests, ignore/report, webhooks + embeds, announcements, templates, players, voice polish |
| expressions + security | 5abfaad | stickers, multi-file messages, Stage + soundboard, group DMs, two-factor, badges, Streamer Mode |
| community | 98e5012 | events, forums, AutoMod, discovery/welcome/onboarding, settings overlay |
| social | f7af1be | reactions v2, custom emoji, friend requests, Inbox, threads, search |
| profiles | 90ed578 | profiles + cosmetics, drag and drop everywhere, Quick Switcher |

The batch after polish ("everyday") is recorded in `docs/HANDOFF.md`.

## Waiting on the user

- **Sign everyone out once?** Before hotfix c91305b, request logs stored bearer tokens in
  journald (the DB keeps only hashes; sessions slide, so old tokens stay valid). Asked, not answered.
- A GIF provider key (Tenor / Klipy / GIPHY) for the GIF picker.
- Optionally: require two-factor for password changes; SMTP for email and password reset.
