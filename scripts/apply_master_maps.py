#!/usr/bin/env python3
"""
apply_master_maps.py
Links authentic official HYROX venue maps to all historical and upcoming events (2024-2026)
in hyrox_races on the VPS database.
"""

import urllib.request
import os
import shutil
import json

VPS_URL = os.environ.get("TURSO_DATABASE_URL", "https://db.hyroxresultsapi.com")
MAPS_DIR = "/Users/mzaheer/Downloads/working-projects/hyrox-results-api/public/maps"
os.makedirs(MAPS_DIR, exist_ok=True)

# Master venue map template registry (city/venue keyword -> authentic source map file)
VENUE_TEMPLATES = {
    'london': 'london-2024.png',
    'paris': 'paris-2025.png',
    'frankfurt': 'frankfurt-2025.png',
    'chicago': 'chicago-2025.png',
    'dallas': 'dallas-2025.png',
    'anaheim': 'anaheim-2025.png',
    'vancouver': 'vancouver-2025.png',
    'atlanta': 'atlanta-2025.png',
    'washington': 'washington-dc-2025.png',
    'dublin': 'dublin-2025.png',
    'gent': 'gent-2025.png',
    'hamburg': 'hamburg-2025.png',
    'rio': 'rio-de-janeiro-2025.png',
    'utrecht': 'utrecht-2025.png',
    'manchester': 'manchester-2025.png',
    'melbourne': 'melbourne-2025.png',
    'sydney': 'sydney-2025.png',
    'singapore': 'singapore-2025.png',
    'hong kong': 'hong-kong-2025.png',
    'stockholm': 'stockholm-2025.png',
    'amsterdam': 'amsterdam-2024.png',
    'mechelen': 'mechelen-2026.png',
    'belgium': 'mechelen-2026.png',
    'maastricht': 'maastricht-2025.png',
    'incheon': 'incheon-2025.png',
    'vienna': 'vienna-2025.png',
    'new york': 'new-york-2024.png',
    'toronto': 'toronto-2026.png',
    'bordeaux': 'bordeaux-2026.png',
    'rome': 'rome-2026.png',
    'phoenix': 'phoenix-2026.png',
    'abu dhabi': 'abu-dhabi-2025.png',
    'heerenveen': 'heerenveen-2025.png',
    'miami': 'miami-beach-2025.png',
    'st. gallen': 'st-gallen-2025.png',
    'st-gallen': 'st-gallen-2025.png',
    'valencia': 'valencia-2026.png',
    'boston': 'boston-2026.png',
    'geneva': 'geneva-2026.png',
    'karlsruhe': 'karlsruhe-2026.png',
    'sao paulo': 'hyrox-s-o-paulo-2026.png',
    'são paulo': 'hyrox-s-o-paulo-2026.png',
    'birmingham': 'birmingham-2024.png',
    'tampa': 'myfitnesspal-hyrox-tampa-2026.png',
    'rotterdam': 'rotterdam-2025.png',
    'houston': 'houston-2025.png',
    'taipei': 'taipei-2025.png',
    'delhi': 'delhi-2025.png',
    'munich': 'munich-2025.png',
    'münchen': 'munich-2025.png',
    'fort lauderdale': 'fort-lauderdale-2024.png',
    'world championships': 'world-championships-2025.png',
    'berlin': 'berlin-2025.png',
    'toulouse': 'toulouse-2025.png',
    'gdansk': 'gdansk-2026.png',
    'gdańsk': 'gdansk-2026.png',
    'poznan': 'poznan-2025.png',
    'poznań': 'poznan-2025.png'
}

def run_vps_sql(sql_query):
    req = urllib.request.Request(
        f"{VPS_URL}/v2/pipeline",
        data=json.dumps({'requests': [{'type': 'execute', 'stmt': {'sql': sql_query}}]}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def main():
    print("=" * 64)
    print("🗺️ MASTER HYROX VENUE MAP LOCAL EXTRACTION & SYNC ENGINE")
    print("=" * 64)

    # 1. Fetch all races from database
    sql_get = """
    SELECT id, name, city, date, course_map_url
    FROM hyrox_races
    WHERE substr(date, 1, 4) IN ('2024', '2025', '2026')
    ORDER BY date DESC;
    """
    res = run_vps_sql(sql_get)
    rows = res['results'][0]['response']['result']['rows']
    total_races = len(rows)
    print(f"📦 Total target races in 2024-2026: {total_races}")

    updates = []
    already_valid = 0
    newly_matched = 0

    for r in rows:
        rid = r[0]['value']
        rname = r[1]['value'] if r[1].get('value') else ''
        city = (r[2]['value'] or '').lower() if r[2].get('value') else ''
        date = r[3]['value'] if r[3].get('value') else ''
        existing_url = r[4]['value'] if r[4].get('value') else None

        target_png = os.path.join(MAPS_DIR, f"{rid}.png")

        # Case 1: Specific map PNG already exists on disk
        if os.path.exists(target_png) and os.path.getsize(target_png) > 1000:
            map_url = f"http://192.168.100.132:3002/maps/{rid}.png"
            if existing_url != map_url:
                updates.append((rid, map_url))
            else:
                already_valid += 1
            continue

        # Case 2: Match against authentic venue template
        matched_template = None
        for key, template_file in VENUE_TEMPLATES.items():
            if key in city or key in rid.lower():
                matched_template = template_file
                break

        if matched_template:
            src_template = os.path.join(MAPS_DIR, matched_template)
            if os.path.exists(src_template):
                shutil.copyfile(src_template, target_png)
                map_url = f"http://192.168.100.132:3002/maps/{rid}.png"
                updates.append((rid, map_url))
                newly_matched += 1
                print(f"   🔗 Linked {rid} -> {matched_template} ({os.path.getsize(target_png)//1024} KB)")

    print(f"\n📊 Summary:")
    print(f"   Already valid: {already_valid}")
    print(f"   Newly matched & converted: {newly_matched}")
    print(f"   Total to update in VPS DB: {len(updates)}")

    # Execute DB updates in batch
    if updates:
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

    # Re-verify stats from database
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
