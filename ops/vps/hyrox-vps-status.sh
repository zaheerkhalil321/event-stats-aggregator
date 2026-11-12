#!/bin/bash
# Every 10 minutes: writes the VPS health (disk, database, backups) to a small public JSON file,
# served by Caddy at https://db.hyroxresultsapi.com/vps-status.json. The GitHub workflow
# "VPS health" (event-stats-aggregator) reads it hourly and opens an issue when something is wrong.
# It contains no secrets.
set -euo pipefail
OUT_DIR=/var/www/hyrox-status
mkdir -p "$OUT_DIR"

disk_pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
disk_free_mb=$(( $(df --output=avail / | tail -1) / 1024 ))
db_mb=$(( $(stat -c %s /var/lib/sqld_data/dbs/default/data) / 1000000 ))
if curl -fsS -m 5 http://127.0.0.1:8080/health >/dev/null 2>&1; then db_up=true; else db_up=false; fi

# "2026-11-12 22:06:31 OK hyrox-db-..." -> "2026-11-12T22:06:31Z"
last_ok() { { grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8} OK ' "$1" 2>/dev/null || true; } | tail -1 | awk '{print $1"T"$2"Z"}'; }
full_ok=$(last_ok /var/log/hyrox-db-backup.log)
acct_ok=$(last_ok /var/log/hyrox-accounts-backup.log)
if tail -1 /var/log/hyrox-db-backup.log 2>/dev/null | grep -q ' OK '; then full_last=ok; else full_last=failed; fi

jq -n \
  --arg updated_at "$(date -u +%FT%TZ)" \
  --argjson disk_used_pct "${disk_pct:-0}" \
  --argjson disk_free_mb "$disk_free_mb" \
  --argjson db_size_mb "$db_mb" \
  --argjson db_up "$db_up" \
  --arg full_backup_last_ok "$full_ok" \
  --arg full_backup_last_run "$full_last" \
  --arg accounts_backup_last_ok "$acct_ok" \
  '{updated_at:$updated_at, disk_used_pct:$disk_used_pct, disk_free_mb:$disk_free_mb, db_size_mb:$db_size_mb, db_up:$db_up,
    full_backup_last_ok:$full_backup_last_ok, full_backup_last_run:$full_backup_last_run, accounts_backup_last_ok:$accounts_backup_last_ok}' \
  > "$OUT_DIR/vps-status.json.tmp"
mv "$OUT_DIR/vps-status.json.tmp" "$OUT_DIR/vps-status.json"
