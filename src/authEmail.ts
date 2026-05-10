/**
 * Run this once to authorise Gmail read access.
 * It will open your browser, ask you to approve, then save the
 * refresh_token to .env automatically.
 *
 *   npm run auth-email
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as http from 'http';
import { google } from 'googleapis';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3000';
const ENV_FILE      = '.env';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  console.error('See README → Step 3 for how to get these from Google Cloud Console.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  prompt: 'consent', // force refresh_token to be returned every time
});

console.log('\nOpening browser for Google OAuth approval...');
console.log('If it does not open automatically, visit this URL:\n');
console.log(authUrl + '\n');

// Try to open the browser automatically
const { exec } = require('child_process');
exec(`start "" "${authUrl}"`);

// Start a temporary local server to capture the OAuth callback
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url!, `http://localhost:3000`);
  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');

  if (error) {
    res.end('<h2>Access denied.</h2><p>You can close this tab.</p>');
    console.error('\nOAuth denied:', error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end('<h2>No code received.</h2>');
    server.close();
    return;
  }

  res.end('<h2>✓ Authorised!</h2><p>You can close this tab and return to the terminal.</p>');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      throw new Error('No refresh_token in response — try revoking access at myaccount.google.com/permissions and re-running.');
    }

    // Write GMAIL_REFRESH_TOKEN into .env — remove any existing line (commented or not) then append
    let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
    envContent = envContent.replace(/^#?\s*GMAIL_REFRESH_TOKEN=.*\n?/m, '').trimEnd();
    envContent += `\nGMAIL_REFRESH_TOKEN=${refreshToken}\n`;
    fs.writeFileSync(ENV_FILE, envContent);

    console.log('\n✓  refresh_token saved to .env as GMAIL_REFRESH_TOKEN');
    console.log('You can now run:  npm run get-ticket-email\n');
  } catch (err) {
    console.error('Token exchange failed:', (err as Error).message);
  }

  server.close();
});

server.listen(3000, () => {
  console.log('Waiting for OAuth callback on http://localhost:3000 ...\n');
});
