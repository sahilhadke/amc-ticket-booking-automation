import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { chromium } from 'patchright';

import { findShowtime } from './movieFinder';
import { selectBestSeat } from './seatSelector';
import { completeCheckout } from './checkout';
import { BookingArgs } from './types';
import { log, error } from './utils/logger';
import { sleep } from './utils/human';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

async function warmUp(page: import('patchright').Page): Promise<void> {
  log('Warming up session...');
  await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
  await sleep(2000 + Math.random() * 1000);
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(
      200 + Math.random() * 900,
      150 + Math.random() * 500,
      { steps: 12 }
    );
    await sleep(250 + Math.random() * 350);
  }
  await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 300));
  await sleep(1000 + Math.random() * 500);
}

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
    error(`Missing required arguments: ${missing.map(k => `--${k}`).join(', ')}`);
    error('Usage: npm run book -- --movie "Movie Name" --date "YYYY-MM-DD" --time "7:30 PM" [--theater "Theater Name"]');
    process.exit(1);
  }

  if (!fs.existsSync(SESSION_PATH)) {
    error('No saved session found. Run "npm run launch-brave" then "npm run save-session" first.');
    process.exit(1);
  }

  log(`Booking: "${args.movie}" on ${args.date} at ${args.time}${args.theater ? ` @ ${args.theater}` : ''}`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });

  const page = await context.newPage();

  try {
    await warmUp(page);
    await findShowtime(page, args);
    await selectBestSeat(page);
    await completeCheckout(page);
    log('Done. Enjoy the movie!');
  } catch (err: unknown) {
    // Navigate home to release any in-progress checkout / A-List hold
    await page.goto('https://www.amctheatres.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    error(`Booking failed: ${msg}`);
    await page.screenshot({ path: `screenshots/error-${Date.now()}.png` }).catch(() => {});
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

main();
