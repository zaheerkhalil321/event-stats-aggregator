import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar, parseCalendarDate, cityFromTitle } from '../sync_upcoming.mjs';

const article = (title, url, code, start, end, extraClass = 'type-adults') => `
<article class="w-grid-item post-1 event type-event status-publish ${extraClass}" data-id="1">
  <img src="https://hyrox.com/img.jpg" />
  <div class="event_city_letter_code"><span class="w-post-elm-value">${code}</span></div>
  <h2 class="w-post-elm post_title usg_post_title_1"><a href="${url}">${title}</a></h2>
  <span class="event_date_1"><span class="w-post-elm-value">${start}</span></span>
  <span class="event_date_3"><span class="w-post-elm-before">– </span><span class="w-post-elm-value">${end}</span></span>
</article>`;

describe('sync_upcoming', () => {
  it('parses calendar dates', () => {
    assert.equal(parseCalendarDate('23. Oct. 2026'), '2026-10-23');
    assert.equal(parseCalendarDate('7. Jan. 2027'), '2027-01-07');
    assert.equal(parseCalendarDate('DATE COMING SOON!'), null);
  });
  it('strips sponsors and detects Youngstars', () => {
    assert.deepEqual(cityFromTitle('MyFitnessPal HYROX Tampa'), { city: 'Tampa', youngstars: false });
    assert.deepEqual(cityFromTitle('HYROX YOUNGSTARS BIRMINGHAM'), { city: 'Birmingham', youngstars: true });
    assert.equal(cityFromTitle('EDEKA HYROX Düsseldorf').city, 'Düsseldorf');
  });
  it('reads events from the find-my-race grid and skips other articles', () => {
    const html = article('HYROX Abu Dhabi', 'https://hyrox.com/event/hyrox-abu-dhabi/', 'AUH', '23. Oct. 2026', '25. Oct. 2026')
      + '<article class="w-grid-item us_portfolio"><h2 class="post_title"><a href="x">Sponsor</a></h2></article>'
      + article('ZHONGAN HYROX SHANGHAI', 'https://hyrox.com/event/hyrox-shanghai/', 'SHA', 'DATE COMING SOON!', '');
    const events = parseCalendar(html);
    assert.equal(events.length, 2);
    assert.deepEqual({ ...events[0], image: undefined }, { url: 'https://hyrox.com/event/hyrox-abu-dhabi/', title: 'HYROX Abu Dhabi', code: 'AUH', city: 'Abu Dhabi', youngstars: false, start: '2026-10-23', end: '2026-10-25', image: undefined });
    assert.equal(events[1].start, null);
  });
});
