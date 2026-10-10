import sqlite3
import unicodedata
import re
import time

DB_PATH = '/var/lib/sqld_data/dbs/default/data'

def normalize_name(name):
    if not name:
        return ""
    nfkd = unicodedata.normalize('NFKD', name)
    cleaned = ''.join(c for c in nfkd if not unicodedata.combining(c))
    cleaned = re.sub(r"[\x27\u2019\u2018\u0060\-\.,]", "", cleaned)
    return ' '.join(cleaned.lower().split())

def score_row(row):
    # row cols: id, full_name, bib_number, mika_idp, run_1, age_group, nationality
    s = 0
    if row[3]: s += 10 # mika_idp
    if row[4]: s += 5  # run_1
    if row[2]: s += 3  # bib_number
    if row[5]: s += 1  # age_group
    if row[6]: s += 1  # nationality
    if not row[1].isupper(): s += 2 # not ALL CAPS
    return s

def main():
    start_time = time.time()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("PRAGMA journal_mode = WAL;")
    cur.execute("PRAGMA synchronous = NORMAL;")

    print("[*] Loading distinct races...")
    cur.execute("SELECT id FROM hyrox_races")
    races = [r[0] for r in cur.fetchall()]
    print(f"[*] Found {len(races)} races in database.")

    total_dupes_deleted = 0
    races_affected = 0

    cols_select = "id, full_name, bib_number, mika_idp, run_1, age_group, nationality, division"
    
    for race_id in races:
        cur.execute(f"SELECT {cols_select} FROM hyrox_athlete_results WHERE race_id = ?", (race_id,))
        rows = cur.fetchall()
        if not rows:
            continue

        groups = {}
        for r in rows:
            norm_k = (r[7], normalize_name(r[1])) # (division, normalized_name)
            groups.setdefault(norm_k, []).append(r)

        to_delete_ids = []
        updates = []

        for k, group in groups.items():
            if len(group) > 1:
                sorted_group = sorted(group, key=score_row, reverse=True)
                keeper = sorted_group[0]
                keeper_id = keeper[0]

                # Check if keeper is missing fields that duplicates have
                keeper_bib = keeper[2]
                keeper_idp = keeper[3]
                keeper_age = keeper[5]
                keeper_nat = keeper[6]

                new_bib = keeper_bib
                new_idp = keeper_idp
                new_age = keeper_age
                new_nat = keeper_nat

                for rem in sorted_group[1:]:
                    to_delete_ids.append(rem[0])
                    if not new_bib and rem[2]: new_bib = rem[2]
                    if not new_idp and rem[3]: new_idp = rem[3]
                    if not new_age and rem[5]: new_age = rem[5]
                    if not new_nat and rem[6]: new_nat = rem[6]

                if (new_bib != keeper_bib or new_idp != keeper_idp or 
                    new_age != keeper_age or new_nat != keeper_nat):
                    updates.append((new_bib, new_idp, new_age, new_nat, keeper_id))

        if to_delete_ids:
            races_affected += 1
            total_dupes_deleted += len(to_delete_ids)

            # Apply field updates to keeper rows
            if updates:
                cur.executemany("""
                    UPDATE hyrox_athlete_results 
                    SET bib_number = ?, mika_idp = ?, age_group = ?, nationality = ?
                    WHERE id = ?
                """, updates)

            # Delete redundant rows
            # Delete in chunks of 500
            for i in range(0, len(to_delete_ids), 500):
                chunk = to_delete_ids[i:i+500]
                placeholders = ','.join(['?'] * len(chunk))
                cur.execute(f"DELETE FROM hyrox_athlete_results WHERE id IN ({placeholders})", chunk)
            
            conn.commit()
            print(f"  -> [{race_id}] Removed {len(to_delete_ids)} duplicates")

    print(f"\n[*] Deduplication complete: {total_dupes_deleted} duplicates removed across {races_affected} races in {time.time() - start_time:.2f}s")

    # Update athletes_count in hyrox_races
    print("[*] Synchronizing athletes_count in hyrox_races...")
    cur.execute("""
        UPDATE hyrox_races
        SET athletes_count = (
            SELECT COUNT(*) 
            FROM hyrox_athlete_results 
            WHERE hyrox_athlete_results.race_id = hyrox_races.id
        )
    """)
    conn.commit()

    # Recreate unique index with COLLATE NOCASE to permanently prevent duplicates!
    print("[*] Creating case-insensitive unique index...")
    cur.execute("DROP INDEX IF EXISTS idx_turso_unique_race_name_div;")
    try:
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_turso_unique_race_name_div 
            ON hyrox_athlete_results(race_id, full_name COLLATE NOCASE, division);
        """)
        conn.commit()
        print("  -> Created UNIQUE INDEX on (race_id, full_name COLLATE NOCASE, division)")
    except Exception as e:
        print(f"  -> Could not create unique index yet ({e})")

    # Verification
    cur.execute("SELECT COUNT(*) FROM hyrox_athlete_results")
    total_athletes = cur.fetchone()[0]
    print(f"\n[*] Total clean athletes in DB: {total_athletes:,}")

    conn.close()

if __name__ == '__main__':
    main()
