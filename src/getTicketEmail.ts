/**
 * Fetches the most recent AMC confirmation email and saves the QR code as a PNG.
 *
 *   npm run get-ticket-email
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { google } from 'googleapis';
import { chromium, BrowserContext, Browser } from 'patchright';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const REDIRECT_URI  = 'http://localhost:3000';

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Missing credentials. Run  npm run auth-email  first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractHtml(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBody(payload.body.data);
  if (payload.parts) {
    const html = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (html?.body?.data) return decodeBody(html.body.data);
    for (const part of payload.parts) {
      const h = extractHtml(part);
      if (h) return h;
    }
  }
  return '';
}

function extractQrCodeUrl(html: string): string | null {
  const match = html.match(/<img[^>]+title=["']QR Code["'][^>]*>/i)
             ?? html.match(/<img[^>]+src=["']([^"']+)["'][^>]*title=["']QR Code["']/i)
             ?? html.match(/<img[^>]+alt=["']QR Code["'][^>]*>/i);
  if (!match) return null;
  const srcMatch = match[0].match(/src=["']([^"']+)["']/i);
  return srcMatch?.[1] ?? null;
}

function findAttachmentByContentId(payload: any, cid: string): { attachmentId: string; messageId?: string } | null {
  if (!payload) return null;
  const headers: any[] = payload.headers ?? [];
  const cidHeader = headers.find(h => h.name?.toLowerCase() === 'content-id');
  if (cidHeader) {
    const headerVal = String(cidHeader.value).replace(/^<|>$/g, '');
    if (headerVal === cid && payload.body?.attachmentId) {
      return { attachmentId: payload.body.attachmentId };
    }
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findAttachmentByContentId(part, cid);
      if (found) return found;
    }
  }
  return null;
}

interface TicketDetails {
  seat: string;
  time: string;
  date: string;
  theatre: string;
  qrCode: string;
}

function extractTicketDetails(html: string, qrPath: string): TicketDetails {
  const auditoriumMatch = html.match(/Auditorium:\s*<\/span>\s*([^\s<]+)/i);
  const seatMatch = html.match(/Reserved Seats:\s*<\/span>\s*([A-Z]+\d+(?:\s*,\s*[A-Z]+\d+)*)/i);
  const dateTimeMatch = html.match(/(\d{1,2}:\d{2}\s*[AP]M)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);

  return {
    seat: seatMatch?.[1]?.trim() ?? '',
    time: dateTimeMatch?.[1]?.trim() ?? '',
    date: dateTimeMatch?.[2]?.trim() ?? '',
    theatre: auditoriumMatch?.[1]?.trim() ?? '',
    qrCode: qrPath,
  };
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
  'Referer': 'https://www.amctheatres.com/',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'cross-site',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

function fetchBuffer(url: string, redirects = 5): Promise<{ buffer: Buffer; contentType: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: BROWSER_HEADERS }, res => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        return fetchBuffer(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: String(res.headers['content-type'] ?? ''),
        statusCode: res.statusCode ?? 0,
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

function isPng(buf: Buffer): boolean {
  return buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
    && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
}

function isGif(buf: Buffer): boolean {
  return buf.length >= 6 && buf.slice(0, 6).toString('ascii').startsWith('GIF8');
}

function imageExtension(buf: Buffer, contentType: string): string | null {
  if (isPng(buf)) return 'png';
  if (isJpeg(buf)) return 'jpg';
  if (isGif(buf)) return 'gif';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  return null;
}

let cachedBrowser: Browser | null = null;
let cachedContext: BrowserContext | null = null;
let cookiesWarmedUp = false;

async function getBrowserContext(): Promise<BrowserContext> {
  if (cachedContext) return cachedContext;
  cachedBrowser = await chromium.launch({ headless: false, args: ['--start-minimized'] });
  const sessionPath = path.join(process.cwd(), 'playwright', '.auth', 'session.json');
  const hasSession = fs.existsSync(sessionPath);
  cachedContext = await cachedBrowser.newContext({
    storageState: hasSession ? sessionPath : undefined,
    locale: 'en-US',
  });
  return cachedContext;
}

async function warmUpCloudflare(): Promise<void> {
  if (cookiesWarmedUp) return;
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.amctheatres.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    cookiesWarmedUp = true;
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser(): Promise<void> {
  if (cachedContext) {
    await cachedContext.close().catch(() => {});
    cachedContext = null;
  }
  if (cachedBrowser) {
    await cachedBrowser.close().catch(() => {});
    cachedBrowser = null;
  }
}

async function fetchBufferViaBrowser(url: string): Promise<{ buffer: Buffer; contentType: string; statusCode: number }> {
  await warmUpCloudflare();
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    if (!response) return { buffer: Buffer.alloc(0), contentType: '', statusCode: 0 };
    const buffer = await response.body();
    return {
      buffer,
      contentType: response.headers()['content-type'] ?? '',
      statusCode: response.status(),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const query = 'from:amctheatres.com newer_than:60m';

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 5,
  });

  const messages = listRes.data.messages;
  if (!messages || messages.length === 0) {
    console.log('No AMC emails found in the last 5 minutes.');
    process.exit(0);
  }

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id!,
      format: 'full',
    });

    const html = extractHtml(full.data.payload);
    const qrUrl = extractQrCodeUrl(html);

    if (!qrUrl) continue;

    const subject = full.data.payload?.headers?.find(h => h.name === 'Subject')?.value ?? '';
    const orderMatch = subject.match(/Order Number\s+(\d+)/i);
    const orderNum = orderMatch?.[1] ?? msg.id;

    fs.mkdirSync('tickets', { recursive: true });

    let imageBuffer: Buffer;
    let contentType = '';

    if (qrUrl.startsWith('data:')) {
      const mimeMatch = qrUrl.match(/^data:(image\/[\w+.-]+);base64,/);
      contentType = mimeMatch?.[1] ?? '';
      const base64 = qrUrl.replace(/^data:image\/[\w+.-]+;base64,/, '');
      imageBuffer = Buffer.from(base64, 'base64');
    } else if (qrUrl.startsWith('cid:')) {
      const cid = qrUrl.slice(4);
      const ref = findAttachmentByContentId(full.data.payload, cid);
      if (!ref) {
        console.error(`Could not find inline attachment for cid:${cid}`);
        continue;
      }
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: msg.id!,
        id: ref.attachmentId,
      });
      const data = att.data.data ?? '';
      imageBuffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    } else {
      let result = await fetchBuffer(qrUrl);
      if (result.statusCode !== 200 || !imageExtension(result.buffer, result.contentType)) {
        console.log(`Direct download failed (HTTP ${result.statusCode}) — retrying via headless browser...`);
        result = await fetchBufferViaBrowser(qrUrl);
      }
      if (result.statusCode !== 200) {
        console.error(`QR download failed: HTTP ${result.statusCode} from ${qrUrl}`);
        continue;
      }
      imageBuffer = result.buffer;
      contentType = result.contentType;
    }

    const ext = imageExtension(imageBuffer, contentType);
    if (!ext) {
      const preview = imageBuffer.slice(0, 80).toString('utf-8').replace(/\s+/g, ' ');
      console.error(`QR response is not a valid image (content-type: ${contentType || 'unknown'}).`);
      console.error(`First bytes: ${preview}`);
      console.error(`Source: ${qrUrl}`);
      continue;
    }

    const qrDest = path.resolve('tickets', `qr-${orderNum}.${ext}`);
    fs.writeFileSync(qrDest, imageBuffer);

    const relQrPath = path.relative(process.cwd(), qrDest);
    const details = extractTicketDetails(html, relQrPath);

    const jsonDest = path.resolve('tickets', `ticket-${orderNum}.json`);
    fs.writeFileSync(jsonDest, JSON.stringify(details, null, 2));

    console.log(`Seat:    ${details.seat}`);
    console.log(`Time:    ${details.time}`);
    console.log(`Date:    ${details.date}`);
    console.log(`Theatre: ${details.theatre}`);
    console.log(`QR Code: ${details.qrCode}`);
    await closeBrowser();
    process.exit(0);
  }

  console.log('No QR code found in recent AMC emails.');
  await closeBrowser();
  process.exit(0);
}

main().catch(async err => {
  console.error('Error:', err.message);
  await closeBrowser();
  process.exit(1);
});
