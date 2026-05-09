import { Page } from 'patchright';
import * as fs from 'fs';
import * as path from 'path';
import { LoginError } from './utils/errors';
import { log } from './utils/logger';
import { humanType, humanClick, sleep } from './utils/human';
import { solveTurnstile } from './utils/capsolver';

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  if (!capsolverKey) throw new LoginError('CAPSOLVER_API_KEY is not set in .env');

  log('Navigating to AMC homepage');
  await page.goto('https://www.amctheatres.com', { waitUntil: 'load', timeout: 60_000 });
  await sleep(2000 + Math.random() * 2000);

  // Open the sign-in modal
  log('Opening sign-in modal');
  const signInNavBtn = page.locator('button:has-text("Sign In")').first();
  await signInNavBtn.waitFor({ timeout: 15_000 });
  await humanClick(page, signInNavBtn);

  // Wait for the form inputs to appear
  log('Waiting for sign-in form');
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  await sleep(500 + Math.random() * 500);

  log('Filling credentials');
  const emailField    = page.locator('input[name="email"]').first();
  const passwordField = page.locator('input[name="password"]').first();

  // Click first for focus, then use fill() so React's synthetic input events fire correctly
  await humanClick(page, emailField);
  await sleep(300 + Math.random() * 300);
  await emailField.fill(email);
  await sleep(400 + Math.random() * 400);

  await humanClick(page, passwordField);
  await sleep(300 + Math.random() * 300);
  await passwordField.fill(password);

  // Verify what React actually sees in the fields
  const enteredEmail = await emailField.inputValue();
  log(`Email field value confirmed: "${enteredEmail}"`);
  await sleep(600 + Math.random() * 800);

  // Wait for AMC's React component to call turnstile.render() so our interceptor
  // captures the callback. The modal renders asynchronously, give it time.
  log('Waiting for Turnstile render callback to be captured...');
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__amc_turnstile_cb'],
    { timeout: 15_000 }
  );

  // Solve Turnstile with CapSolver
  const token = await solveTurnstile(capsolverKey);

  // Feed the token into AMC's React callback — this sets the form token in React state
  await page.evaluate((t: string) => {
    const cb = (window as unknown as Record<string, unknown>)['__amc_turnstile_cb'] as ((token: string) => void) | undefined;
    if (cb) cb(t);
  }, token);

  log('Turnstile token delivered to AMC callback — submitting form');
  await sleep(400 + Math.random() * 300);
  await sleep(300 + Math.random() * 300);

  const submitBtn = page.locator(
    'button[type="submit"]:has-text("Sign in"), button[type="submit"]:has-text("Sign In")'
  ).last();
  await humanClick(page, submitBtn);

  // Wait for the modal to close and account nav to appear
  try {
    await page.waitForSelector(
      '[aria-label="Account"], [aria-label="My Account"], [data-testid*="account"], ' +
      'a[href*="account"], a[href*="profile"], a[href="/account"], [class*="AccountNav"]',
      { timeout: 20_000 }
    );
    log('Sign-in successful');
  } catch {
    const modalGone = await page.locator('input[name="email"]').isHidden({ timeout: 3000 }).catch(() => false);
    if (!modalGone) {
      await page.screenshot({ path: 'screenshots/login-failure.png' });
      throw new LoginError(
        'Login did not complete — check credentials or Turnstile token. See screenshots/login-failure.png'
      );
    }
    log('Sign-in modal closed — assuming success');
  }
}

export async function saveSession(page: Page): Promise<void> {
  const authDir = path.join(process.cwd(), 'playwright', '.auth');
  fs.mkdirSync(authDir, { recursive: true });
  await page.context().storageState({ path: path.join(authDir, 'session.json') });
  log('Session saved to playwright/.auth/session.json');
}
