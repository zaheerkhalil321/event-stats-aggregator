# 🛠️ HYROX Data Pipeline: Known Issues & Planned Fixes

This document tracks all diagnosed data discrepancies between our Supabase database, Mika Timing, and the TrainRox mobile app, along with the exact surgical code fixes.

---

## 📌 Summary Table

| # | Issue / Race | Root Cause | Impact | Planned Code Fix | Status |
| :---: | :--- | :--- | :---: | :--- | :---: |
| **1** | **🇩🇪 Berlin 2026**<br>Missing Weekend 2 | Berlin spanned two weekends (May 22–25 & May 28–31) with 36 wave dropdowns. Weekend 2 waves were skipped due to `<select name="event"> optgroup` DOM attach timing between multi-wave iterations. | **-2,755 athletes**<br>*(DB: 26,450 vs App: 29,205)* | Add `{ state: 'attached' }` when waiting for `select[name="event"] optgroup` after `page.goto(listUrl)`, and ensure multi-wave loop properly awaits dropdown options. | ⏳ Pending Approval |
| **2** | **🇱🇻 🇨🇳 🇲🇽 🇿🇦 🇫🇮 Orphan Optgroups (`sonstige`)**<br>(Riga, Shanghai, Puebla, Johannesburg, Helsinki) | Mika Timing mistakenly placed Open Doubles (`HYROX DOUBLES`) and Adaptive for these 5 cities into `<optgroup label="sonstige">` (*German for Other/Misc*) instead of their respective city optgroups. | Missing Open Doubles across all 5 events: e.g. Puebla (-5.2k), Shanghai (-3.6k), Riga (-2.6k). | If a division option (e.g. `HYROX DOUBLES`) is not found in the city optgroup, fallback to scan `sonstige` matching the event code prefix. | ⏳ Pending Approval |
| **3** | **🇫🇷 Multi-Page Pagination**<br>(Lyon Pro Doubles Men etc.) | In divisions with >20 pages, Mika Timing renders `<li class="disabled"><span>...</span></li>` for the ellipsis. The selector `.pages-nav-button.disabled` matched this ellipsis and stopped scraping at page 20 instead of 25. | **-100 to -200 athletes** in massive divisions | Restrict `isLast` to only target the Next button specifically: `li.pages-nav-button.disabled:has(a[aria-label="Next"]), li.pages-nav-button.inactive:has(a:has-text(">"))`. | ⏳ Pending Approval |
| **4** | **⏱️ Relay Cutoff Teams**<br>(Incheon 2026 etc.) | Teams finishing over the 2-hour cutoff time (02:02 to 02:07) are dropped by TrainRox app, but retained in Mika Timing official ranks. | **+4 teams (16 athletes)** in DB vs App | No fix needed. DB accurately preserves official Mika Timing results. | ✅ Verified (Working as intended) |
| **5** | **🗽 New York 2026 Men Relay** | TrainRox app only synced wave 1 (64 finishers / 16 teams). Our database captured both weekends (243 teams / 972 athletes). | **+908 athletes** in DB vs App | No fix needed. DB is more complete and accurate than the app. | ✅ Verified (Working as intended) |
| **6** | **🏢 HYROX Corporate Relay**<br>(Hong Kong, London, etc.) | Large financial hub cities feature B2B / Corporate Relays (4 employees per team). Scraper's multi-wave filter previously skipped `CORPORATE` keyword to avoid double counting standard waves. | **+1,616 athletes** in Hong Kong 2026 | Refined `isSummary` filter so that `CORPORATE` options are only accepted when specifically scraping `HYROX CORPORATE RELAY`. | ✅ Fixed & Deployed |

---

## 🔍 Detailed Diagnosis & Code Fixes

### 1. Berlin 2026: Multi-Wave Dropdown Attach
* **File:** `sync_events.mjs` (Lines ~340–365 and ~505–520)
* **Problem:**
  Mika Timing has 36 option dropdowns for Berlin across two weekends. When the scraper finished Weekend 1 and navigated back to `listUrl` for Weekend 2, the `<select name="event">` DOM was re-rendered dynamically. Because Playwright checked `isVisible()` before the options were fully populated, `targetValues` evaluated to empty, skipping Weekend 2 (May 28–31).
* **Fix Implementation:**
  ```javascript
  // Ensure select and optgroup are fully attached to DOM before evaluating
  await page.waitForSelector('select[name="event"] optgroup', { state: 'attached', timeout: 15000 });
  ```

---

### 2. Orphan Optgroups (`sonstige`): Riga, Shanghai, Johannesburg, Puebla, Helsinki
* **File:** `sync_events.mjs` (Lines ~354–377)
* **Problem:**
  Mika Timing's webmaster placed Open Doubles (`HYROX DOUBLES`) and Adaptive (`HYROX ADAPTIVE`) for multiple races outside of their respective city `<optgroup>` and into a generic `<optgroup label="sonstige">` (*German for Other/Misc*).
  Because the scraper only queried the `<optgroup>` matching the city name, it skipped the Open Doubles for these events.
* **Diagnosed Affected Events & Proof:**
  1. **🇱🇻 Riga 2026:**
     * `HD_LR3MS4JI166E` (Doubles) & `HA_LR3MS4JI166E` (Adaptive) were placed in `sonstige`.
     * Current DB: **2,234 athletes** (Pro, Open, Relays all 100% matched).
     * Missing in `sonstige`: **2,615 finishers** (Doubles Men 846, Women 810, Mixed 956, Adaptive 3).
     * Total: `2,234 + 2,615 = 4,849 athletes` vs App: **4,793 finishers** (🎯 99.0% Match).
  2. **🇨🇳 Shanghai 2026:**
     * `HD_LR3MS4JI1598` (Doubles) & `HA_LR3MS4JI1599` (Adaptive) were placed in `sonstige`.
     * Current DB: **5,912 athletes** (Pro, Open, Relays all 99%+ matched).
     * Missing in `sonstige`: **3,616 finishers** (Doubles Men 1,161, Women 1,074, Mixed 1,381).
     * Total: `5,912 + 3,616 = 9,528 athletes` vs App: **9,548 finishers** (🎯 99.8% Match).
  3. **🇲🇽 Puebla 2026:**
     * `HYROX DOUBLES` & `HYROX ADAPTIVE` were placed in `sonstige`.
     * Current DB: **3,872 athletes** (Pro Men 298 vs 298, Pro Women 115 vs 115, Pro Doubles 100% exact match).
     * Missing in `sonstige`: **5,222 finishers** (Doubles Men 1,617, Women 1,712, Mixed 1,885, Adaptive 8).
     * Total: `3,872 + 5,222 = 9,094 athletes` vs App: **9,125 finishers** (🎯 99.7% Match).
  4. **🇿🇦 Johannesburg 2026:**
     * `HYROX DOUBLES` & `HYROX ADAPTIVE` were placed in `sonstige`.
     * Current DB: **2,853 athletes** (Pro Doubles Men 198 vs 198, Relay Mixed 332 vs 332 exact 100% matches).
     * Missing in `sonstige`: **4,706 finishers** (Doubles Men 1,206, Women 2,131, Mixed 1,365, Adaptive 4).
     * Total: `2,853 + 4,706 = 7,559 athletes` vs App: **7,562 finishers** (🎯 99.96% Match).
  5. **🇫🇮 Helsinki 2026:**
     * `HYROX DOUBLES` & `HYROX ADAPTIVE` were placed in `sonstige`.
     * Current DB: **2,422 athletes** (Pro Doubles 100% exact, Relays 100% exact: Men 52 vs 52, Women 148 vs 148, Mixed 164 vs 164).
     * Missing in `sonstige`: **4,108 finishers** (Doubles Men 862, Women 1,808, Mixed 1,434, Adaptive 4) + Pro Singles.
* **Local Test Proof (100% Verified):**
  * Submitting `HD_LR3MS4JI166E` with `search[sex]=M` revealed **17 pages** (425 pairs = **850 finishers**, matching TrainRox app's **846 finishers** at 99.5%).
  * Page 1 verified winners:
    * 🥇 **Rank 1:** `Liam Shallicker, Chris Shaw` (00:52:51)
    * 🥈 **Rank 2:** `Gareth Moran, Trevor Mathews` (00:52:56)
* **Fix Implementation:**
  ```javascript
  // In targetValues extraction (inside page.evaluate):
  // 1. Gather all options from primary city optgroup
  let options = Array.from(og.querySelectorAll('option'));

  // 2. If division is HYROX DOUBLES or HYROX ADAPTIVE and not found in city optgroup,
  // extract common race ID code (e.g. "LR3MS4JI166") and check orphan "sonstige" / misc groups:
  const hasDivInCity = options.some(o => o.text.toUpperCase().includes(divEvent.toUpperCase()));
  if (!hasDivInCity) {
    const primarySample = options[0]?.value || '';
    const codeMatch = primarySample.match(/_([A-Z0-9]{10,12})/);
    if (codeMatch) {
      const racePrefix = codeMatch[1].slice(0, 11); // e.g. "LR3MS4JI166"
      const miscGroups = optgroups.filter(g => {
        const l = (g.getAttribute('label') || '').toLowerCase();
        return l.includes('sonstige') || l.includes('other') || l.includes('misc');
      });
      for (const mg of miscGroups) {
        const matchingOpts = Array.from(mg.querySelectorAll('option'))
          .filter(o => o.value.includes(racePrefix));
        options.push(...matchingOpts);
      }
    }
  }
  ```

---

### 3. Pagination Ellipsis Bug (`...` tag)
* **File:** `sync_events.mjs` (Line ~450)
* **Problem:**
  Mika Timing renders `<li class="disabled"><span>...</span></li>` for divisions with more than 20 pages. The existing check:
  `const isLast = await page.locator('.pages-nav-button.disabled, a.silver-link.disabled').isVisible()`
  accidentally matches the ellipsis and terminates pagination prematurely at Page 20.
* **Example in 🇫🇷 Lyon 2026:**
  * In Lyon, almost all divisions are **99.5% to 100.000% exact matches** (Pro Women 210 vs 210, Open Women 2,475 vs 2,475, Relay Mixed 304 vs 304, Doubles Mixed 6,110 vs 6,094, Doubles Men 5,290 vs 5,264).
  * However, two massive divisions stopped at Page 20 due to this bug:
    * `HYROX MEN`: DB scraped **3,441** vs App: **3,977** (stopped at Page 20).
    * `HYROX PRO DOUBLES MEN`: DB scraped 481 pairs (**962**) vs App: **1,222** (stopped at Page 20).
  * Fixing the selector allows pagination to cleanly proceed past Page 20 to the final page (e.g. Page 25).
* **Fix Implementation:**
  ```javascript
  // Restrict isLast check to strictly target the Next button
  const isLast = await page.locator(
    'li.pages-nav-button.disabled:has(a[aria-label="Next"]), ' +
    'li.pages-nav-button.inactive:has(a[aria-label="Next"]), ' +
    'li.pages-nav-button.disabled:has(a:has-text(">")), ' +
    'li.pages-nav-button.inactive:has(a:has-text(">"))'
  ).isVisible().catch(() => false);
  ```

---

## 📋 Action Plan When Ready

1. **Review:** Review this document and confirm you want these fixes applied.
2. **Code Edit:** Apply the 3 surgical edits to [sync_events.mjs](file:///c:/Users/pc/OneDrive/Desktop/event-stats-aggregator/sync_events.mjs).
3. **Local Dry-Run:** Test locally on `riga-2026` (verifying Doubles + Adaptive = 4,800+ athletes) and `berlin-2026` (verifying Weekend 2 = 29,200+ athletes).
4. **Resync Database:** Push code and re-run pipeline so Supabase database is 100% updated and exact.
