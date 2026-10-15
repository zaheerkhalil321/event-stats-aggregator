#!/usr/bin/env python3
"""
sync_full_race_info.py
Scrapes all race information directly from official HYROX event pages (hyrox.com):
- Hero Banner / Image URL
- Race Schedule (Day-by-day heats and start windows)
- Check-in Information (Important Information, ID requirements, bib pickup)
- Course Details (Laps to run instructions & High-res Course Map Floor Plan)
- Ceremony Times (Podium / Award timings for each division)
- Official Venue Name & Address
- Sponsor Name
- Athlete Guide & Venue Map PDF links
"""

import urllib.request
import re
import json
import os
import subprocess
from html import unescape
from datetime import datetime

VPS_URL = os.environ.get("TURSO_DATABASE_URL", "https://db.hyroxresultsapi.com")
MAPS_DIR = "/Users/mzaheer/Downloads/working-projects/hyrox-results-api/public/maps"
os.makedirs(MAPS_DIR, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}

def clean_html_text(html_fragment):
    if not html_fragment:
        return ""
    text = re.sub(r'<(?:br|p|tr|div|h\d)[^>]*>', '\n', html_fragment, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = unescape(text)
    lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in text.split('\n')]
    cleaned = []
    prev_empty = False
    for l in lines:
        if not l:
            if not prev_empty:
                cleaned.append("")
                prev_empty = True
        else:
            cleaned.append(l)
            prev_empty = False
    return '\n'.join(cleaned).strip()

def run_vps_sql(sql_query):
    req = urllib.request.Request(
        f"{VPS_URL}/v2/pipeline",
        data=json.dumps({'requests': [{'type': 'execute', 'stmt': {'sql': sql_query}}]}).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))

def convert_pdf_to_png(pdf_url, race_id):
    tmp_pdf = f"/tmp/{race_id}_map.pdf"
    out_png = os.path.join(MAPS_DIR, f"{race_id}.png")
    
    try:
        req = urllib.request.Request(pdf_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as resp:
            with open(tmp_pdf, 'wb') as f:
                f.write(resp.read())
        
        # Convert using macOS native sips
        cmd = ["sips", "-s", "format", "png", tmp_pdf, "--out", out_png]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        if os.path.exists(out_png) and os.path.getsize(out_png) > 1000:
            return f"http://192.168.100.132:3002/maps/{race_id}.png"
    except Exception as e:
        print(f"      ⚠️ Map conversion failed for {race_id}: {e}")
    finally:
        if os.path.exists(tmp_pdf):
            try: os.remove(tmp_pdf)
            except: pass
    return None

def fetch_html(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def scrape_event_details(url, race_id):
    html = fetch_html(url)
    data = {}

    # Hero / OG Image
    og_m = re.search(r'<meta property=\"og:image\" content=\"([^\"]+)\"', html)
    data['image_url'] = og_m.group(1) if og_m else None

    # Standard WordPress Custom Fields
    fields = {}
    for fld in ['acc_race_info_content', 'acc_athlete_checkin_content', 'acc_ceremony_content', 'map_address']:
        m = re.search(r'class=\"[^\"]*event_' + fld + r'[^\"]*\">', html)
        if m:
            start = m.end()
            end = html.find('</div>', start)
            fields[fld] = clean_html_text(html[start:end])
        else:
            fields[fld] = ""

    # Split race_info into schedule & laps
    race_info = fields.get('acc_race_info_content', '')
    laps_idx = race_info.find('Laps to run')
    if laps_idx != -1:
        data['race_schedule'] = race_info[:laps_idx].strip()
        data['lap_instructions'] = race_info[laps_idx:].strip()
    else:
        data['race_schedule'] = race_info
        data['lap_instructions'] = None

    data['check_in_info'] = fields.get('acc_athlete_checkin_content', '')
    data['ceremony_times'] = fields.get('acc_ceremony_content', '')
    data['venue_address'] = fields.get('map_address', '')

    # Map PDF
    map_m = re.search(r'href=[\"\']([^\"\']*(?:Map|map|floorplan|Course)[^\"\']*\.pdf)[\"\']', html)
    data['map_pdf'] = map_m.group(1) if map_m else None
    
    # Guide PDF
    guide_m = re.search(r'href=[\"\']([^\"\']*(?:Guide|guide|athlete-guide|Athleten)[^\"\']*\.pdf)[\"\']', html)
    data['guide_pdf'] = guide_m.group(1) if guide_m else None

    # Venue Name
    venue_m = re.search(r'<a[^>]+href=[\"\'][^\"\']*(?:convention|center|hall|arena|palexpo|expocentre|amber|messe)[^\"\']*[\"\'][^>]*><span class=\"w-btn-label\">([^<]+)</span>', html, re.I)
    if venue_m:
        data['venue_name'] = unescape(venue_m.group(1)).strip()
    else:
        vm2 = re.search(r'<span class=\"w-btn-label\">([A-Z0-9][^<]*(?:Centre|Center|Arena|Hall|Palexpo|Expo|Messe)[^<]*)</span>', html, re.I)
        data['venue_name'] = unescape(vm2.group(1)).strip() if vm2 else None

    # Sponsor
    h1_m = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
    if h1_m:
        h1_text = clean_html_text(h1_m.group(1))
        sp_m = re.match(r'^(.*?)\s+HYROX', h1_text, re.I)
        data['sponsor_name'] = sp_m.group(1).strip() if sp_m and sp_m.group(1).lower() != 'hyrox' else None
    else:
        data['sponsor_name'] = None

    # Convert map PDF to PNG if available
    course_map_url = None
    if data['map_pdf']:
        course_map_url = convert_pdf_to_png(data['map_pdf'], race_id)
    data['course_map_url'] = course_map_url

    return data

def main():
    print("=" * 64)
    print("🚀 HYROX FULL RACE INFORMATION & COURSE MAP SCRAPER")
    print(f"📡 VPS Target: {VPS_URL}")
    print("=" * 64)

    # 1. Fetch DB Races
    res = run_vps_sql("SELECT id, name, city, country, date FROM hyrox_races;")
    db_races = [
        {'id': r[0]['value'], 'name': r[1]['value'], 'city': r[2]['value'], 'country': r[3]['value'], 'date': r[4]['value']}
        for r in res['results'][0]['response']['result']['rows']
    ]
    print(f"📦 Loaded {len(db_races)} existing races from VPS database.")

    # 2. Fetch find-my-race Calendar
    print("🌐 Fetching official calendar from https://hyrox.com/find-my-race/ ...")
    calendar_html = fetch_html("https://hyrox.com/find-my-race/")

    teaser_pattern = re.compile(
        r'<div class=\"[^\"]*en_eventteaser_top[^\"]*\">'
        r'.*?<img[^>]+src=\"([^\"]+)\"'
        r'.*?<span class=\"w-post-elm-value\">([A-Z0-9]{2,4})</span>'
        r'.*?<h2 class=\"[^\"]*post_title[^\"]*\"><a href=\"(https://hyrox\.com/event/[^\"]+)\">([^<]+)</a></h2>'
        r'.*?<span class=\"w-post-elm-value\">([^<]+)</span>',
        re.DOTALL
    )

    events = []
    for m in teaser_pattern.finditer(calendar_html):
        card_img, code, url, title, date_str = m.groups()
        events.append({
            'card_img': card_img,
            'code': code,
            'url': url,
            'title': unescape(title.replace('&#8217;', "'").replace('&amp;', '&')).strip(),
            'date_str': date_str.strip()
        })

    print(f"📋 Found {len(events)} events on official calendar.\n")

    updated_count = 0

    for idx, ev in enumerate(events, 1):
        url = ev['url']
        title = ev['title']
        date_str = ev['date_str']

        # Determine year
        year_m = re.search(r'202[4-7]', date_str)
        year = year_m.group(0) if year_m else '2026'

        # Match to DB race
        matched_race = None
        for r in db_races:
            city = (r['city'] or '').lower().strip()
            if city and len(city) > 3:
                if (city in title.lower() or city in url.lower()):
                    if year in (r['date'] or ''):
                        matched_race = r
                        break
        
        # Fallback match without year
        if not matched_race:
            for r in db_races:
                city = (r['city'] or '').lower().strip()
                if city and len(city) > 3 and (city in title.lower() or city in url.lower()):
                    matched_race = r
                    break

        race_id = matched_race['id'] if matched_race else None
        if not race_id:
            # Generate slug for new upcoming race
            slug_base = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
            race_id = f"{slug_base}-{year}"

        print(f"[{idx}/{len(events)}] 📍 {title} ({date_str}) ➔ {race_id}")

        try:
            details = scrape_event_details(url, race_id)
            hero_image = details['image_url'] or ev['card_img']
            venue_name = details['venue_name'] or matched_race.get('venue') if matched_race else None
            sponsor_name = details['sponsor_name']
            venue_addr = details['venue_address'] or None
            course_map = details['course_map_url']
            lap_inst = details['lap_instructions']
            guide_pdf = details['guide_pdf']
            race_sch = details['race_schedule']
            check_in = details['check_in_info']
            ceremony = details['ceremony_times']

            def esc_sql(val):
                if val is None:
                    return "NULL"
                return "'" + str(val).replace("'", "''") + "'"

            if matched_race:
                # Update existing race
                update_sql = f"""
                UPDATE hyrox_races SET
                    image_url = COALESCE({esc_sql(hero_image)}, image_url),
                    venue_name = COALESCE({esc_sql(venue_name)}, venue_name),
                    sponsor_name = COALESCE({esc_sql(sponsor_name)}, sponsor_name),
                    venue = COALESCE({esc_sql(venue_addr)}, venue),
                    course_map_url = COALESCE({esc_sql(course_map)}, course_map_url),
                    lap_instructions = COALESCE({esc_sql(lap_inst)}, lap_instructions),
                    athlete_guide_url = COALESCE({esc_sql(guide_pdf)}, athlete_guide_url),
                    race_schedule = COALESCE({esc_sql(race_sch)}, race_schedule),
                    check_in_info = COALESCE({esc_sql(check_in)}, check_in_info),
                    ceremony_times = COALESCE({esc_sql(ceremony)}, ceremony_times),
                    event_page_url = {esc_sql(url)},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = {esc_sql(race_id)};
                """
                run_vps_sql(update_sql)
                updated_count += 1
                has_map = "🗺️ Map Saved" if course_map else "No Map"
                has_sch = "⏱️ Schedule Saved" if race_sch else "No Schedule"
                print(f"   ✅ Updated DB! ({has_sch} | {has_map})")
            else:
                # Insert upcoming race
                insert_sql = f"""
                INSERT INTO hyrox_races (
                    id, name, city, country, country_code, date, season, status,
                    image_url, venue_name, sponsor_name, venue, course_map_url,
                    lap_instructions, athlete_guide_url, race_schedule, check_in_info,
                    ceremony_times, event_page_url
                ) VALUES (
                    {esc_sql(race_id)}, {esc_sql(title)}, {esc_sql(ev['code'])}, 'International', 'INT',
                    {esc_sql(f'{year}-01-01')}, '26/27', 'upcoming',
                    {esc_sql(hero_image)}, {esc_sql(venue_name)}, {esc_sql(sponsor_name)},
                    {esc_sql(venue_addr)}, {esc_sql(course_map)}, {esc_sql(lap_inst)},
                    {esc_sql(guide_pdf)}, {esc_sql(race_sch)}, {esc_sql(check_in)},
                    {esc_sql(ceremony)}, {esc_sql(url)}
                ) ON CONFLICT(id) DO UPDATE SET
                    image_url = COALESCE(EXCLUDED.image_url, hyrox_races.image_url),
                    race_schedule = COALESCE(EXCLUDED.race_schedule, hyrox_races.race_schedule),
                    check_in_info = COALESCE(EXCLUDED.check_in_info, hyrox_races.check_in_info),
                    ceremony_times = COALESCE(EXCLUDED.ceremony_times, hyrox_races.ceremony_times);
                """
                run_vps_sql(insert_sql)
                updated_count += 1
                print(f"   ✨ Inserted New Upcoming Race: {race_id}")

        except Exception as err:
            print(f"   ⚠️ Error processing {url}: {err}")

    print("\n" + "=" * 64)
    print(f"🎉 COMPLETED! Successfully synced {updated_count} races with full information & maps.")
    print("=" * 64)

if __name__ == '__main__':
    main()
