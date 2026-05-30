import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import { Page, chromium } from 'patchright';
import { mergeWatchedMovies, WatchedMovie } from './historyManager';
import { log } from './utils/logger';
import { sleep, gotoWithQueue } from './utils/human';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
const HISTORY_URL  = 'https://www.amctheatres.com/my-amc/history';

// Scrape every visible purchase entry on /my-amc/history using DOM selectors.
// Returns dedup'd entries (title + ISO date) — subscription/membership rows
// (which have no "Ticket Confirmation #") are skipped.
async function scrapeVisibleEntries(page: Page): Promise<WatchedMovie[]> {
  const raw = await page.evaluate(() => {
    const out: { title: string; dateText: string }[] = [];
    const dateHeadings = Array.from(document.querySelectorAll('h2'));
    for (const h2 of dateHeadings) {
      const dateText = (h2.textContent || '').trim();
      // Must look like "May 29, 2026"
      if (!/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(dateText)) continue;

      const wrapper = h2.parentElement;
      if (!wrapper) continue;

      const trigger = wrapper.querySelector('.accordion__trigger');
      if (!trigger) continue;

      const h3s = Array.from(trigger.querySelectorAll('h3'));
      const confirmH3 = h3s.find(h => /Ticket Confirmation/i.test(h.textContent || ''));
      // Skip subscriptions / non-ticket rows
      if (!confirmH3) continue;

      const titleH3 = h3s.find(h => h !== confirmH3);
      const title = (titleH3?.textContent || '').trim();
      if (!title) continue;

      out.push({ title, dateText });
    }
    return out;
  });

  const movies: WatchedMovie[] = [];
  const seen = new Set<string>();
  for (const { title, dateText } of raw) {
    const parsed = new Date(dateText);
    if (isNaN(parsed.getTime())) continue;
    const date = parsed.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const key = `${title}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    movies.push({ title, date });
  }
  return movies;
}

// Change the period filter via the native <select> element. Returns true if
// the value actually changed (i.e. the option exists).
async function setPeriodFilter(page: Page, value: string): Promise<boolean> {
  return page.evaluate((v: string) => {
    const select = document.querySelector('select') as HTMLSelectElement | null;
    if (!select) return false;
    const opt = select.querySelector(`option[value="${v}"]`) as HTMLOptionElement | null;
    if (!opt) return false;
    if (select.value === v) return false;
    // Use the native setter so React-style components register the change
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, v);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, value);
}

// Scrape /my-amc/history, walking the period filter to gather as much
// history as the page exposes, and merge into watched-history.json.
// Caller supplies an already-authenticated page (e.g. the booking flow's page).
export async function crawlAndMergeHistory(page: Page): Promise<{ added: number; total: number; scraped: number }> {
  log('Fetching watch history from AMC...');
  await gotoWithQueue(page, HISTORY_URL);
  await sleep(2000);
  await page.waitForSelector('.accordion__trigger', { timeout: 15_000 }).catch(() => {});

  const all: WatchedMovie[] = [];
  const seen = new Set<string>();
  const mergeBatch = (batch: WatchedMovie[]) => {
    for (const m of batch) {
      const k = `${m.title}|${m.date}`;
      if (!seen.has(k)) { seen.add(k); all.push(m); }
    }
  };

  mergeBatch(await scrapeVisibleEntries(page));

  // Walk the period filter to widen the window.
  const filterValues = ['60d', '90d', '1y', '2025', '2024', '2023'];
  for (const v of filterValues) {
    const changed = await setPeriodFilter(page, v);
    if (!changed) continue;
    await sleep(2500);
    await page.waitForSelector('.accordion__trigger', { timeout: 10_000 }).catch(() => {});
    mergeBatch(await scrapeVisibleEntries(page));
  }

  const { added, total } = mergeWatchedMovies(all);
  log(`History scraped: ${all.length} visible entries · +${added} new · ${total} total in watched-history.json`);
  return { added, total, scraped: all.length };
}

// Standalone CLI: `npm run crawl-history`
async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: null,
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  try {
    await crawlAndMergeHistory(page);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err?.message ?? err);
    process.exit(1);
  });
}
