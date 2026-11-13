# Live tracking plan

Goal: during a race, show who is racing now, where each athlete is on the course, their splits so far
and an estimated finish, like TrainRox / ROXFIT / Hyranking. Data at most ~10 minutes old.

## Where the data comes from

| What | Source | How often |
|---|---|---|
| Who races, heat time, bib, age group | `startlist.hyrox.com` list pages (same wave ids and `idp` as results.hyrox.com) | every 3 h on race days |
| Finished | results.hyrox.com list pages (already read by the live sync) | every pass (~10 min) |
| Splits so far + current station | results.hyrox.com detail page of a racing athlete: split table and the "Time Of Day" table (last stamp = where they are) | every pass, racing athletes only |
| PB, past races | our own `hyrox_athlete_results` | — |

Mika is only called from GitHub runners through `scripts/lib/mika_http.mjs` (paced, waits out 403s).
The API (Vercel) never calls mika; it only reads our database.

## Database

One new table, `startlist_entries` (one row per athlete/team per race):

- `race_id`, `mika_idp` (primary key together), `mika_event`, `division`, `full_name`, `bib_number`,
  `age_group`, `day`, `heat` ("17:50"), `start_at` (heat start in UTC, ISO)
- `live` (JSON: splits so far, last timing point, elapsed), `live_updated_at`
- `updated_at`

Status is worked out when read, not stored:

- **upcoming**: `start_at` in the future
- **finished**: a row in `hyrox_athlete_results` with the same `mika_idp`
- **racing**: started, not finished, started less than 3 h ago
- **no result**: started over 3 h ago and not finished (DNS / DNF)

Rows of a race are deleted a few days after it ends (the results table keeps everything that matters).

## Steps

1. **Scraper: start lists.** `sync_live.mjs` reads the start list of every race running today (also
   before the first results appear) and upserts `startlist_entries`; again every 3 h.
2. **Scraper: racing splits.** Each pass, right after the list pages, open the detail pages of racing
   athletes (oldest `live_updated_at` first) for up to ~4 minutes, then finishers' details as today.
3. **Test on Seoul** (live 13–15 Nov 2026): counts vs TrainRox, splits vs mika.
4. **API:**
   - `GET /v1/live/races/{id}`: per division registered / upcoming / racing / finished / no result,
     heats with racing counts.
   - `GET /v1/live/races/{id}/athletes`: racing athletes with current station, elapsed, gap
     (filter by division / heat).
   - `GET /v1/live/athletes/{idp}`: splits so far, current station, estimated finish, heat mates,
     PB and past races.
   - Estimated finish: elapsed so far scaled by finished athletes of the same division
     (median time at the same timing point vs. their median finish). Marked with `~`.
5. **Website:** live race page (divisions, heats, racing list) and live athlete page.
6. **Cleanup:** delete start list rows 7 days after a race.

## Later, only if needed

- Faster than 10 minutes for athletes someone is watching (a watch list read every ~30 s).
- Push notifications per station.
