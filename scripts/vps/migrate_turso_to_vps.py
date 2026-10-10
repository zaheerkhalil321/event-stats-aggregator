import urllib.request
import json
import sqlite3
import os
import sys
import time

TURSO_URL = os.environ.get('OLD_TURSO_URL', 'https://hyrox-events-zaheer321.aws-ap-south-1.turso.io/v2/pipeline')
TURSO_TOKEN = os.environ.get('OLD_TURSO_TOKEN', '')

DB_DIR = '/var/lib/sqld_data/dbs/default'
DB_PATH = f'{DB_DIR}/data'

def turso_query(sql):
    payload = {
        'requests': [
            {'type': 'execute', 'stmt': {'sql': sql}}
        ]
    }
    req = urllib.request.Request(
        TURSO_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {TURSO_TOKEN}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        res = data['results'][0]['response']
        if 'result' in res:
            return res['result']
        raise Exception(f"Turso error: {res}")

def parse_row(row_cells):
    parsed = []
    for cell in row_cells:
        t = cell.get('type')
        if t == 'null':
            parsed.append(None)
        elif t == 'integer':
            parsed.append(int(cell['value']))
        elif t == 'float':
            parsed.append(float(cell['value']))
        else:
            parsed.append(cell.get('value'))
    return parsed

def main():
    print(f"[*] Initializing database at {DB_PATH}")
    os.makedirs(DB_DIR, exist_ok=True)
    if os.path.exists(DB_PATH):
        print(f"[*] Removing old database file {DB_PATH}")
        os.remove(DB_PATH)
    for extra in [f"{DB_PATH}-wal", f"{DB_PATH}-shm", f"{DB_DIR}/wallog", f"{DB_DIR}/stats.json"]:
        if os.path.exists(extra):
            os.remove(extra)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("PRAGMA journal_mode = WAL;")
    cur.execute("PRAGMA synchronous = NORMAL;")
    cur.execute("PRAGMA cache_size = -64000;")

    # 1. Create Tables
    print("[*] Creating tables...")
    cur.execute("""
    CREATE TABLE hyrox_races (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      country_code TEXT NOT NULL,
      venue TEXT,
      date TEXT NOT NULL,
      season TEXT,
      status TEXT DEFAULT 'upcoming',
      registration_url TEXT,
      image_url TEXT,
      athletes_count INTEGER DEFAULT 0,
      city_code TEXT,
      end_date TEXT,
      course_map_url TEXT,
      lap_instructions TEXT,
      athlete_guide_url TEXT,
      lat REAL,
      lng REAL,
      schedule_url TEXT,
      venue_name TEXT,
      sponsor_name TEXT,
      event_page_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cur.execute("""
    CREATE TABLE hyrox_athlete_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL REFERENCES hyrox_races(id) ON DELETE CASCADE,
      bib_number TEXT,
      full_name TEXT NOT NULL,
      nationality TEXT,
      gender TEXT,
      age_group TEXT,
      division TEXT NOT NULL,
      total_time TEXT,
      overall_rank INTEGER,
      gender_rank INTEGER,
      division_rank INTEGER,
      age_group_rank INTEGER,
      run_1 TEXT,
      run_2 TEXT,
      run_3 TEXT,
      run_4 TEXT,
      run_5 TEXT,
      run_6 TEXT,
      run_7 TEXT,
      run_8 TEXT,
      skierg TEXT,
      sled_push TEXT,
      sled_pull TEXT,
      burpee_jumps TEXT,
      rowing TEXT,
      farmers_carry TEXT,
      sandbag_lunges TEXT,
      wall_balls TEXT,
      roxzone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      mika_idp TEXT,
      UNIQUE (race_id, full_name, division)
    );
    """)

    cur.execute("""
    CREATE TABLE hyrox_sync_log (
      race_id text NOT NULL,
      division text NOT NULL,
      athlete_count int NOT NULL,
      synced_at text DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (race_id, division)
    );
    """)

    cur.execute("""
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      customer_email TEXT,
      customer_id TEXT,
      subscription_id TEXT,
      tier TEXT NOT NULL DEFAULT "starter",
      monthly_limit INTEGER NOT NULL DEFAULT 10000,
      current_usage INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE webhook_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload TEXT,
      processed_at TEXT NOT NULL
    );
    """)
    conn.commit()

    # 2. Migrate hyrox_races
    print("[*] Migrating hyrox_races...")
    races_res = turso_query("SELECT * FROM hyrox_races")
    cols = [c['name'] for c in races_res['cols']]
    placeholders = ', '.join(['?'] * len(cols))
    races_rows = [parse_row(r) for r in races_res['rows']]
    cur.executemany(f"INSERT INTO hyrox_races ({', '.join(cols)}) VALUES ({placeholders})", races_rows)
    conn.commit()
    print(f"    -> Inserted {len(races_rows)} races")

    # 3. Migrate hyrox_sync_log
    print("[*] Migrating hyrox_sync_log...")
    sync_res = turso_query("SELECT * FROM hyrox_sync_log")
    cols = [c['name'] for c in sync_res['cols']]
    placeholders = ', '.join(['?'] * len(cols))
    sync_rows = [parse_row(r) for r in sync_res['rows']]
    cur.executemany(f"INSERT INTO hyrox_sync_log ({', '.join(cols)}) VALUES ({placeholders})", sync_rows)
    conn.commit()
    print(f"    -> Inserted {len(sync_rows)} sync logs")

    # 4. Migrate api_keys
    print("[*] Migrating api_keys...")
    keys_res = turso_query("SELECT * FROM api_keys")
    if keys_res['rows']:
        cols = [c['name'] for c in keys_res['cols']]
        placeholders = ', '.join(['?'] * len(cols))
        keys_rows = [parse_row(r) for r in keys_res['rows']]
        cur.executemany(f"INSERT INTO api_keys ({', '.join(cols)}) VALUES ({placeholders})", keys_rows)
        conn.commit()
        print(f"    -> Inserted {len(keys_rows)} api keys")

    # 5. Migrate hyrox_athlete_results in 10,000 batches
    print("[*] Migrating hyrox_athlete_results (1.35M rows)...")
    last_id = 0
    total_migrated = 0
    batch_size = 10000
    start_time = time.time()

    # Get column names for hyrox_athlete_results
    sample_res = turso_query("SELECT * FROM hyrox_athlete_results LIMIT 1")
    cols = [c['name'] for c in sample_res['cols']]
    col_str = ', '.join(cols)
    placeholders = ', '.join(['?'] * len(cols))
    insert_sql = f"INSERT INTO hyrox_athlete_results ({col_str}) VALUES ({placeholders})"

    while True:
        b_start = time.time()
        sql = f"SELECT * FROM hyrox_athlete_results WHERE id > {last_id} ORDER BY id ASC LIMIT {batch_size}"
        
        # Retry logic for network blips
        retries = 3
        while retries > 0:
            try:
                res = turso_query(sql)
                break
            except Exception as e:
                retries -= 1
                print(f"[!] Warning: Query failed ({e}), retrying ({retries} left)...")
                time.sleep(2)
                if retries == 0:
                    raise

        rows = res['rows']
        if not rows:
            break

        parsed_rows = [parse_row(r) for r in rows]
        cur.executemany(insert_sql, parsed_rows)
        conn.commit()

        count = len(parsed_rows)
        total_migrated += count
        last_id = parsed_rows[-1][0]  # 'id' is first column
        elapsed = time.time() - start_time
        rate = total_migrated / elapsed if elapsed > 0 else 0
        b_time = time.time() - b_start

        if total_migrated % 50000 == 0 or count < batch_size:
            print(f"    -> Migrated {total_migrated:,} rows (last_id={last_id}) [{b_time:.2f}s/batch, {rate:,.0f} rows/s]")

    print(f"[*] hyrox_athlete_results migration complete: {total_migrated:,} rows in {time.time() - start_time:.1f}s")

    # 6. Create Indexes
    print("[*] Creating indexes...")
    indexes = [
        "CREATE INDEX idx_api_keys_email ON api_keys(customer_email);",
        "CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);",
        "CREATE INDEX idx_turso_division ON hyrox_athlete_results(race_id, division);",
        "CREATE INDEX idx_turso_full_name ON hyrox_athlete_results(full_name COLLATE NOCASE);",
        "CREATE INDEX idx_turso_mika_idp ON hyrox_athlete_results(mika_idp);",
        "CREATE INDEX idx_turso_overall_rank ON hyrox_athlete_results(race_id, overall_rank);",
        "CREATE INDEX idx_turso_race_div_divrank ON hyrox_athlete_results(race_id, division, division_rank);",
        "CREATE INDEX idx_turso_race_div_rank ON hyrox_athlete_results(race_id, division, overall_rank);",
        "CREATE INDEX idx_turso_race_id ON hyrox_athlete_results(race_id);",
        "CREATE INDEX idx_turso_race_mika_idp ON hyrox_athlete_results(race_id, mika_idp);",
        "CREATE INDEX idx_turso_races_date ON hyrox_races(date);",
        "CREATE INDEX idx_turso_races_status ON hyrox_races(status);",
        "CREATE INDEX idx_turso_total_time ON hyrox_athlete_results(race_id, total_time);"
    ]
    
    for idx_sql in indexes:
        t0 = time.time()
        cur.execute(idx_sql)
        print(f"    -> Created index ({time.time() - t0:.2f}s): {idx_sql.split()[2]}")
    conn.commit()

    # 7. Verification
    print("[*] Running verification...")
    cur.execute("SELECT count(*) FROM hyrox_races")
    c_races = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM hyrox_athlete_results")
    c_athletes = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM hyrox_sync_log")
    c_sync = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM api_keys")
    c_keys = cur.fetchone()[0]

    print(f"Verification Results:")
    print(f"  hyrox_races: {c_races}")
    print(f"  hyrox_athlete_results: {c_athletes}")
    print(f"  hyrox_sync_log: {c_sync}")
    print(f"  api_keys: {c_keys}")

    db_size = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f"Database file size: {db_size:.2f} MB")
    conn.close()
    print("[*] Migration finished successfully!")

if __name__ == '__main__':
    main()
