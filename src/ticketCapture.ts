import { Page } from 'patchright';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './utils/logger';
import { gotoWithQueue, sleep } from './utils/human';

export interface CaptureResult {
  ticketUrl: string;
  screenshotPath: string;   // relative path to full ticket page screenshot
  qrCropPath: string;       // relative path to cropped QR/barcode (or full page if not found)
  confirmationNumber: string;
  theater: string;
  seat: string;
}

export async function captureTicket(
  page: Page,
  movieTitle: string,
  outputDir: string,
  filenameBase: string,
  bookingTime?: string,  // e.g. "6:45 PM" — used to disambiguate multiple tickets for same movie
): Promise<CaptureResult> {
  fs.mkdirSync(outputDir, { recursive: true });

  log('Navigating to My AMC Tickets...');
  await gotoWithQueue(page, 'https://www.amctheatres.com/my-amc/tickets', 120_000);
  await sleep(3000);

  // Find the View Ticket URL — match by title AND time to avoid duplicates
  const normalizedTime = bookingTime
    ? bookingTime.trim().toLowerCase().replace(/\s+/g, '')
    : '';

  const ticketUrl: string | null = await page.evaluate(
    ({ title, time }: { title: string; time: string }) => {
      const links = Array.from(document.querySelectorAll('a[href*="/my-amc/tickets/"]')) as HTMLAnchorElement[];
      const scored: Array<{ href: string; score: number }> = [];

      for (const link of links) {
        let el: Element | null = link;
        let cardText = '';
        for (let i = 0; i < 6; i++) {
          el = el?.parentElement ?? null;
          if (!el) break;
          cardText = (el as HTMLElement).innerText?.toLowerCase() ?? '';
          if (cardText.includes(title.toLowerCase())) break;
        }
        if (!cardText.includes(title.toLowerCase())) continue;

        // Score: +2 for title match, +1 for time match
        let score = 2;
        if (time && cardText.replace(/\s+/g, '').includes(time)) score += 1;
        scored.push({ href: link.href, score });
      }

      if (scored.length === 0) {
        // Last resort: first View Ticket link
        return links.find(a => /view ticket/i.test(a.innerText ?? ''))?.href ?? null;
      }
      // Pick highest score (time match preferred)
      scored.sort((a, b) => b.score - a.score);
      return scored[0].href;
    },
    { title: movieTitle, time: normalizedTime }
  );

  if (!ticketUrl) {
    log('WARN: Could not find View Ticket link — skipping QR capture');
    return { ticketUrl: '', screenshotPath: '', qrCropPath: '', confirmationNumber: '', theater: '', seat: '' };
  }

  log(`Opening ticket: ${ticketUrl}`);
  await gotoWithQueue(page, ticketUrl, 120_000);
  await sleep(4000);

  // Full-page screenshot
  const screenshotPath = path.join(outputDir, `${filenameBase}-ticket.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  log(`Full ticket screenshot: ${screenshotPath}`);

  // Try to find and crop the QR code / barcode element
  const qrBox = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(
      'canvas, img[src*="qr" i], img[src*="barcode" i], img[alt*="QR" i], img[alt*="barcode" i], ' +
      '[class*="qr" i], [class*="barcode" i], [class*="ticket-code" i], [class*="TicketCode" i], ' +
      'img[src*="aztec" i], img[src*="datamatrix" i]'
    ));
    // Also look for any large standalone image in the ticket area
    const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
      const r = img.getBoundingClientRect();
      return r.width > 80 && r.width < 400 && r.height > 80 && r.height < 400 &&
        !img.src.includes('poster') && !img.src.includes('logo') && !img.src.includes('avatar');
    });
    const el: Element | null = candidates[0] ?? imgs[0] ?? null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  let qrCropPath = screenshotPath; // default to full page if no QR found
  if (qrBox && qrBox.width > 0 && qrBox.height > 0) {
    const padding = 20;
    qrCropPath = path.join(outputDir, `${filenameBase}-qr.png`);
    await page.screenshot({
      path: qrCropPath,
      clip: {
        x: Math.max(0, qrBox.x - padding),
        y: Math.max(0, qrBox.y - padding),
        width: qrBox.width + padding * 2,
        height: qrBox.height + padding * 2,
      },
    });
    log(`QR code cropped: ${qrCropPath}`);
  } else {
    log('No QR element found — using full ticket screenshot as QR path');
  }

  // Extract confirmation number, theater, seat from ticket page body text
  const ticketBody = await page.innerText('body').catch(() => '');
  const confirmMatch = ticketBody.match(/TICKET[S]?\s+CONFIRMATION\s*#[:\s]*(\d+)/i);
  const theaterMatch = ticketBody.match(/AMC\s+[\w\s]+\d+/i);
  const seatMatch = ticketBody.match(/\b([A-Z]\d{1,2})\b/);

  const confirmationNumber = confirmMatch?.[1] ?? '';
  const theater = theaterMatch?.[0]?.trim() ?? '';
  const seat = seatMatch?.[1] ?? '';

  // Use relative paths
  const relScreenshot = path.relative(process.cwd(), screenshotPath);
  const relQr = path.relative(process.cwd(), qrCropPath);

  return { ticketUrl, screenshotPath: relScreenshot, qrCropPath: relQr, confirmationNumber, theater, seat };
}
