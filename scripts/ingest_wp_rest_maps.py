#!/usr/bin/env python3
"""
ingest_wp_rest_maps.py
Downloads and converts all newly discovered official HYROX venue map PDFs
from the WordPress REST API and links them across 2024, 2025, and 2026 races.
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

# Mapping: keyword/city -> authentic PDF url from WordPress REST API
NEW_DISCOVERIES = [
    # Australia & NZ
    ('brisbane', 'https://hyrox.com/wp-content/uploads/2025/02/AU-BNE-Floor-Plan-Version_2_Website.pdf'),
    ('perth', 'https://hyrox.com/wp-content/uploads/2025/09/AU-PER-Floor-Plan.pdf'),
    ('auckland', 'https://hyrox.com/wp-content/uploads/2025/01/NZ-AKL-Floor-Plan_INSIDEOUTSIDE.pdf'),

    # UK
    ('glasgow', 'https://hyrox.com/wp-content/uploads/2024/02/HYROX-GLASGOW_VENUE-MAP-V1.pdf'),
    ('cardiff', 'https://hyrox.com/wp-content/uploads/2025/05/HYROX_Cardiff_VenueMap_PRINT_2215x1864mm-4.pdf'),

    # Germany
    ('cologne', 'https://hyrox.com/wp-content/uploads/2025/04/HYROX_Cologne_VenueMap_PRINT_2215x1864mm.pdf'),
    ('stuttgart', 'https://hyrox.com/wp-content/uploads/2025/10/HYROX_Stuttgart_VenueMap_PRINT_2215x1864mm-2.pdf'),

    # USA
    ('las vegas', 'https://hyrox.com/wp-content/uploads/2025/02/HYROX_LasVegas_VenueMap_GENERAL_vertical_Digital.pdf'),
    ('los angeles', 'https://hyrox.com/wp-content/uploads/2023/12/HYROX-Los_Angeles_VenueMap-1.pdf'),

    # France
    ('nice', 'https://hyrox.com/wp-content/uploads/2024/06/WC-NICE_VENUEMAP-AG.pdf'),
    ('marseille', 'https://hyrox.com/wp-content/uploads/2024/12/HYROX_Marseille_VenueMap_ENG.pdf'),

    # Italy
    ('turin', 'https://hyrox.com/wp-content/uploads/2025/02/DEF_PRINT_Mappa_Torino2025-2.pdf'),
    ('torino', 'https://hyrox.com/wp-content/uploads/2025/02/DEF_PRINT_Mappa_Torino2025-2.pdf'),
    ('rimini', 'https://hyrox.com/wp-content/uploads/2025/05/HYROX_Rimini_VenueMap_PRINT_2215x1864mm-2.pdf'),

    # Nordics & Baltics
    ('oslo', 'https://hyrox.com/wp-content/uploads/2025/09/HYROX_Oslo_VenueMap_PRINT_2215x1864mm-1.pdf'),
    ('copenhagen', 'https://hyrox.com/wp-content/uploads/2024/03/Event-Page_Venue-MapCPH.pdf'),
    ('riga', 'https://hyrox.com/wp-content/uploads/2025/05/HYROX_Riga_VenueMap_PRINT_2215x1864mm-1.pdf'),

    # Asia
    ('bangkok', 'https://hyrox.com/wp-content/uploads/2025/05/THA-Floor-Plan_Bilingual.pdf'),
    ('thailand', 'https://hyrox.com/wp-content/uploads/2025/05/THA-Floor-Plan_Bilingual.pdf'),
    ('mumbai', 'https://hyrox.com/wp-content/uploads/2025/09/HYROX_Mumbai_VenueMap_PRINT_2215x1864mm.pdf'),
    ('yokohama', 'https://hyrox.com/wp-content/uploads/2025/08/JP-Yokohama-Floor-Plan-1.pdf'),
    ('chiba', 'https://hyrox.com/wp-content/uploads/2026/08/JP-CHIBA-Floor-Plan-Regular-Map.pdf'),
    ('jakarta', 'https://hyrox.com/wp-content/uploads/2026/06/ID-JKT-Floor-Plan_Bilingual-1.pdf'),

    # South Africa
    ('johannesburg', 'https://hyrox.com/wp-content/uploads/2025/02/VenueMap_Johannesburg_HighFence_01032025_I.pdf'),
    ('cape town', 'https://hyrox.com/wp-content/uploads/2024/09/VenueMap_CapteTown.pdf'),
]

def run_vps_sql(sql_query):
    req = urllib.request.Request(
        f"{VPS_URL}/v2/pipeline",
        data=json.dumps({'requests': [{'type': 'execute', 'stmt': {'sql': sql_query}}]}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def download_and_convert(tag, url):
    tmp_pdf = f"/tmp/{tag}.pdf"
    out_png = os.path.join(MAPS_DIR, f"{tag}.png")

    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            with open(tmp_pdf, 'wb') as f:
                f.write(resp.read())

        subprocess.run(['sips', '-s', 'format', 'png', tmp_pdf, '--out', out_png], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        if os.path.exists(out_png) and os.path.getsize(out_png) > 1000:
            print(f"✅ Converted {tag}: {os.path.getsize(out_png)//1024} KB")
            return True
    except Exception as e:
        print(f"❌ Failed {tag}: {e}")
    finally:
        if os.path.exists(tmp_pdf): os.remove(tmp_pdf)
    return False

def main():
    print("=" * 64)
    print("🚀 WORDPRESS REST API DISCOVERED MAPS INGESTION ENGINE")
    print("=" * 64)

    # 1. Download and convert all newly discovered venue maps
    active_templates = {}
    for tag, url in NEW_DISCOVERIES:
        ok = download_and_convert(tag, url)
        if ok or os.path.exists(os.path.join(MAPS_DIR, f"{tag}.png")):
            active_templates[tag] = f"{tag}.png"

    print(f"\n📦 Successfully prepared {len(active_templates)} new master venue templates!")

    # 2. Fetch all races from database
    sql_get = """
    SELECT id, city, date, course_map_url
    FROM hyrox_races
    WHERE substr(date, 1, 4) IN ('2024', '2025', '2026')
    ORDER BY date DESC;
    """
    res = run_vps_sql(sql_get)
    rows = res['results'][0]['response']['result']['rows']
    total_races = len(rows)
    print(f"🎯 Total races in 2024-2026: {total_races}")

    updates = []
    for r in rows:
        rid = r[0]['value']
        city = (r[1].get('value') or '').lower()
        curr_url = r[3].get('value')

        if curr_url and curr_url.strip():
            continue # already has a valid map

        # Check match against newly discovered templates
        matched_file = None
        for tag, fname in active_templates.items():
            if tag in city or tag in rid.lower():
                matched_file = fname
                break

        if matched_file:
            src = os.path.join(MAPS_DIR, matched_file)
            dst = os.path.join(MAPS_DIR, f"{rid}.png")
            if os.path.exists(src):
                import shutil
                shutil.copyfile(src, dst)
                map_url = f"http://192.168.100.132:3002/maps/{rid}.png"
                updates.append((rid, map_url))
                print(f"   🔗 Linked {rid} -> {matched_file}")

    print(f"\n🚀 Updating {len(updates)} races in VPS database...")
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

    # Re-verify stats
    sql_check = """
    SELECT 
      substr(date, 1, 4) as year,
      count(*) as total,
      sum(case when course_map_url is not null and course_map_url != '' then 1 else 0 end) as has_map
    FROM hyrox_races
    WHERE substr(date, 1, 4) IN ('2024', '2025', '2026')
    GROUP BY year
    ORDER BY year DESC;
    """
    res_check = run_vps_sql(sql_check)
    check_rows = res_check['results'][0]['response']['result']['rows']
    print("\n🏁 FINAL DATABASE AUDIT:")
    for cr in check_rows:
        yr = cr[0]['value']
        tot = cr[1]['value']
        has_m = cr[2]['value']
        pct = (int(has_m) / int(tot)) * 100
        print(f"   📅 Year {yr}: {has_m} / {tot} races with Course Maps ({pct:.1f}%)")

if __name__ == "__main__":
    main()
