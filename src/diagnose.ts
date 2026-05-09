import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'patchright';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: null,
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  await page.goto('https://www.amctheatres.com/my-amc/tickets', { waitUntil: 'domcontentloaded' });
  if (page.url().includes('queue')) {
    console.log('Queue — waiting...');
    await page.waitForURL('**/my-amc/tickets**', { timeout: 180_000 });
  }
  await sleep(4000);

  fs.mkdirSync('screenshots', { recursive: true });
  await page.screenshot({ path: 'screenshots/tickets-page.png', fullPage: true });
  console.log('URL:', page.url());

  const dom = await page.evaluate(() => {
    const bodyText = document.body.innerText?.substring(0, 4000) ?? '';
    // Look for QR / barcode elements
    const qrEls = Array.from(document.querySelectorAll(
      'canvas, img[alt*="QR"], img[alt*="barcode"], img[alt*="ticket"], [class*="qr"], [class*="QR"], [class*="barcode"], [class*="Barcode"]'
    )).map(el => ({
      tag: el.tagName,
      cls: el.className?.toString().substring(0, 60),
      alt: (el as HTMLImageElement).alt ?? '',
      src: (el as HTMLImageElement).src?.substring(0, 80) ?? '',
    }));

    // Links to individual ticket pages
    const ticketLinks = Array.from(document.querySelectorAll('a[href*="/ticket"], a[href*="/order"], a[href*="/confirmation"]'))
      .map(a => ({ href: (a as HTMLAnchorElement).href, text: (a as HTMLAnchorElement).innerText?.trim().substring(0, 60) }));

    return { bodyText, qrEls, ticketLinks };
  });

  console.log('\n=== BODY TEXT (first 4000) ===\n', dom.bodyText);
  console.log('\n=== QR/BARCODE ELEMENTS ===');
  dom.qrEls.forEach(e => console.log(JSON.stringify(e)));
  console.log('\n=== TICKET LINKS ===');
  dom.ticketLinks.forEach(l => console.log(JSON.stringify(l)));

  await browser.close();
}
main().catch(console.error);
