# Deploying Enbox (native host)

The production host runs Enbox as several identical processes behind nginx, sharing PostgreSQL
and Valkey (docs/ARCHITECTURE.md "Cluster"). Files here are the reviewed copies of what is
installed on the host.

| File                        | Installed as                                                              |
| --------------------------- | ------------------------------------------------------------------------- |
| `deploy.sh`                 | `/opt/enbox/deploy.sh`                                                    |
| `systemd/enbox@.service`    | `/etc/systemd/system/enbox@.service`                                      |
| `nginx/enbox-upstream.conf` | the `upstream enbox_app` block of `/etc/nginx/sites-available/enbox.conf` |
| `valkey/enbox.conf`         | settings in `/etc/valkey/valkey.conf`                                     |

## One-time setup

1. Valkey: `sudo apt install valkey-server`, apply `valkey/enbox.conf`, `sudo systemctl enable --now valkey-server`.
2. `/etc/enbox/enbox.env`: add `REDIS_URL=redis://127.0.0.1:6379`; drop `PORT` (each instance
   sets its own).
3. `/etc/enbox/instances`: one port per line (e.g. `4000` and `4001`).
4. Install `enbox@.service`, `sudo systemctl daemon-reload`, disable the old single
   `enbox.service`, `sudo systemctl enable --now enbox@4000 enbox@4001`.
5. nginx: replace the upstream block with `nginx/enbox-upstream.conf`, `sudo nginx -t && sudo systemctl reload nginx`.
6. PostgreSQL: each process opens up to 20 pooled connections plus one for the jobs leader
   lock; keep `max_connections` above `processes × 21` plus the other apps on the host.

## Releases

```sh
git archive --format=tar HEAD | ssh enfinito@<host> /opt/enbox/deploy.sh "$(git rev-parse --short HEAD)"
```

The script builds a new release, switches `/opt/enbox/current`, restarts the instances one at
a time (each must answer `GET /api/health` before the next restarts) and rolls back on failure.
Pass `--full-stop` as the second argument for a release whose boot-time migration must not run
next to old processes (it stops every instance first).

## Voice channels (LiveKit)

Voice channels use a self-hosted LiveKit server next to the app (files in `deploy/livekit/`):

- `/opt/livekit/livekit-server` (pinned release), run by `livekit.service` as the `livekit` user
  with `/etc/livekit/livekit.yaml` (root:livekit 0640; the API key and secret live only there and
  in `/etc/enbox/enbox.env` as `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`).
- Signalling stays on 127.0.0.1:7880 and is proxied by nginx at `https://<domain>/livekit/`
  (`/etc/nginx/snippets/enbox-livekit.conf`, included from the app snippet). Clients get
  `LIVEKIT_URL=/livekit` from `/api/config` and connect on the page's own origin.
- Media: UDP 7882-7892 and TCP 7881 on the LAN address, advertised as the public IP.
  - **Relay mode** (now, `VOICE_RELAY_ONLY=true`): the router does not forward those ports, so
    clients send media through coturn (already reachable on 3478 with relays 50000-50999). The
    coturn guard (`/etc/enbox/coturn-guard.nft`) lets coturn reach this host only on its own relay
    ports, its listener, and LiveKit's UDP 7882-7892.
  - **Direct mode**: forward TCP 7881 and UDP 7882-7892 to 192.168.20.237, `ufw allow 7881/tcp`
    and `ufw allow 7882:7892/udp`, set `VOICE_RELAY_ONLY=false`, redeploy.
- The app keeps `voice_states` in Postgres (truth for sidebars); the jobs leader drops states of
  dead processes and departed members; `voice:join` mints 10-minute LiveKit tokens whose publish
  grants follow the channel permissions (SPEAK, VIDEO, STREAM) and server mute/deafen.
- Health: `curl -fsS http://127.0.0.1:7880/` → `OK`; `journalctl -u livekit`.
