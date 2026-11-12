#!/bin/bash
# Nightly encrypted backup of the sqld database to Google Drive (rclone remote "gcrypt").
# The dump goes to a local file first (a file of known size uploads more reliably than a stream),
# the upload is retried for about 2.5 hours, and old backups are deleted only once tonight's is up.
set -euo pipefail
DB=/var/lib/sqld_data/dbs/default/data
NAME="hyrox-db-$(date -u +%F).sql.gz"
TMP="/var/tmp/$NAME"
START=$(date +%s)
trap 'rm -f "$TMP"' EXIT

sqlite3 -readonly "$DB" .dump | gzip -6 > "$TMP"

ok=0
for attempt in 1 2 3 4; do
  if rclone copyto "$TMP" "gcrypt:$NAME" --retries 5 --low-level-retries 30 \
       --drive-pacer-min-sleep 1s --drive-pacer-burst 1 --drive-chunk-size 32M; then
    ok=1
    break
  fi
  echo "$(date -u "+%F %T") upload attempt $attempt failed"
  [ "$attempt" -lt 4 ] && sleep $((attempt * 900))
done
if [ "$ok" != 1 ]; then
  echo "$(date -u "+%F %T") FAILED $NAME (4 upload attempts)"
  exit 1
fi

# Keep 8 days of full backups (the hourly account backups clean up their own folder).
rclone delete gcrypt: --min-age 8d --exclude "accounts/**"
SIZE=$(( $(stat -c %s "$TMP") / 1000000 ))
echo "$(date -u "+%F %T") OK $NAME ${SIZE}MB in $(( $(date +%s) - START ))s"
