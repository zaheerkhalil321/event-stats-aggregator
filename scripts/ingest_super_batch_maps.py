#!/usr/bin/env python3
"""
ingest_super_batch_maps.py
Downloads, converts, and links all newly excavated maps:
Spain (Madrid, Barcelona, Bilbao, Malaga), Italy (Milan, Verona, Bologna),
France (Lyon), Nordics (Helsinki), Asia (Beijing, Shanghai, Shenzhen, Chengdu,
Hangzhou, Wuhan, Osaka, Seoul, Sharjah), Latin America (Cancun, Puebla,
Guadalajara, Monterrey, Buenos Aires, Fortaleza), Turkey (Istanbul, Izmir),
Greece (Athens), Canada (Ottawa), and Salt Lake City!
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

SUPER_MAPS = [
    # Spain
    ('madrid', 'https://hyrox.com/wp-content/uploads/2025/10/Mapa-Pabellon-25.26-scaled-1.jpg'),
    ('barcelona', 'https://hyrox.com/wp-content/uploads/2026/05/Plano-BCN-scaled-1.png'),
    ('bilbao', 'https://hyrox.com/wp-content/uploads/2026/02/MAPA-VENUE-BLB-oficial-scaled-1.png'),
    ('malaga', 'https://hyrox.com/wp-content/uploads/2025/03/Mapa-PABELLON-1.png'),
    ('katowice', 'https://hyrox.com/wp-content/uploads/2025/02/Mapa-PABELLON-scaled.png'),

    # Italy
    ('milan', 'https://hyrox.com/wp-content/uploads/2024/10/Mappa_Milano2024_02-scaled-1.jpg'),
    ('verona', 'https://hyrox.com/wp-content/uploads/2025/12/HYROX_Verona_VenueMap_PRINT_2215x1864mm-1.pdf'),
    ('bologna', 'https://hyrox.com/wp-content/uploads/2026/03/HYROX_Bologna_VenueMap_PRINT_2215x1864mm.pdf'),

    # France & Nordics
    ('lyon', 'https://hyrox.com/wp-content/uploads/2026/05/HYROX_Lyon_VenueMap_PRINT_2215x1864mm-1.pdf'),
    ('helsinki', 'https://hyrox.com/wp-content/uploads/2026/05/HYROX_Helsinki_VenueMap_PRINT_2215x1864mm.jpg-scaled-1.jpeg'),

    # Turkey & Greece
    ('istanbul', 'https://hyrox.com/wp-content/uploads/2026/07/HYROX_Istanbul_VenueMap_PRINT_2215x1864mm-4.pdf'),
    ('izmir', 'https://hyrox.com/wp-content/uploads/2026/09/HYROX_Izmir_VenueMap_PRINT_2215x1864mm.pdf'),
    ('athens', 'https://hyrox.com/wp-content/uploads/2026/09/HYROX_Athens_VenueMap_PRINT_2215x1864mm-3.pdf'),

    # South America
    ('buenos-aires', 'https://hyrox.com/wp-content/uploads/2026/06/HYROX_BuenosAires_VenueMap_PRINT_2215x1864mm-3.pdf'),
    ('fortaleza', 'https://hyrox.com/wp-content/uploads/2026/02/HYROX_Fortaleza_VenueMap_PRINT_2215x1864mm-3.pdf'),

    # Mexico
    ('guadalajara', 'https://hyrox.com/wp-content/uploads/2025/01/VENUE-MAP-GUADALAJARA.jpeg'),
    ('monterrey', 'https://hyrox.com/wp-content/uploads/2025/04/15-copias-A4-color-mapaMTY.jpeg'),
    ('cancun', 'https://hyrox.com/wp-content/uploads/2026/03/Mapa-Cancun-2026.pdf'),
    ('puebla', 'https://hyrox.com/wp-content/uploads/2026/05/HYROX_Puebla_Mapa.pdf'),
    ('mexico-city', 'https://hyrox.com/wp-content/uploads/2024/11/Mapa_no-sponsors-scaled.png'),

    # North America
    ('ottawa', 'https://hyrox.com/wp-content/uploads/2026/05/25-26-NA_Ottawa_Athlete-Map_79_x73_-1.pdf'),
    ('salt-lake-city', 'https://hyrox.com/wp-content/uploads/2026/09/2026_HYROX_SaltLakeCity_VenueMap_PRINT_79x73-3.pdf'),

    # Poland
    ('warsaw', 'https://hyrox.com/wp-content/uploads/2026/04/Warsaw-Event_MAP-April.pdf'),

    # Middle East
    ('sharjah', 'https://hyrox.com/wp-content/uploads/2025/04/Hyrox-Sharjah-2025-Map-Final-01-scaled-1.jpg'),

    # Asia (China, Korea, Japan)
    ('beijing', 'https://hyrox.com/wp-content/uploads/2026/09/HYROX-BEIJING-venue-map-1.pdf'),
    ('shanghai', 'https://hyrox.com/wp-content/uploads/2026/05/shanghai_venue_map-scaled-1.jpg'),
    ('shenzhen', 'https://hyrox.com/wp-content/uploads/2026/08/HYROX-Shenzhen-Venue-Map.pdf'),
    ('chengdu', 'https://hyrox.com/wp-content/uploads/2026/07/Hyrox-Chengdu-Venue-Map.pdf'),
    ('hangzhou', 'https://hyrox.com/wp-content/uploads/2026/07/hangzhou704_venue_map.pdf'),
    ('wuhan', 'https://hyrox.com/wp-content/uploads/2026/04/HYROX_Wuhan_Venue_Map1.pdf'),
    ('osaka', 'https://hyrox.com/wp-content/uploads/2026/01/JP-Osaka-Floor-Plan-V1.pdf'),
    ('seoul', 'https://hyrox.com/wp-content/uploads/2024/10/SK-Incheon-Floor-Plan.pdf'),
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
    if '?' in ext:
        ext = ext.split('?')[0]
    
    tmp_path = f"/tmp/{tag}_tmp.{ext}"
    out_png = os.path.join(MAPS_DIR, f"{tag}.png")

    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            with open(tmp_path, 'wb') as f:
                f.write(resp.read())

        if ext == 'pdf':
            subprocess.run(['sips', '-s', 'format', 'png', tmp_path, '--out', out_png], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        else: # image (png, jpg, jpeg)
            subprocess.run(['sips', '-s', 'format', 'png', tmp_path, '--out', out_png], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        
        if os.path.exists(out_png) and os.path.getsize(out_png) > 1000:
            print(f"✅ Processed {tag}: {os.path.getsize(out_png)//1024} KB")
            return True
    except Exception as e:
        print(f"❌ Failed {tag}: {e}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    return False

def main():
    print("=" * 64)
    print("🔥 SUPER BATCH COURSE MAPS INGESTION")
    print("=" * 64)

    active_templates = {}
    for tag, url in SUPER_MAPS:
        ok = download_and_process(tag, url)
        if ok or os.path.exists(os.path.join(MAPS_DIR, f"{tag}.png")):
            active_templates[tag] = f"{tag}.png"

    print(f"\n📦 Active master venue templates ready: {len(active_templates)}")

    # Fetch races missing maps
    sql_get = """
    SELECT id, city, date, country
    FROM hyrox_races
    WHERE substr(date, 1, 4) IN ('2024', '2025', '2026')
      AND (course_map_url IS NULL OR course_map_url = '')
    ORDER BY date DESC;
    """
    res = run_vps_sql(sql_get)
    rows = res['results'][0]['response']['result']['rows']
    print(f"🎯 Total missing races currently: {len(rows)}")

    updates = []
    for r in rows:
        rid = r[0]['value']
        city = (r[1].get('value') or '').lower()
        country = (r[3].get('value') or '').lower()

        matched_file = None
        for tag, fname in active_templates.items():
            clean_tag = tag.replace('-', ' ')
            if clean_tag in city or tag in rid.lower() or (tag == 'mexico-city' and ('mexico' in city or 'mexico' in rid.lower())):
                matched_file = fname
                break
        
        # Fallbacks for specific variations
        if not matched_file:
            if 'ciudad-de-mexico' in rid or 'mexico' in rid:
                matched_file = active_templates.get('mexico-city')
            elif 'acapulco' in rid:
                matched_file = active_templates.get('mexico-city')
            elif 'salt-lake' in rid:
                matched_file = active_templates.get('salt-lake-city')
            elif 'incheon' in rid or 'seoul' in rid:
                matched_file = active_templates.get('seoul')

        if matched_file:
            src = os.path.join(MAPS_DIR, matched_file)
            dst = os.path.join(MAPS_DIR, f"{rid}.png")
            if os.path.exists(src):
                shutil.copyfile(src, dst)
                map_url = f"http://192.168.100.132:3002/maps/{rid}.png"
                updates.append((rid, map_url))
                print(f"   🔗 Linked {rid} -> {matched_file}")

    print(f"\n🚀 Committing {len(updates)} map links to VPS database...")
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
