import { Page } from 'patchright';
import { BookingFailed } from './utils/errors';
import { log } from './utils/logger';
import { humanClick, sleep } from './utils/human';
import * as fs from 'fs';

export interface BookingResult {
  confirmationNumber: string;
  totalPrice: string;
  seatInfo: string;    // e.g. "Seats D3"
  theater: string;
}

export async function completeCheckout(page: Page): Promise<BookingResult> {
  fs.mkdirSync('screenshots', { recursive: true });

  // ── Step 1: Continue from seat selection page ──────────────
  log('Step 1: Continue from seat page');
  await jsClickText(page, 'Continue');
  await sleep(2000 + Math.random() * 300);
  await page.screenshot({ path: 'screenshots/checkout-step1.png' }).catch(() => {});

  // ── Step 1b: Ticket-type selection page (Adult/Child/Senior) ──
  // Some showtimes show this before the A-List page
  const ticketTypeBody = await page.innerText('body').catch(() => '');
  if (/remaining ticket|select.*ticket|adult.*child|child.*senior/i.test(ticketTypeBody)) {
    log('Step 1b: Ticket type page — selecting 1 Adult');
    await page.evaluate(() => {
      // Click the first + button (Adult is always first)
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const plus = btns.find(b => b.innerText?.trim() === '+');
      if (plus) plus.click();
    });
    await sleep(800);
    await jsClickText(page, 'Continue');
    await sleep(2000 + Math.random() * 300);
  }

  // ── Step 2: AMC Stubs A-List checkbox ─────────────────────
  const stubsEl = page.locator('label, div, p').filter({
    hasText: /make this one of my amc stubs|a-list|stubs a-list/i,
  }).first();

  if (await stubsEl.isVisible({ timeout: 5_000 }).catch(() => false)) {
    log('Step 2: Found A-List Stubs — selecting');
    const cb = stubsEl.locator('input[type="checkbox"], input[type="radio"]').first();
    const cbExists = await cb.count().then(n => n > 0).catch(() => false);
    if (cbExists) {
      const checked = await cb.isChecked().catch(() => false);
      if (!checked) await humanClick(page, cb);
    } else {
      await humanClick(page, stubsEl);
    }
    await sleep(600 + Math.random() * 300);

    log('Step 3: Continue after stubs');
    await jsClickText(page, 'Continue');
    await sleep(2000 + Math.random() * 300);
  } else {
    log('WARN: A-List stubs option not found — proceeding');
  }

  await page.screenshot({ path: 'screenshots/checkout-step2.png' }).catch(() => {});

  // ── Step 4: Skip food/combo add-ons, click Continue ────────
  log('Step 4: Continue past food/combos');
  await jsClickText(page, 'Continue');
  await sleep(2000 + Math.random() * 300);
  await page.screenshot({ path: 'screenshots/checkout-step3.png' }).catch(() => {});

  // ── Step 5: Final Continue / Place Order ───────────────────
  const bodyText = await page.innerText('body').catch(() => '');
  if (/\$0\.00/.test(bodyText)) log('Confirmed: order total is $0.00');

  log('Step 5: Continue from food/order summary');
  await jsClickText(page, 'Continue');
  await sleep(2000);

  // ── Step 6: Confirm Purchase page ─────────────────────────────
  const confirmText = await page.innerText('body').catch(() => '');

  // Safety: abort if A-List can't be applied (would charge real money)
  if (/unable to process your a-list|cannot process.*a-list/i.test(confirmText)) {
    await cancelPendingCheckout(page);
    throw new BookingFailed(
      'A-List reservation blocked — too many recent bookings. Wait ~15 minutes and try again.'
    );
  }

  if (/confirm purchase|confirm order/i.test(confirmText)) {
    log('Step 6: On Confirm Purchase page');

    // Safety: if total is non-zero, do not proceed (would charge real money)
    const totalMatch = confirmText.match(/TOTAL\s+\$?([\d.]+)/i);
    const totalAmt = parseFloat(totalMatch?.[1] ?? '0');
    if (totalAmt > 0.5) {
      await cancelPendingCheckout(page);
      throw new BookingFailed(`Order total is $${totalAmt.toFixed(2)} — A-List discount not applied. Aborting to avoid charge.`);
    }

    // Accept any terms/agreements that are required
    await page.evaluate(() => {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
      checkboxes.forEach(cb => { if (!cb.checked) cb.click(); });
    });
    await sleep(500);

    log('  Clicking Purchase');
    await jsClickText(page, 'Purchase', 'Place Order', 'Complete Purchase', 'Submit Order');
  } else {
    log('Step 6: Clicking final Continue/Purchase');
    await jsClickText(page, 'Continue', 'Purchase', 'Place Order');
  }

  // Wait for AMC to process the purchase and page to fully render
  await sleep(8000);
  await page.screenshot({ path: 'screenshots/checkout-confirmed.png' }).catch(() => {});

  // ── Step 7: Check outcome ──────────────────────────────────
  const finalText = await page.innerText('body').catch(() => '');

  if (/no longer available|purchased by another|reached capacity/i.test(finalText)) {
    // Cancel the in-progress checkout so it doesn't block future bookings
    await cancelPendingCheckout(page);
    throw new BookingFailed('Seat was taken at the last moment — run again to get a fresh seat.');
  }

  const confirmed = isConfirmationText(finalText) || isConfirmationUrl(page.url());
  if (!confirmed) {
    await cancelPendingCheckout(page);
    throw new BookingFailed('Order may not have completed — check screenshots/checkout-confirmed.png');
  }

  // Extract details from the confirmation page
  const confirmText2 = await page.innerText('body').catch(() => '');
  const confirmNumMatch = confirmText2.match(/TICKET\s+CONFIRMATION\s+#[:\s]+(\d+)/i);
  const priceMatch = confirmText2.match(/TOTAL\s+\$?([\d.]+)/i);
  const seatMatch = confirmText2.match(/Seats?\s+([A-Z]\d+)/i);
  const theaterMatch = confirmText2.match(/AMC\s+[\w\s]+\d+/i);

  const result: BookingResult = {
    confirmationNumber: confirmNumMatch?.[1] ?? 'unknown',
    totalPrice: `$${priceMatch?.[1] ?? '0.00'}`,
    seatInfo: seatMatch?.[1] ?? '',
    theater: theaterMatch?.[0]?.trim() ?? '',
  };

  log(`Confirmation #: ${result.confirmationNumber} | Total: ${result.totalPrice} | ${result.seatInfo}`);
  log('Booking confirmed! See screenshots/checkout-confirmed.png');
  return result;
}

// Navigate away so AMC releases the in-progress checkout / A-List hold
async function cancelPendingCheckout(page: Page): Promise<void> {
  try {
    log('Cancelling in-progress checkout to release seat hold...');
    // Dismiss any error dialog first
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const dismiss = btns.find(b => /no thanks|ok|close|dismiss|cancel/i.test(b.innerText));
      if (dismiss) dismiss.click();
    });
    await sleep(500);
    // Navigate away — this releases the session checkout state
    await page.goto('https://www.amctheatres.com/showtimes', { waitUntil: 'domcontentloaded' });
    log('Checkout cancelled — session cleared.');
  } catch {
    // Best effort
  }
}

function isConfirmationUrl(url: string): boolean {
  return /confirmation|success|receipt|order-complete/i.test(url);
}

function isConfirmationText(text: string): boolean {
  // "Confirm Purchase" is the REVIEW page — not a success state, skip it
  // "Food & Drinks" / Express Pick-Up with countdown = post-purchase success
  if (/food.{0,10}drinks|express pick.up/i.test(text)
      && /\d+:\d+ left/i.test(text)
      && !/no longer available|purchased by another|must complete/i.test(text)) return true;
  // Standard confirmation text
  return /your order is confirmed|booking confirmed|see you at the movies|order confirmed|enjoy the movie|reservation confirmed|order placed/i.test(text);
}

async function jsClickText(page: Page, ...texts: string[]): Promise<boolean> {
  for (const text of texts) {
    const clicked = await page.evaluate((t: string) => {
      const all = Array.from(document.querySelectorAll('button, a')) as HTMLElement[];
      const match = [...all].reverse().find(el =>
        (el.innerText ?? el.textContent ?? '').trim().toLowerCase().includes(t.toLowerCase())
      );
      if (match) { match.click(); return true; }
      return false;
    }, text);

    if (clicked) {
      log(`  JS-clicked "${text}"`);
      await page.waitForLoadState('domcontentloaded');
      await sleep(500);
      return true;
    }
  }
  return false;
}
