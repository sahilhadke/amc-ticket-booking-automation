/**
 * Fetches AMC confirmation emails received in the last 5 minutes
 * and prints the ticket details.
 *
 *   npm run get-ticket-email
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';

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
  // Gmail encodes body parts as base64url
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

function parseTicketDetails(html: string): Record<string, string> {
  // Strip tags and decode entities
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&zwnj;/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/&trade;/g, '™')
    .replace(/&#8209;/g, '‑')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s{2,}/g, '\n')
    .trim();

  const get = (pattern: RegExp) => (text.match(pattern)?.[1] ?? '').trim();

  return {
    orderNumber:    get(/Order Number[:\s]+(\d+)/i),
    confirmation:   get(/Ticket Confirmation#[:\s]+(\d+)/i),
    movie:          get(/Ticket Confirmation#[:\s]+\d+\n([^\n]{3,80})\n\d{1,2}:\d{2} [AP]M/i),
    showtime:       get(/(\d{1,2}:\d{2} [AP]M \d{1,2}\/\d{1,2}\/\d{4})/i),
    theater:        get(/(AMC [\w\s]+\d+)\n\s*\n?\s*\d{1,5}/),
    seat:           get(/Reserved Seats?[:\s]+([A-Z]\d+)/i),
    auditorium:     get(/Auditorium[:\s]+(\d+)/i),
    ticket:         get(/Ticket[:\s]+(1 Adult[^\n]*)/i),
    total:          get(/Total Amount[:\s]+(\$[\d.]+)/i),
    savings:        get(/A-List Savings[:\s]+(-\$[\d.]+)/i),
  };
}

async function main() {
  // Gmail search: from AMC, received in the last 5 minutes
  const query = 'from:amctheatres.com newer_than:5m';
  console.log(`Searching Gmail for: "${query}"\n`);

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

  console.log(`Found ${messages.length} email(s):\n`);

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id!,
      format: 'full',
    });

    const payload = full.data.payload;
    const headers = payload?.headers ?? [];

    const subject = headers.find(h => h.name === 'Subject')?.value ?? '(no subject)';
    const from    = headers.find(h => h.name === 'From')?.value ?? '';
    const date    = headers.find(h => h.name === 'Date')?.value ?? '';

    console.log('─'.repeat(60));
    console.log(`From    : ${from}`);
    console.log(`Date    : ${date}`);
    console.log(`Subject : ${subject}`);
    console.log('─'.repeat(60));

    const html    = extractHtml(payload);
    const details = parseTicketDetails(html);

    const fields: [string, string][] = [
      ['Order #',       details.orderNumber],
      ['Confirmation',  details.confirmation],
      ['Movie',         details.movie],
      ['Showtime',      details.showtime],
      ['Theater',       details.theater],
      ['Seat',          details.seat],
      ['Auditorium',    details.auditorium],
      ['Ticket',        details.ticket],
      ['Total',         details.total],
      ['A-List Saving', details.savings],
    ];

    for (const [label, value] of fields) {
      if (value) console.log(`${label.padEnd(14)}: ${value}`);
    }
    console.log();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
