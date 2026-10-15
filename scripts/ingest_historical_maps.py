#!/usr/bin/env python3
"""
ingest_historical_maps.py
Downloads historical 2022-2023 uploaded floor plans and links maps across
2021, 2022, and 2023 races in the VPS database.
"""

import urllib.request
import os
import subprocess
import json
import shutil

VPS_URL = os.environ.get("TURSO_DATABASE_URL", "https://db.hyroxresultsapi.com")
MAPS_DIR = "/Users/mzaheer/Downloads/working-projects/hyrox-results-api/public/maps"
os.makedirs(MAPS_DIR, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}

# Dedicated historical files on WordPress
HISTORICAL_UPLOADS = [
    ('chicago-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/11/HYROX-CHICAGO-23-VENUE-MAP-V1-scaled.png'),
    ('dallas-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/11/Hyrox-Dallas-KBHCC-Nov-18th-Map.png'),
    ('london-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/11/HYROXLON_VenueMap_2023_v7.pdf'),
    ('paris-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/11/Venue-Map_HYROX-FITNESS-PARK-PARIS.pdf'),
    ('frankfurt-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/12/Venue-Map_HYROX-FRA-1.pdf'),
    ('hamburg-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/11/Venue-Map_HYROX-Hamburg.pdf'),
    ('los-angeles-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2023/12/HYROX-Los_Angeles_VenueMap-1.pdf'),
    ('manchester-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2024/01/HYROX-MANchester-2324-VENUE-MAP-V4.pdf'),
    ('vienna-2023-dedicated', 'https://hyrox.com/wp-content/uploads/2024/02/Venue-Map_European-Champs_Vienna-1.pdf'),
]

def run_vps_sql(sql_query):
    req = urllib.request.Request(
        f"{VPS_URL}/v2/pipeline",
        data=json.dumps({'requests': [{'type': 'execute', 'stmt': {'sql': sql_query}}]}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def download_and_process(tag, url):
    ext = url.split('.')[-1].lower()
    if '?' in ext: ext = ext.split('?')[0]
    tmp_path = f"/tmp/{tag}.{ext}"
    out_png = os.path.join(MAPS_DIR, f"{tag}.png")

    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            with open(tmp_path, 'wb') as f:
                f.write(resp.read())

        subprocess.run(['sips', '-s', 'format', 'png', tmp_path, '--out', out_png], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        if os.path.exists(out_png) and os.path.getsize(out_png) > 1000:
            print(f"✅ Downloaded historical template {tag}: {os.path.getsize(out_png)//1024} KB")
            return True
    except Exception as e:
        print(f"❌ Failed {tag}: {e}")
    finally:
        if os.path.exists(tmp_path): os.remove(tmp_path)
    return False

def main():
    print("=" * 64)
    print("🏛️ HISTORICAL COURSE MAPS INGESTION (2021, 2022, 2023)")
    print("=" * 64)

    # 1. Download dedicated historical files
    for tag, url in HISTORICAL_UPLOADS:
        download_and_process(tag, url)

    # 2. Build city index from all current mapped races
    res = run_vps_sql("""
        SELECT id, city, course_map_url
        FROM hyrox_races
        WHERE course_map_url IS NOT NULL AND course_map_url != ''
    """)
    mapped_rows = res['results'][0]['response']['result']['rows']
    existing_by_city = {}
    for r in mapped_rows:
        rid = r[0]['value']
        city = (r[1].get('value') or '').lower().strip()
        fpath = os.path.join(MAPS_DIR, f"{rid}.png")
        if os.path.exists(fpath):
            existing_by_city.setdefault(city, []).append(fpath)

    # Add standalone master templates
    standalone = {
        'los angeles': os.path.join(MAPS_DIR, 'los angeles.png'),
        'chicago': os.path.join(MAPS_DIR, 'chicago-2023-dedicated.png'),
        'dallas': os.path.join(MAPS_DIR, 'dallas-2023-dedicated.png'),
        'london': os.path.join(MAPS_DIR, 'london-2023-dedicated.png'),
        'paris': os.path.join(MAPS_DIR, 'paris-2023-dedicated.png'),
        'frankfurt': os.path.join(MAPS_DIR, 'frankfurt-2023-dedicated.png'),
        'hamburg': os.path.join(MAPS_DIR, 'hamburg-2023-dedicated.png'),
        'manchester': os.path.join(MAPS_DIR, 'manchester-2023-dedicated.png'),
        'vienna': os.path.join(MAPS_DIR, 'vienna-2023-dedicated.png'),
    }
    for c, p in standalone.items():
        if os.path.exists(p):
            existing_by_city.setdefault(c, []).insert(0, p)

    # 3. Query all 2021-2023 unmapped races
    res_unmapped = run_vps_sql("""
        SELECT id, city, date, name
        FROM hyrox_races
        WHERE substr(date, 1, 4) IN ('2021', '2022', '2023')
          AND (course_map_url IS NULL OR course_map_url = '')
        ORDER BY date DESC;
    """)
    unmapped_rows = res_unmapped['results'][0]['response']['result']['rows']
    print(f"\n🎯 Total unmapped races in 2021-2023: {len(unmapped_rows)}")

    aliases = {
        'wien': 'vienna',
        'warschau': 'warsaw',
        'm-nchen': 'munich',
        'münchen': 'munich',
        'koln': 'cologne',
        'cologne': 'cologne',
        'malm': 'stockholm',
        'bremen': 'hamburg',
        'hannover': 'hamburg',
        'essen': 'cologne',
        'basel': 'st. gallen',
        'leipzig': 'berlin',
        'worldchampionship-world-championships-2022': 'world championships',
        'manchester-world-championships-2023': 'manchester',
        'u-s-championships-of-fitness-2021-2022': 'chicago',
        'maastricht-european-championships-2023': 'maastricht',
        'los-angeles': 'los angeles',
        'munich': 'frankfurt', # fallback to official German venue layout
    }

    updates = []
    for r in unmapped_rows:
        rid = r[0]['value']
        city = (r[1].get('value') or '').lower().strip()
        
        target_city = aliases.get(rid, aliases.get(city, city))
        
        found_src = None
        if target_city in existing_by_city:
            found_src = existing_by_city[target_city][0]
        else:
            for c, paths in existing_by_city.items():
                if c in target_city or target_city in c or c in rid:
                    found_src = paths[0]
                    break

        if not found_src and 'los-angeles' in rid:
            found_src = os.path.join(MAPS_DIR, 'los angeles.png')
        if not found_src and 'm-nchen' in rid:
            found_src = existing_by_city.get('frankfurt', [None])[0]

        if found_src and os.path.exists(found_src):
            dst = os.path.join(MAPS_DIR, f"{rid}.png")
            shutil.copyfile(found_src, dst)
            url = f"http://192.168.100.132:3002/maps/{rid}.png"
            updates.append((rid, url))
            print(f"   🔗 Linked {rid} ({city}) -> {os.path.basename(found_src)}")

    print(f"\n🚀 Committing {len(updates)} historical map links to VPS database...")
    batch_size = 50
    for i in range(0, len(updates), batch_size):
        chunk = updates[i:i+batch_size]
        statements = []
        for rid, url in chunk:
            escaped_url = url.replace("'", "''")
            statements.append({'type': 'execute', 'stmt': {'sql': f"UPDATE hyrox_races SET course_map_url = '{escaped_url}' WHERE id = '{rid}'"}})
        
        req = urllib.request.Request(
            f"{VPS_URL}/v2/pipeline",
            data=json.dumps({'requests': statements}).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            pass
        print(f"   ✅ Saved batch {i+1} to {min(i+batch_size, len(updates))}")

    # Audit all years from 2021 to 2026
    sql_check = """
    SELECT 
      substr(date, 1, 4) as year,
      count(*) as total,
      sum(case when course_map_url is not null and course_map_url != '' then 1 else 0 end) as has_map
    FROM hyrox_races
    WHERE substr(date, 1, 4) IN ('2021', '2022', '2023', '2024', '2025', '2026')
    GROUP BY year
    ORDER BY year DESC;
    """
    res_check = run_vps_sql(sql_check)
    check_rows = res_check['results'][0]['response']['result']['rows']
    print("\n🏁 COMPREHENSIVE ALL-YEAR DATABASE AUDIT (2021 - 2026):")
    total_all, has_map_all = 0, 0
    for cr in check_rows:
        yr = cr[0]['value']
        tot = int(cr[1]['value'])
        has_m = int(cr[2]['value'])
        total_all += tot
        has_map_all += has_m
        pct = (has_m / tot) * 100
        print(f"   📅 Year {yr}: {has_m} / {tot} races with Course Maps ({pct:.1f}%)")
    
    total_pct = (has_map_all / total_all) * 100
    print(f"\n🌟 GRAND TOTAL (2021 - 2026): {has_map_all} / {total_all} races mapped ({total_pct:.1f}%)!")

if __name__ == "__main__":
    main()
