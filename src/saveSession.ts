import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'patchright';
import { log } from './utils/logger';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

async function main(): Promise<void> {
  log('Connecting to Brave on port 9222...');
  log('If you have not already, run: npm run launch-brave');

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:9222');
  } catch {
    console.error('\nCould not connect. Make sure to run "npm run launch-brave" first,');
    console.error('and that no other Brave window is already open.\n');
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

  const page = await context.newPage();
  await page.goto('https://www.amctheatres.com', { waitUntil: 'domcontentloaded' });

  log('');
  log('Log in to your AMC account in the browser window.');
  log('Press ENTER here when you are fully signed in...');

  await new Promise<void>(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });

  log('Saving session...');
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  log(`Session saved to ${SESSION_PATH}`);
  log('Run "npm run book -- ..." to book tickets.');
  // Don't close the browser — just exit; Brave stays open for the user.
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
