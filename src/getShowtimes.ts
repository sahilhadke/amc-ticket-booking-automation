import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { chromium } from 'patchright';
import { gotoWithQueue, sleep } from './utils/human';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

export interface Showtime {
  time: string;           // e.g. "4:00pm"
  url: string;            // https://www.amctheatres.com/showtimes/{id}
  format: string;         // e.g. "Laser at AMC", "IMAX", ""
  availability: string;   // e.g. "Almost Full", ""
}

export interface MovieShowtimes {
  title: string;
  slug: string;           // e.g. "the-devil-wears-prada-2-80466"
  showtimes: Showtime[];
}

export interface ShowtimesResult {
  date: string;
  theater: string;
  theaterSlug: string;
  fetchedAt: string;
  movies: MovieShowtimes[];
}

async function scrapeShowtimes(date: string, theaterSlug: string): Promise<ShowtimesResult> {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  const url = `https://www.amctheatres.com/movie-theatres/san-francisco/${theaterSlug}/showtimes?date=${date}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait out Queue-it if active
  if (page.url().includes('queue')) {
    console.log('Queue-it detected — waiting...');
    await page.waitForURL(`**/${theaterSlug}/showtimes**`, { timeout: 120_000 });
    console.log('Queue passed. URL:', page.url());
  }

  await sleep(4000);


  const movies: MovieShowtimes[] = await page.evaluate((slug: string) => {
    const result: Array<{
      title: string;
      slug: string;
      showtimes: Array<{ time: string; url: string; format: string; availability: string }>;
    }> = [];

    const movieH2s = Array.from(
      document.querySelectorAll(`h2[id$="-${slug}"]`)
    ) as HTMLElement[];

    for (const h2 of movieH2s) {
      const sectionId = h2.id;
      const movieSlug = sectionId.replace(`-${slug}`, '');

      // Walk up to the containing <section> — that's where the movie title link lives
      let section: Element | null = h2;
      while (section && section.tagName !== 'SECTION') {
        section = section.parentElement;
      }
      const container = (section ?? h2.parentElement) as HTMLElement;

      const titleLink = container.querySelector('a[href*="/movies/"]') as HTMLAnchorElement | null;
      const title = titleLink?.innerText?.trim() ?? movieSlug;

      // Collect all showtime links from the section
      const showtimes: Array<{ time: string; url: string; format: string; availability: string }> = [];
      const allLinks = Array.from(
        container.querySelectorAll('a[href*="/showtimes/"]') as NodeListOf<HTMLAnchorElement>
      );

      for (const a of allLinks) {
        const lines = (a.innerText ?? '').trim().split('\n');
        const time = lines[0]?.trim() ?? '';
        if (!time) continue;

        // Find the nearest H3 label by walking up the DOM tree
        let format = '';
        let el: Element | null = a.parentElement;
        while (el && el !== container) {
          const h3 = el.querySelector('h3');
          if (h3) { format = (h3 as HTMLElement).innerText?.trim().split('\n')[0]?.trim() ?? ''; break; }
          el = el.parentElement;
        }

        showtimes.push({ time, url: a.href, format, availability: lines[1]?.trim() ?? '' });
      }

      if (showtimes.length > 0) {
        result.push({ title, slug: movieSlug, showtimes });
      }
    }

    return result;
  }, theaterSlug);

  // Get theater display name from the theater selector dropdown
  const theaterName = await page.evaluate(() => {
    const sel = document.querySelector('select[name="theatre"]') as HTMLSelectElement | null;
    if (sel) {
      const opt = Array.from(sel.options).find(o => o.selected);
      return opt?.text?.trim() ?? sel.value;
    }
    return '';
  });

  await browser.close();

  return {
    date,
    theater: theaterName || theaterSlug,
    theaterSlug,
    fetchedAt: new Date().toISOString(),
    movies,
  };
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['date', 'theater'],
    default: { theater: 'amc-metreon-16' },
  });

  const rawDate = argv['date'];
  if (!rawDate) {
    console.error('Usage: npm run get-showtimes -- --date "YYYY-MM-DD" [--theater "theater-slug"]');
    console.error('Example: npm run get-showtimes -- --date "2026-05-11"');
    process.exit(1);
  }

  if (!fs.existsSync(SESSION_PATH)) {
    console.error('No session found. Run: npm run launch-brave  then  npm run save-session');
    process.exit(1);
  }

  const theaterSlug = argv['theater'];
  console.log(`Fetching showtimes for ${theaterSlug} on ${rawDate}...`);

  const result = await scrapeShowtimes(rawDate, theaterSlug);

  const outDir = path.join(process.cwd(), 'showtimes');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${theaterSlug}-${rawDate}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  console.log(`\nFound ${result.movies.length} movies:`);
  result.movies.forEach(m => {
    const times = m.showtimes.map(s => s.time + (s.availability ? ` (${s.availability})` : '')).join(', ');
    console.log(`  ${m.title.padEnd(45)} ${times}`);
  });
  console.log(`\nSaved to ${outFile}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
