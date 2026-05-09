import * as dotenv from 'dotenv';
dotenv.config();

import * as path from 'path';
import { chromium } from 'patchright';
import { saveHistory, WatchedMovie } from './historyManager';
import { log } from './utils/logger';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Parse movie entries from the history page's raw body text.
// Each entry looks like:
//   May 8, 2026
//   Project Hail Mary
//   2 HR 36 MIN
//   PG13
//   TICKET CONFIRMATION #: 0164855990
//   $0.00
function parseEntries(rawText: string): WatchedMovie[] {
  const entries: WatchedMovie[] = [];

  // Split on "TICKET CONFIRMATION #:" — each split gives us the block BEFORE the confirmation
  const blocks = rawText.split(/TICKET CONFIRMATION #:\s*\d+/);

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // We only care about the last few lines of each block (date + title + runtime/rating)
    const tail = lines.slice(-8);

    // Find the date (last occurrence of "Month DD, YYYY")
    let dateISO = '';
    let dateIdx = -1;
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = tail[i].match(/^(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
      if (m) {
        const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
        if (!isNaN(d.getTime())) {
          dateISO = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
          dateIdx = i;
          break;
        }
      }
    }
    if (!dateISO || dateIdx < 0) continue;

    // Title is the line(s) between the date and runtime/rating
    const afterDate = tail.slice(dateIdx + 1);
    const titleLines: string[] = [];
    for (const line of afterDate) {
      // Stop at runtime or rating
      if (/^\d+\s+HR/i.test(line) || /^(G|PG|R|NC-17|PG-?13)$/i.test(line)) break;
      // Skip empty, "Cancel Reservation", price lines
      if (/^\$[\d.]+$/.test(line) || /cancel/i.test(line)) break;
      titleLines.push(line);
    }
    const title = titleLines.join(' ').trim();
    if (!title || title.length < 2) continue;

    // Skip non-movie entries (subscriptions, promotions)
    if (/^AMC A-List Monthly|^AMC Screen Unseen|^Refunds|^Past \d|^Past year|^2\d{3}$/i.test(title)) continue;

    entries.push({ title, date: dateISO });
  }

  return entries;
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: null,
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  log('Navigating to AMC order history...');
  await page.goto('https://www.amctheatres.com/my-amc/history', { waitUntil: 'domcontentloaded' });

  // Wait out Queue-it if active
  if (page.url().includes('queue')) {
    log('Queue-it waiting room — waiting up to 3 min...');
    await page.waitForURL('**/my-amc/history**', { timeout: 180_000 });
    log('Queue passed.');
  }
  await sleep(3000);

  const allMovies: WatchedMovie[] = [];
  const seen = new Set<string>();

  function mergeEntries(entries: WatchedMovie[]) {
    for (const e of entries) {
      const key = `${e.title}|${e.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        allMovies.push(e);
      }
    }
  }

  // Scrape the current view (defaults to "Past 30 days")
  log('Scraping default view...');
  const defaultText = await page.innerText('body').catch(() => '');
  mergeEntries(parseEntries(defaultText));
  log(`  Found ${allMovies.length} entries so far`);

  // Find and click each time-period filter to get full history
  const filterLabels = ['Past 60 days', 'Past 90 days', 'Past year', '2025', '2024', '2023'];

  for (const label of filterLabels) {
    const clicked = await page.evaluate((lbl: string) => {
      const all = Array.from(document.querySelectorAll('button, a, li, span')) as HTMLElement[];
      const btn = all.find(el => el.innerText?.trim() === lbl);
      if (btn) { btn.click(); return true; }
      return false;
    }, label);

    if (!clicked) continue;

    log(`Clicked filter: "${label}"`);
    await sleep(2500);

    const text = await page.innerText('body').catch(() => '');
    const before = allMovies.length;
    mergeEntries(parseEntries(text));
    log(`  +${allMovies.length - before} new entries (total: ${allMovies.length})`);
  }

  // Sort newest first
  allMovies.sort((a, b) => (b.date > a.date ? 1 : -1));

  log(`\nTotal unique movies scraped: ${allMovies.length}`);
  allMovies.forEach(m => log(`  ${m.date}  ${m.title}`));

  saveHistory({ lastUpdated: new Date().toISOString().split('T')[0], movies: allMovies });
  log('\nSaved to watched-history.json');

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
