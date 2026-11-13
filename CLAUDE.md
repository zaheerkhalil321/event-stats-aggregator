# event-stats-aggregator

Scrapes HYROX results from mika:timing (results.hyrox.com; the old host hyrox.r.mikatiming.com answers 403 to everyone since ~2026-10-21) into a self-hosted libSQL (sqld)
database on a DigitalOcean VPS, served at https://db.hyroxresultsapi.com. Env vars keep the old
names: `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (see `.env`; never print the token).

## What runs where
- `.github/workflows/backfill-splits.yml` — one ~5h40m run that chains itself; cron every 6h restarts it.
  1. `scripts/discover_idps.mjs` finds missing `mika_idp` + exact wave (`mika_event`) from list pages
     (100 athletes/request), matching rows by name + finish time; progress in table `mika_discovery_log`.
  2. `scripts/backfill_splits.mjs` fetches each athlete's detail page (17 splits, station ranks,
     race replay, team members). Stops at `--max-db-mb` (workflow input, default 3000).
- `.github/workflows/live-sync.yml`: a plan job (`scripts/plan_live_lanes.mjs`, `scripts/lib/live_planner.mjs`) shares
  the running races out over 1–5 parallel runners ("lanes", each its own IP so its own mika rate limit) by the
  load measured in table `live_pass_stats`; each lane runs `sync_live.mjs --races=…` (lane 1: `--exclude=…`, i.e.
  everything else). Upstash triggers it hourly (GitHub's own cron runs hours late); a run is a ~5.5h session with
  a pass every 10 min. Live tracking (start lists, athletes on the course) goes into `startlist_entries`:
  see `docs/live-tracking-plan.md`. A `Live positions old` warning means a lane needs more room.
- `.github/workflows/pipeline.yml` → `sync_events.mjs` (Monday calendar/races).
- `.github/workflows/verify-counts.yml` → `scripts/verify_race_counts.mjs` (nightly 04:41 UTC): compares the
  last 21 days of races with results.hyrox.com per division, re-syncs races that miss results and opens/updates
  a `data-check` issue if any still do. Run it locally with `--race <text>` or `--from <date>` for an audit.
- Most other `scripts/*.mjs|py` are one-off fixes/migrations, not part of the daily system.

## mika:timing rules (important)
- AWS firewall rate-limits per IP over ~5 minutes and blocks datacenter IPs (the VPS gets 403 on the
  first request). Scrape only from GitHub runners or a home IP.
- Every mika request must go through `scripts/lib/mika_http.mjs` (`get()` / `paced()`): self-tuning
  pacing, waits out 403s. Never add unpaced fetch/page.goto loops.
- List-page parsing and matching: `scripts/lib/mika_list.mjs`. A race's waves can also sit in the catch-all "sonstige"
  group (matched by the wave code after the last "_", `extraWavesFor`); "Overall" and "ALL" waves repeat other
  waves and are skipped (`isOverallWave`). Detail-row SQL: `scripts/lib/athlete_update_sql.mjs`
  (never overwrite existing values with NULL).

## VPS (root@157.230.243.98, SSH key only)
- sqld on 127.0.0.1:8080 behind Caddy (HTTPS), JWT auth (`/etc/sqld`), ufw allows 22/80/443, fail2ban.
- Disk is small (8.7 GB). sqld replication snapshots are trimmed every 6h by `/usr/local/bin/sqld-trim-snapshots.sh`.
- Nightly encrypted full backup to Google Drive (`/usr/local/bin/hyrox-db-backup.sh`, rclone remote `gcrypt`, 22:00 UTC,
  keeps 8 days; dumps to /var/tmp first and retries the upload). Hourly backup of the account tables (`auth_*`,
  `api_keys`, `entitlements`, usage) to `gcrypt:accounts/` (`hyrox-accounts-backup.sh`, keeps 7 days).
- `hyrox-vps-status.sh` writes disk/DB/backup health every 10 min to https://db.hyroxresultsapi.com/vps-status.json
  (Caddy serves it); `.github/workflows/vps-health.yml` reads it hourly and opens a `vps-health` issue when needed.
- Copies of these scripts live in `ops/vps/`; edit there and copy to `/usr/local/bin/` on the VPS.
- Login (Better Auth `auth_*` tables) and customer data share this database with the race results.

## Working here
- `npm test` (node --test, 58+ tests). Read-only DB checks: small node scripts with `@libsql/client` + dotenv.
- `data/2025-audit/` holds old comparison dumps; don't read them whole (they are large).
