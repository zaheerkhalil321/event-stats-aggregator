import sqlite3
import unicodedata
import re

DB_PATH = '/var/lib/sqld_data/dbs/default/data'

def normalize_name(name):
    if not name:
        return ""
    # Normalize unicode (decompose accents)
    nfkd = unicodedata.normalize('NFKD', name)
    # Remove accents, apostrophes, hyphens, punctuation
    cleaned = ''.join(c for c in nfkd if not unicodedata.combining(c))
    cleaned = re.sub(r"[\x27\u2019\u2018\u0060\-\.,]", "", cleaned)
    # Lowercase and strip whitespace
    return ' '.join(cleaned.lower().split())

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("SELECT id, race_id, division, full_name, bib_number, total_time, overall_rank, division_rank, mika_idp, run_1 FROM hyrox_athlete_results WHERE race_id = 'karlsruhe-2026'")
    rows = cur.fetchall()
    print(f"Total rows in karlsruhe-2026 before dedup: {len(rows)}")

    # Group by (race_id, division, normalized_name)
    groups = {}
    for r in rows:
        r_id, race_id, division, full_name, bib, total_time, ov_rank, div_rank, mika_idp, run_1 = r
        norm_k = (race_id, division, normalize_name(full_name))
        groups.setdefault(norm_k, []).append(r)

    dupes_found = 0
    to_delete = []

    for k, group in groups.items():
        if len(group) > 1:
            dupes_found += len(group) - 1
            # Sort group to find the best keeper:
            # 1. Has mika_idp
            # 2. Has run_1
            # 3. Has bib_number
            # 4. Is not all uppercase
            def score(row):
                s = 0
                if row[8]: s += 10 # mika_idp
                if row[9]: s += 5  # run_1
                if row[4]: s += 3  # bib
                if not row[3].isupper(): s += 2 # not all uppercase
                return s

            sorted_group = sorted(group, key=score, reverse=True)
            keeper = sorted_group[0]
            removals = sorted_group[1:]
            for rem in removals:
                to_delete.append((rem[0], keeper[0], rem[3], keeper[3]))

    print(f"Duplicates to remove in karlsruhe-2026: {len(to_delete)}")
    for rem_id, keep_id, rem_name, keep_name in to_delete[:10]:
        print(f"  Delete id {rem_id} ({rem_name}) -> Keep id {keep_id} ({keep_name})")

    # Check division breakdown after hypothetical delete
    cur.execute("""
        SELECT division, COUNT(*) 
        FROM hyrox_athlete_results 
        WHERE race_id = 'karlsruhe-2026' 
        GROUP BY division
    """)
    before_counts = dict(cur.fetchall())

    rem_ids_set = set(t[0] for t in to_delete)
    after_counts = {}
    for r in rows:
        if r[0] not in rem_ids_set:
            after_counts[r[2]] = after_counts.get(r[2], 0) + 1

    print("\nComparison with TrainRox:")
    trainrox = {
        'HYROX PRO MEN': 320,
        'HYROX PRO WOMEN': 100,
        'HYROX PRO DOUBLES MEN': 256, # 512 / 2
        'HYROX PRO DOUBLES WOMEN': 102, # 204 / 2
        'HYROX MEN': 1727,
        'HYROX WOMEN': 911,
        'HYROX DOUBLES MEN': 1129, # 2258 / 2
        'HYROX DOUBLES WOMEN': 1166, # 2332 / 2
        'HYROX DOUBLES MIXED': 1264, # 2528 / 2
        'HYROX TEAM RELAY MEN': 24, # 96 / 4
        'HYROX TEAM RELAY WOMEN': 45, # 180 / 4
        'HYROX TEAM RELAY MIXED': 46, # 184 / 4
        'HYROX ADAPTIVE MEN': 8,
        'HYROX ADAPTIVE WOMEN': 5
    }

    for div, tr_cnt in trainrox.items():
        b_cnt = before_counts.get(div, 0)
        a_cnt = after_counts.get(div, 0)
        diff = a_cnt - tr_cnt
        print(f"  {div:<25}: Before={b_cnt:<5} After={a_cnt:<5} TrainRox={tr_cnt:<5} Diff={diff}")

    conn.close()

if __name__ == '__main__':
    main()
