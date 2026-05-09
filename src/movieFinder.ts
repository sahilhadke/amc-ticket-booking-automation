import { Page } from 'patchright';
import { BookingArgs } from './types';
import { MovieNotFound, ShowtimeNotFound } from './utils/errors';
import { log } from './utils/logger';
import { sleep } from './utils/human';

export async function findShowtime(page: Page, args: BookingArgs): Promise<void> {
  // Step 1: Navigate to /showtimes — AMC redirects to the session-default theater URL
  // e.g. https://www.amctheatres.com/movie-theatres/san-francisco/amc-metreon-16/showtimes
  log('Navigating to AMC showtimes');
  await page.goto('https://www.amctheatres.com/showtimes', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // Step 2: Append the date to stay on the correct theater URL
  const todayISO = new Date().toLocaleDateString('en-CA');
  const baseUrl = page.url().split('?')[0]; // strip any existing query
  const dateParam = args.date === todayISO ? '' : `?date=${args.date}`;
  const targetUrl = `${baseUrl}${dateParam}`;

  if (targetUrl !== page.url()) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2000);
  }

  log(`Showtimes URL: ${page.url()}`);

  // Step 3: Find movie section and click the correct showtime via JS
  // Section IDs follow the pattern: {movie-slug}-{theater-slug}
  // e.g. "project-hail-mary-76779-amc-metreon-16"
  log(`Looking for "${args.movie}" at ${args.time}`);
  const normalized = normalizeTime(args.time);

  const result = await page.evaluate(
    ({ movieName, time }: { movieName: string; time: string }) => {
      // Build keywords from movie name (filter short words)
      const keywords = movieName.toLowerCase().split(/\s+/).filter(w => w.length > 3);

      // Find all showtime sections (each has an id containing the theater slug)
      const allSections = Array.from(document.querySelectorAll('[id]')) as HTMLElement[];

      // Find the section whose id contains the movie name keywords
      let movieSection: HTMLElement | null = null;
      for (const sec of allSections) {
        const idLower = sec.id.toLowerCase();
        if (keywords.every(kw => idLower.includes(kw))) {
          movieSection = sec;
          break;
        }
      }

      // Search for showtime links: within the movie section first, then full page
      const searchRoots: (Element | Document)[] = movieSection
        ? [movieSection.parentElement ?? document, document]
        : [document];

      for (const root of searchRoots) {
        const links = Array.from(root.querySelectorAll('a[href*="/showtimes/"]')) as HTMLAnchorElement[];
        const match = links.find(a => {
          const firstLine = (a.innerText ?? '').trim().toLowerCase().split('\n')[0].trim();
          return firstLine === time;
        });
        if (match) {
          match.click();
          return { clicked: match.innerText.trim(), sectionId: movieSection?.id ?? 'none' };
        }
      }

      // No match — return available times for error message
      const allTimes = Array.from(document.querySelectorAll('a[href*="/showtimes/"]'))
        .map(a => (a as HTMLAnchorElement).innerText.trim().split('\n')[0].trim())
        .filter(t => t.length > 0);

      // Also list movies available
      const movieHeadings = Array.from(document.querySelectorAll('a[href*="/movies/"]'))
        .map(a => (a as HTMLAnchorElement).innerText.trim().substring(0, 50))
        .filter(t => t.length > 0).slice(0, 15);

      return { clicked: null, availableTimes: allTimes.join(', '), movies: movieHeadings.join(', ') };
    },
    { movieName: args.movie, time: normalized }
  );

  if (!result.clicked) {
    await page.screenshot({ path: 'screenshots/showtime-not-found.png' }).catch(() => {});
    const msg = (result as { availableTimes?: string; movies?: string }).availableTimes
      ? `Showtime "${args.time}" not found.\nAvailable times: ${(result as { availableTimes: string }).availableTimes}\nMovies on page: ${(result as { movies: string }).movies}`
      : `"${args.movie}" not found on the showtimes page.`;
    throw result.clicked === null && !(result as { availableTimes?: string }).availableTimes
      ? new MovieNotFound(msg)
      : new ShowtimeNotFound(msg);
  }

  log(`Clicked showtime: ${result.clicked.split('\n')[0].trim()} (section: ${result.sectionId})`);
  await page.waitForLoadState('domcontentloaded');
  await sleep(2000);

  // Step 4: Verify we're at the correct theater
  if (args.theater) {
    const pageText = await page.innerText('body').catch(() => '');
    const theaterKw = args.theater.replace(/^amc\s*/i, '').toLowerCase();
    if (!pageText.toLowerCase().includes(theaterKw)) {
      log(`WARN: Wrong theater (expected "${args.theater}") — going back`);
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      throw new ShowtimeNotFound(
        `"${args.time}" for "${args.movie}" is not at "${args.theater}" — try a different time.`
      );
    }
    log(`Theater verified: "${args.theater}"`);
  }
}

function normalizeTime(time: string): string {
  let t = time.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d+(am|pm)$/.test(t)) t = t.replace(/(am|pm)/, ':00$1');
  return t;
}
