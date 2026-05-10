import * as dotenv from 'dotenv';
dotenv.config();
import * as path from 'path';
import { chromium } from 'patchright';
import { gotoWithQueue, sleep } from './utils/human';

const SESSION_PATH = path.join(process.cwd(), 'playwright', '.auth', 'session.json');

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({ viewport: null, storageState: SESSION_PATH });
  const page = await context.newPage();

  const captured: Array<{ url: string; type: string }> = [];

  // Intercept all requests and log JSON/API ones
  page.on('request', req => {
    const url = req.url();
    const type = req.resourceType();
    if (type === 'fetch' || type === 'xhr' || url.includes('/api/') || url.includes('_next/data') || url.includes('.json')) {
      captured.push({ url, type });
    }
  });

  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] ?? '';
    if (ct.includes('application/json') && (url.includes('amctheatres') || url.includes('_next'))) {
      try {
        const body = await res.text();
        console.log('\n=== JSON RESPONSE ===');
        console.log('URL:', url);
        console.log('Body (first 500):', body.substring(0, 500));
      } catch { /* ignore */ }
    }
  });

  await gotoWithQueue(page, 'https://www.amctheatres.com/movie-theatres/san-francisco/amc-metreon-16/showtimes?date=2026-05-11');
  await sleep(5000);

  console.log('\n=== ALL API/FETCH REQUESTS ===');
  captured.forEach(r => console.log(`[${r.type}] ${r.url}`));

  await browser.close();
}
main().catch(console.error);
