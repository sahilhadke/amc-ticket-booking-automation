import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { chromium } from 'patchright';

import { findShowtime } from './movieFinder';
import { selectBestSeat } from './seatSelector';
import { completeCheckout } from './checkout';
import { crawlAndMergeHistory } from './crawlHistory';
import { isAlreadyWatched } from './historyManager';
import { BookingArgs } from './types';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: ['movie', 'date', 'time', 'theater'],
  });

  const args: BookingArgs = {
    movie:   argv['movie'],
    date:    argv['date'],
    time:    argv['time'],
    theater: argv['theater'],
  };

  const missing = (['movie', 'date', 'time'] as const).filter(k => !args[k]);
  if (missing.length > 0) {
    console.error(`Missing: ${missing.map(k => `--${k}`).join(', ')}`);
    console.error('Usage: npm run book -- --movie "Name" --date "YYYY-MM-DD" --time "H:MM PM" [--theater "Theater"]');
    process.exit(1);
  }

  if (!fs.existsSync(SESSION_PATH)) {
    console.error('No session found. Run: npm run launch-brave  then  npm run save-session');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, slowMo: 50, args: ['--start-maximized'] });
  const context = await browser.newContext({
    viewport: null,
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  try {
    await crawlAndMergeHistory(page);

    const watched = isAlreadyWatched(args.movie);
    if (watched) {
      throw new Error(
        `Already watched "${watched.title}" on ${watched.date}. ` +
        `Pick a different movie or remove the entry from watched-history.json to override.`
      );
    }

    await findShowtime(page, args);
    const seat = await selectBestSeat(page);
    const result = await completeCheckout(page);
    await browser.close();

    console.log(
      `\n✓  BOOKED` +
      `\n   Movie    : ${args.movie}` +
      `\n   Date     : ${args.date}  ${args.time}` +
      `\n   Theater  : ${result.theater || args.theater || ''}` +
      `\n   Seat     : ${seat}` +
      `\n   Total    : ${result.totalPrice}` +
      `\n   Confirm# : ${result.confirmationNumber}\n`
    );
  } catch (err: unknown) {
    await page.goto('https://www.amctheatres.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await browser.close();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗  FAILED: ${msg}\n`);
    process.exit(1);
  }
}

main();
