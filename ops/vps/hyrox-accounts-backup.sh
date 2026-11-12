#!/bin/bash
# Hourly encrypted backup of the small account tables (logins, API keys, subscriptions, usage)
# to Google Drive, folder accounts/ of the rclone remote "gcrypt". Keeps 7 days.
# These tables change all day; the nightly full backup alone could lose up to a day of sign-ups.
set -euo pipefail
DB=/var/lib/sqld_data/dbs/default/data
NAME="hyrox-accounts-$(date -u +%F-%H).sql.gz"
TMP="/var/tmp/$NAME"
trap 'rm -f "$TMP"' EXIT

TABLES=$(sqlite3 -readonly "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'auth^_%' ESCAPE '^' OR name IN ('api_keys','entitlements','api_usage','api_usage_daily')) ORDER BY name")
[ -n "$TABLES" ] || { echo "$(date -u "+%F %T") no account tables found"; exit 1; }

{
  for t in $TABLES; do sqlite3 -readonly "$DB" ".dump $t"; done
} | gzip -9 > "$TMP"

rclone copyto "$TMP" "gcrypt:accounts/$NAME" --retries 5 --low-level-retries 20
rclone delete "gcrypt:accounts" --min-age 7d
echo "$(date -u "+%F %T") OK $NAME $(stat -c %s "$TMP") bytes ($(echo $TABLES | wc -w) tables)"
