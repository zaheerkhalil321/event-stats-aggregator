import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Extracts maxPages from a simulated list of pagination element texts,
 * matching the exact evaluate logic in sync_live.mjs (line 149-153).
 */
function extractMaxPages(pageItemTexts) {
  const numPages = pageItemTexts.map(t => t.trim()).filter(t => /^\d+$/.test(t));
  return numPages.length ? Math.max(...numPages.map(Number)) : 1;
}

/**
 * Flawed regex approach used in earlier versions that caused false page limits
 */
function flawedRegexExtractor(htmlText) {
  const match = htmlText.match(/([\d,]+)\s*(?:results|Ergebnisse)/i);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
}

describe('Pagination & Results Extractor', () => {
  it('TC19: Correctly calculates maxPages from a multi-page navigation bar', () => {
    const mockPaginationTexts = ['1', '2', '3', '4', '5', '...', '14', 'Next >'];
    const maxPages = extractMaxPages(mockPaginationTexts);
    assert.strictEqual(maxPages, 14);
  });

  it('TC20: Returns 1 when no pagination elements exist (single page result)', () => {
    const mockPaginationTexts = [];
    const maxPages = extractMaxPages(mockPaginationTexts);
    assert.strictEqual(maxPages, 1);
  });

  it('TC21: Filters out non-numeric entries like "« Previous", "Next »", "..."', () => {
    const mockPaginationTexts = ['«', '1', '2', '...', 'Next', '»'];
    const maxPages = extractMaxPages(mockPaginationTexts);
    assert.strictEqual(maxPages, 2);
  });

  it('TC22: Demonstrates why flawed regex failed on "Season 26/27 Results"', () => {
    const problematicMikaHeader = '<h1 class="header">HYROX Season 26/27 Results</h1>';
    const flawedResult = flawedRegexExtractor(problematicMikaHeader);
    
    // The flawed regex mistakenly matched "27" from "Season 26/27 Results"
    assert.strictEqual(flawedResult, 27);

    // But DOM-based pagination correctly rejects header text and returns 1 if no pages
    const domResult = extractMaxPages([]);
    assert.strictEqual(domResult, 1);
  });

  it('TC23: Large wave category with 35 pages calculates exactly 35', () => {
    const mockPaginationTexts = Array.from({ length: 35 }, (_, i) => String(i + 1));
    const maxPages = extractMaxPages(mockPaginationTexts);
    assert.strictEqual(maxPages, 35);
  });
});
