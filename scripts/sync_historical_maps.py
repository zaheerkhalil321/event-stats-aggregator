#!/usr/bin/env python3
"""
sync_historical_maps.py
Downloads and converts authentic official HYROX venue map PDFs for historical events
and updates hyrox_races in the VPS database.
"""

import urllib.request
import os
import subprocess
import json

VPS_URL = os.environ.get("TURSO_DATABASE_URL", "https://db.hyroxresultsapi.com")
MAPS_DIR = "/Users/mzaheer/Downloads/working-projects/hyrox-results-api/public/maps"
os.makedirs(MAPS_DIR, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}

HISTORICAL_MAPS = [
    # 2026 Races
    ("toronto-2026", "https://hyrox.com/wp-content/uploads/2026/09/HYROX_Toronto_VenueMap_PRINT_79x73-1.pdf"),
    ("bordeaux-2026", "https://hyrox.com/wp-content/uploads/2026/09/HYROX_Bordeaux_VenueMap_PRINT_2215x1864mm-2.pdf"),
    ("rome-2026", "https://hyrox.com/wp-content/uploads/2026/09/HYROX_Rome_VenueMap_PRINT_2215x1864mm-3.pdf"),
    ("phoenix-2026", "https://hyrox.com/wp-content/uploads/2026/01/HYROX_Phoenix_VenueMap_PRINT_79x73-1-1.pdf"),

    # 2025 Races
    ("frankfurt-2025", "https://hyrox.com/wp-content/uploads/2025/12/HYROX_Frankfurt_VenueMap_2025.pdf"),
    ("vienna-2025", "https://hyrox.com/wp-content/uploads/2026/02/HYROX_Vienna_VenueMap_PRINT_2215x1864mm_Feb-2.pdf"),
    ("abu-dhabi-2025", "https://hyrox.com/wp-content/uploads/2025/07/HYROX-AbuDhabi-VenueMap.pdf"),
    ("heerenveen-2025", "https://hyrox.com/wp-content/uploads/2025/05/HYROX_Heerenveen_NL_VenueMap_NEW.pdf"),
    ("incheon-2025", "https://hyrox.com/wp-content/uploads/2025/05/2.-ICN-Floor-Plan.pdf"),
    ("miami-beach-2025", "https://hyrox.com/wp-content/uploads/2025/04/HYROX_Miami_Beach_VenueMap_PRINT_79x73.pdf"),
    ("paris-2025", "https://hyrox.com/wp-content/uploads/2025/04/HYROX_Paris_VenueMap_PRINT_2215x1864mm.pdf"),
    ("paris-spring-2025", "https://hyrox.com/wp-content/uploads/2025/04/HYROX_Paris_VenueMap_PRINT_2215x1864mm.pdf"),
    ("st-gallen-2025", "https://hyrox.com/wp-content/uploads/2025/02/HYROX_StGallen_VenueMap_final.pdf"),

    # 2024 Races
    ("london-2024", "https://hyrox.com/wp-content/uploads/2024/11/HYROX_London_VenueMap_V4-2.pdf"),
    ("paris-2024", "https://hyrox.com/wp-content/uploads/2024/11/HYROXPAR_VenueMap_071120224.pdf"),
    ("new-york-2024", "https://hyrox.com/wp-content/uploads/2024/05/HYROXNYC_VenueMap-June-2024.pdf"),
    ("london-spring-2024", "https://hyrox.com/wp-content/uploads/2024/05/HYROXLON_VenueMap.pdf"),
    ("incheon-2024", "https://hyrox.com/wp-content/uploads/2024/02/SK-Floor-Plan.pdf"),
    ("incheon-spring-2024", "https://hyrox.com/wp-content/uploads/2024/02/SK-Floor-Plan.pdf"),
    ("frankfurt-2024", "https://hyrox.com/wp-content/uploads/2023/12/Venue-Map_HYROX-FRA-1.pdf"),

    # 2023 Races
    ("london-2023", "https://hyrox.com/wp-content/uploads/2023/11/HYROXLON_VenueMap_2023_v7.pdf"),
    ("london-spring-2023", "https://hyrox.com/wp-content/uploads/2023/11/HYROXLON_VenueMap_2023_v7.pdf"),
    ("frankfurt-2023", "https://hyrox.com/wp-content/uploads/2023/12/Venue-Map_HYROX-FRA-1.pdf"),
]

def run_vps_sql(sql_query):
    req = urllib.request.Request(
        f"{VPS_URL}/v2/pipeline",
        data=json.dumps({'requests': [{'type': 'execute', 'stmt': {'sql': sql_query}}]}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def download_and_convert(race_id, pdf_url):
    tmp_pdf = f"/tmp/{race_id}_map.pdf"
    out_png = os.path.join(MAPS_DIR, f"{race_id}.png")

    try:
        req = urllib.request.Request(pdf_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=25) as resp:
            with open(tmp_pdf, 'wb') as f:
                f.write(resp.read())

        # Convert PDF to high-res PNG
        cmd = ["sips", "-s", "format", "png", tmp_pdf, "--out", out_png]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        if os.path.exists(out_png) and os.path.getsize(out_png) > 1000:
            size_kb = os.path.getsize(out_png) // 1024
            return f"http://192.168.100.132:3002/maps/{race_id}.png", size_kb
    except Exception as e:
        print(f"   ⚠️ Failed {race_id}: {e}")
    finally:
        if os.path.exists(tmp_pdf):
            try: os.remove(tmp_pdf)
            except: pass
    return None, 0

def main():
    print("=" * 64)
    print("🗺️ HISTORICAL HYROX VENUE MAP INGESTION ENGINE")
    print(f"📦 Total target historical races: {len(HISTORICAL_MAPS)}")
    print("=" * 64)

    success_count = 0
    for race_id, pdf_url in HISTORICAL_MAPS:
        print(f"📥 Processing {race_id}...")
        map_url, size_kb = download_and_convert(race_id, pdf_url)
        if map_url:
            sql = f"""
            UPDATE hyrox_races
            SET course_map_url = '{map_url}', updated_at = CURRENT_TIMESTAMP
            WHERE id = '{race_id}';
            """
            run_vps_sql(sql)
            print(f"   ✅ Saved {size_kb} KB PNG & Updated DB ➔ {map_url}")
            success_count += 1
        else:
            print(f"   ❌ Could not convert {race_id}")

    print("\n" + "=" * 64)
    print(f"🎉 Successfully ingested {success_count}/{len(HISTORICAL_MAPS)} historical course maps into VPS DB!")
    print("=" * 64)

if __name__ == '__main__':
    main()
