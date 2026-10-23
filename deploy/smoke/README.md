# Smoke tests

End-to-end API checks for each feature batch, run against a live deployment. Each script
registers throwaway users, exercises one batch's features across both cluster instances (A on
:4000, B on :4001, so realtime events must cross processes through Valkey), prints one JSON
line of results and deletes everything it made.

| Script | Covers |
| --- | --- |
| `social-smoke.mjs` | friends, reaction deltas across processes, Inbox, threads, search, custom emoji |
| `community-smoke.mjs` | events, forums, AutoMod, pins, discovery |
| `expressions-smoke.mjs` | stickers, multi-file messages, group DMs, Stage + soundboard, two-factor sign-in |
| `platform-smoke.mjs` | message requests, ignore, reports, webhooks, announcements + follows, templates, voice status |
| `community2-smoke.mjs` | text in voice, moderation and Mod View, invite pause, insights, Server Guide, Active Now, Space preview, invite unfurl |
| `polish-smoke.mjs` | super reactions, timed polls + results, forward with comment/source, server tags, forum follow/pin, media channels |
| `everyday-smoke.mjs` | @silent, the Space message limit, channel mentions, synced preferences, bookmarks + reminders, friend invite links |

## On the production host

The scripts import `socket.io-client`, which resolves from the folder they run in, so copy them
into the current release's server folder, run them with the release's Node, then delete them:

```sh
tar cf - deploy/smoke/*-smoke.mjs | ssh <prod> 'cd /opt/enbox/current/apps/server && tar xf - --strip-components=2 \
  && for s in *-smoke.mjs; do echo "== $s"; timeout 120 /opt/enbox/node/bin/node $s | tail -3; done; rm -f *-smoke.mjs'
```

Sign-in and sign-up are limited to 20 per 10 minutes per address, and the scripts register
two or three users each (some sign in again), so running all seven back to back can end with a
`register 429`: wait ten minutes and rerun the last ones.

Every value in the printed JSON should be `true`, a 2xx status where one is expected, or the
expected refusal (403/404/409/410/400). `everyday-smoke.mjs` waits up to ~50 s for the reminder
job (leader, every 30 s).

## Locally (dry run before a deploy)

Start an API without `MESSAGE_REQUESTS=off` (the e2e API turns it off), e.g. on 4479 with
`PGLITE_DIR=memory`, copy the script into `apps/server`, and point both instances at it:
`SMOKE_A=http://localhost:4479 SMOKE_B=http://localhost:4479 node polish-smoke.mjs`. Cross-process
checks then run in one process, which still proves the events fire.
