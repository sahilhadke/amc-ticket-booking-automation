import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'patchright';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const context = await browser.newContext({
    viewport: null,
    storageState: SESSION_PATH,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();

  await page.goto('https://www.amctheatres.com/showtimes', { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await page.locator('select[name="theatre"]').selectOption('amc-metreon-16');
  await sleep(1500);
  await page.locator('select[name="date"]').selectOption('2026-05-09');
  await sleep(2500);
  await page.locator('select[name="movie"]').selectOption('crazy-rich-asians-83505');
  await sleep(1500);
  await page.locator('a[href*="/showtimes/"]').filter({ hasText: /4:00pm/i }).first().click();
  await page.waitForLoadState('domcontentloaded');
  await sleep(8000);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log('Viewport:', vp);

  // 1 — all <g> elements inside any SVG
  const gElements = await page.evaluate(() =>
    Array.from(document.querySelectorAll('svg g')).slice(0, 60).map(g => ({
      id: g.id,
      cls: g.getAttribute('class')?.substring(0, 60),
      tabIndex: (g as HTMLElement).tabIndex,
      role: g.getAttribute('role'),
      ariaLabel: g.getAttribute('aria-label')?.substring(0, 60),
      dataKeys: Array.from(g.attributes)
        .map(a => a.name)
        .filter(n => n.startsWith('data-'))
        .join(','),
      transform: g.getAttribute('transform')?.substring(0, 40),
      childCount: g.children.length,
      // check React fiber key
      hasReactFiber: !!Object.keys(g).find(k => k.startsWith('__reactFiber')),
    }))
  );
  console.log(`\n=== SVG <g> ELEMENTS (${gElements.length}) ===`);
  gElements.forEach(g => console.log(JSON.stringify(g)));

  // 2 — elements at various points inside the seat map visual area
  // The modal is centered — try a grid of points
  const pointResults = await page.evaluate(({ w, h }: { w: number; h: number }) => {
    const results: Array<{ x: number; y: number; stack: Array<{ tag: string; id: string; cls: string; ariaLabel: string | null; role: string | null; tabIndex: number }> }> = [];
    // Sample points across the lower middle of the screen (where seats are)
    const xs = [w * 0.35, w * 0.45, w * 0.5, w * 0.55, w * 0.65];
    const ys = [h * 0.4, h * 0.5, h * 0.55, h * 0.6];
    for (const x of xs) {
      for (const y of ys) {
        const els = document.elementsFromPoint(x, y).slice(0, 6).map(el => ({
          tag: el.tagName,
          id: el.id?.substring(0, 30),
          cls: el.className?.toString().substring(0, 50),
          ariaLabel: el.getAttribute('aria-label')?.substring(0, 40) ?? null,
          role: el.getAttribute('role') ?? null,
          tabIndex: (el as HTMLElement).tabIndex ?? -1,
        }));
        results.push({ x: Math.round(x), y: Math.round(y), stack: els });
      }
    }
    return results;
  }, vp);

  console.log('\n=== ELEMENTS AT SEAT-MAP COORDINATES ===');
  pointResults.forEach(r => {
    const interesting = r.stack.filter(el =>
      el.tag !== 'HTML' && el.tag !== 'BODY' && el.tag !== 'DIV' &&
      !el.cls.includes('osano')
    );
    if (interesting.length > 0) {
      console.log(`(${r.x},${r.y}):`, JSON.stringify(interesting));
    }
  });

  // 3 — all elements with tabIndex >= 0 (focusable = interactive)
  const focusable = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .filter(el => (el as HTMLElement).tabIndex >= 0)
      .map(el => ({
        tag: el.tagName,
        id: el.id?.substring(0, 30),
        cls: el.className?.toString().substring(0, 60),
        ariaLabel: el.getAttribute('aria-label')?.substring(0, 50),
        role: el.getAttribute('role'),
        tabIndex: (el as HTMLElement).tabIndex,
      }))
      .slice(0, 30)
  );
  console.log(`\n=== FOCUSABLE ELEMENTS (tabIndex>=0) ===`);
  focusable.forEach(f => console.log(JSON.stringify(f)));

  // 4 — try to find React root & component tree around seat elements
  const reactInfo = await page.evaluate(() => {
    // Find element with react fiber
    let reactRoot: Element | null = null;
    for (const el of Array.from(document.querySelectorAll('[id^="seat"], [class*="seat"], g, rect, circle'))) {
      const keys = Object.keys(el);
      if (keys.some(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))) {
        reactRoot = el;
        break;
      }
    }
    if (!reactRoot) return { found: false };
    const fiberKey = Object.keys(reactRoot).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!fiberKey) return { found: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fiber = (reactRoot as any)[fiberKey];
    return {
      found: true,
      tag: reactRoot.tagName,
      cls: reactRoot.className?.toString().substring(0, 60),
      fiberType: typeof fiber?.type === 'string' ? fiber.type : (fiber?.type?.displayName ?? fiber?.type?.name ?? 'component'),
      props: fiber?.pendingProps ? Object.keys(fiber.pendingProps).join(',') : '',
    };
  });
  console.log('\n=== REACT FIBER INFO ===');
  console.log(JSON.stringify(reactInfo, null, 2));

  await browser.close();
}

main().catch(console.error);
