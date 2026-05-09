import { Page } from 'patchright';
import { NoSeatsAvailable } from './utils/errors';
import { log } from './utils/logger';
import { sleep } from './utils/human';
import * as fs from 'fs';

const GRID_SELECTOR = '[aria-label="Seat Selection Map"], [role="grid"][aria-label*="Seat"]';

interface SeatInfo {
  index: number;
  cx: number;
  cy: number;
  row: number;
  col: number;
  available: boolean;
  name: string;
}

export async function selectBestSeat(page: Page): Promise<void> {
  log('Waiting for seat map');
  await page.waitForSelector(GRID_SELECTOR, { timeout: 20_000 });
  await sleep(1500);

  // Gather all seat labels with bounding boxes, availability, and seat name
  const rawSeats: Array<{ index: number; cx: number; cy: number; available: boolean; name: string }> =
    await page.evaluate((sel: string) => {
      const grid = document.querySelector(sel);
      if (!grid) return [];
      return Array.from(grid.querySelectorAll('label')).map((label, index) => {
        const r = label.getBoundingClientRect();
        const cls = label.className?.toString() ?? '';
        const input = label.querySelector('input');
        return {
          index,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          available: cls.includes('cursor-pointer') && !cls.includes('cursor-not-allowed'),
          name: input?.getAttribute('aria-label') ?? input?.name ?? `seat-${index}`,
        };
      });
    }, GRID_SELECTOR);

  if (rawSeats.length === 0) {
    fs.mkdirSync('screenshots', { recursive: true });
    await page.screenshot({ path: 'screenshots/seatmap-empty.png' }).catch(() => {});
    throw new NoSeatsAvailable('No seat labels found. See screenshots/seatmap-empty.png');
  }

  // Exclude wheelchair spaces, companion spots, and accessible-only seats
  const isAccessible = (name: string) =>
    /wheelchair|companion|accessible|ada|mobility/i.test(name);

  const avail = rawSeats.filter(s => s.available && !isAccessible(s.name));
  const totalAvail = rawSeats.filter(s => s.available).length;
  log(`Found ${rawSeats.length} seats (${totalAvail} available, ${avail.length} after excluding accessible)`);

  // Group into rows by rounding cy into 20px buckets
  const rowMap = new Map<number, typeof rawSeats>();
  for (const s of rawSeats) {
    const key = Math.round(s.cy / 20) * 20;
    if (!rowMap.has(key)) rowMap.set(key, []);
    rowMap.get(key)!.push(s);
  }
  const rows = [...rowMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, seats]) => seats.sort((a, b) => a.cx - b.cx));

  const totalRows = rows.length;
  const totalCols = Math.max(...rows.map(r => r.length));
  const centerCol = (totalCols - 1) / 2.0;
  const backRow = totalRows - 1;

  let bestSeat: SeatInfo | null = null;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const s = row[colIdx];
      if (!s.available) continue;
      const dist = Math.sqrt((backRow - rowIdx) ** 2 + (colIdx - centerCol) ** 2);
      if (!bestSeat || dist < bestSeat.col /* reuse col as dist temporarily */ ) {
        bestSeat = { ...s, row: rowIdx, col: colIdx, dist } as unknown as SeatInfo;
      }
    }
  }

  // redo properly
  let bestDist = Infinity;
  let best: SeatInfo | null = null;
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const s = row[colIdx];
      // Skip front 2 rows (closest to screen) and accessible spaces
      if (!s.available || isAccessible(s.name) || rowIdx < 2) continue;
      const dist = Math.sqrt((backRow - rowIdx) ** 2 + (colIdx - centerCol) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = { index: s.index, cx: s.cx, cy: s.cy, row: rowIdx, col: colIdx, available: true, name: s.name };
      }
    }
  }

  if (!best) throw new NoSeatsAvailable('No available seats found');

  log(`Best seat: "${best.name}" row=${best.row + 1}/${totalRows} col=${best.col + 1}/${totalCols} dist=${bestDist.toFixed(2)}`);
  log(`  Visual coordinates: (${Math.round(best.cx)}, ${Math.round(best.cy)})`);

  const continueBtn = page.locator('button:has-text("Continue")').last();

  // Scroll the label into view then click via JS — more reliable than raw coordinates
  const label = page.locator(`${GRID_SELECTOR} label`).nth(best.index);
  log(`Clicking seat "${best.name}" via scrollIntoView + click`);
  await sleep(400 + Math.random() * 200);
  await label.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(300);
  // Try Playwright click first (respects scroll position), fall back to JS
  const clicked = await label.click({ timeout: 3000 }).then(() => true).catch(() => false);
  if (!clicked) {
    await page.evaluate((idx: number) => {
      const labels = document.querySelectorAll('[aria-label="Seat Selection Map"] label, [role="grid"][aria-label*="Seat"] label');
      const el = labels[idx] as HTMLElement;
      if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
    }, best.index);
  }

  await sleep(1000);

  // If a wheelchair-space dialog appeared, dismiss it immediately
  const wheelchairDialog = page.locator('text=/wheelchair space/i').first();
  if (await wheelchairDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    log('Wheelchair dialog appeared — clicking No Thanks');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const noThanks = btns.find(b => /no thanks/i.test(b.innerText));
      if (noThanks) noThanks.click();
    });
    throw new NoSeatsAvailable('Selected seat was a wheelchair space — re-running will pick the next available seat. Please try again.');
  }

  await sleep(1500);

  fs.mkdirSync('screenshots', { recursive: true });
  await page.screenshot({ path: 'screenshots/after-seat-click.png' }).catch(() => {});
  log(`Seat "${best.name}" clicked — proceeding to checkout`);
}
