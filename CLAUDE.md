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
- `.github/workflows/live-sync.yml` → `sync_live.mjs` (Playwright, hourly via Upstash, gated by `check_active_today.mjs`).
- `.github/workflows/pipeline.yml` → `sync_events.mjs` (Monday calendar/races).
- Most other `scripts/*.mjs|py` are one-off fixes/migrations, not part of the daily system.

## mika:timing rules (important)
- AWS firewall rate-limits per IP over ~5 minutes and blocks datacenter IPs (the VPS gets 403 on the
  first request). Scrape only from GitHub runners or a home IP.
- Every mika request must go through `scripts/lib/mika_http.mjs` (`get()` / `paced()`): self-tuning
  pacing, waits out 403s. Never add unpaced fetch/page.goto loops.
- List-page parsing and matching: `scripts/lib/mika_list.mjs`. Detail-row SQL: `scripts/lib/athlete_update_sql.mjs`
  (never overwrite existing values with NULL).

## VPS (root@157.230.243.98, SSH key only)
- sqld on 127.0.0.1:8080 behind Caddy (HTTPS), JWT auth (`/etc/sqld`), ufw allows 22/80/443, fail2ban.
- Disk is small (8.7 GB). sqld replication snapshots are trimmed every 6h by `/usr/local/bin/sqld-trim-snapshots.sh`.
- Nightly encrypted backup to Google Drive (`/usr/local/bin/hyrox-db-backup.sh`, rclone remote `gcrypt`).

## Working here
- `npm test` (node --test, 58+ tests). Read-only DB checks: small node scripts with `@libsql/client` + dotenv.
- `data/2025-audit/` holds old comparison dumps; don't read them whole (they are large).
