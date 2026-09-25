import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const season of ['season-7', 'season-8']) {
    const page = await browser.newPage();
    try {
      await page.goto(`https://results.hyrox.com/${season}/?pid=list`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log(`Title for ${season}:`, await page.title());
      const events = await page.evaluate(() => {
        const select = document.querySelector('select[name="event_main_group"]');
        if (select) {
          return Array.from(select.options).map(o => o.textContent.trim()).filter(t => t && t !== 'All' && t !== '%');
        }
        const optgroups = Array.from(document.querySelectorAll('select[name="event"] optgroup'));
        if (optgroups.length) {
          return optgroups.map(og => og.getAttribute('label')?.trim()).filter(t => t && t !== 'All');
        }
        return [];
      });
      console.log(`Events in ${season} (${events.length}):`, events);
    } catch (e) {
      console.error(`Error on ${season}:`, e.message);
    } finally {
      await page.close();
    }
  }
  await browser.close();
})();
