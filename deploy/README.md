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
