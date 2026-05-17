# amc-book-movie

Playwright + TypeScript CLI that automates AMC movie ticket booking for AMC Stubs A-List members in three steps:

| Step | Command | What it does |
|------|---------|-------------|
| 1 — Discover | `npm run get-showtimes` | Fetches all movies and showtimes for a date → saves JSON |
| 2 — Book | `npm run book` | Books a specific movie/time, selects best seat, checks out at $0.00 |
| 3 — Read Email | `npm run get-ticket-email` | Reads the AMC confirmation email, saves QR code + ticket details JSON |

---

## Step 1 — Get Showtimes

Scrapes all movies playing at AMC Metreon 16 on a given date and saves them to a JSON file. Use this to decide what to book.

### Command

```bash
npm run get-showtimes -- --date "YYYY-MM-DD" [--theater "theater-slug"]
```

**Example:**
```bash
npm run get-showtimes -- --date "2026-05-11"
```

### Output

Saves to `showtimes/amc-metreon-16-{date}.json`:

```json
{
  "date": "2026-05-11",
  "theater": "AMC Metreon 16",
  "theaterSlug": "amc-metreon-16",
  "fetchedAt": "2026-05-10T17:52:08.820Z",
  "movies": [
    {
      "title": "Project Hail Mary",
      "slug": "project-hail-mary-76779",
      "showtimes": [
        {
          "time": "3:45pm",
          "url": "https://www.amctheatres.com/showtimes/142183580",
          "format": "LASER AT AMC",
          "availability": ""
        },
        {
          "time": "1:45pm",
          "url": "https://www.amctheatres.com/showtimes/142183579",
          "format": "LASER AT AMC",
          "availability": "20% OFF"
        }
      ]
    }
  ]
}
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--date` | Yes | Date in `YYYY-MM-DD` format |
| `--theater` | No | Theater slug (default: `amc-metreon-16`) |

### Notes

- Requires a saved session (run `npm run launch-brave` + `npm run save-session` first).
- Handles AMC's Queue-it waiting room automatically.
- `availability` shows discount offers (e.g. `"20% OFF"`, `"UP TO 15% OFF"`) or seat warnings (e.g. `"Almost Full"`).
- `format` shows the screen type: `LASER AT AMC`, `IMAX WITH LASER AT AMC`, `DOLBY CINEMA AT AMC`, `FAN FAVES`, etc.
- Output folder `showtimes/` is gitignored.

---

## Step 3 — Get Ticket Email

Reads the most recent AMC confirmation email from Gmail and extracts only the 5 details you actually need to walk into the theatre. Everything else (order number, totals, member info, payment, etc.) stays in the email — never logged, never stored.

### Command

```bash
npm run get-ticket-email
```

### Output

**Console** — exactly 5 lines, nothing else:

```
Seat:    N20
Time:    2:00 PM
Date:    5/21/2026
Theatre: 16
QR Code: tickets\qr-1154932458.png
```

**Files saved to `tickets/`:**

| File | Contents |
|------|----------|
| `qr-{orderNumber}.png` | The QR code image (scan this at the theatre) |
| `ticket-{orderNumber}.json` | The same 5 fields shown in the console |

Example `tickets/ticket-1154932458.json`:

```json
{
  "seat": "N20",
  "time": "2:00 PM",
  "date": "5/21/2026",
  "theatre": "16",
  "qrCode": "tickets\\qr-1154932458.png"
}
```

### What it parses

The script searches Gmail for `from:amctheatres.com newer_than:5m` and pulls these fields from the HTML body:

| Field | Source in email |
|-------|-----------------|
| `seat` | `Reserved Seats: N20` |
| `time` | First half of `2:00 PM 5/21/2026` |
| `date` | Second half of `2:00 PM 5/21/2026` |
| `theatre` | `Auditorium: 16` |
| `qrCode` | `<img title="QR Code">` — downloaded to PNG |

### One-time Gmail setup

You need Gmail read-only API access. This is a one-time setup.

1. **Create OAuth credentials** in [Google Cloud Console](https://console.cloud.google.com/):
   - Enable the **Gmail API**
   - Create an **OAuth 2.0 Client ID** (type: Desktop app or Web app with `http://localhost:3000` redirect)
   - Copy the Client ID and Client Secret

2. **Add credentials to `.env`:**
   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

3. **Authorise** — runs a temporary local server on `localhost:3000` to capture the OAuth callback and saves a refresh token to `.env`:
   ```bash
   npm run auth-email
   ```
   A browser will open asking you to approve Gmail read access. After approving, `GMAIL_REFRESH_TOKEN` is written to `.env` automatically.

After this, `npm run get-ticket-email` works without any further login.

### Notes

- The Gmail scope is **read-only** (`gmail.readonly`) — the tool cannot send, delete, or modify any email.
- The script looks at emails from the **last 5 minutes** only, so run it right after booking.
- If no AMC email is found or no QR code is in the HTML, the script exits without writing anything.
- Output folder `tickets/` is gitignored.

---

## For OpenClaw Agent

This section is for AI agents using this tool to book movie tickets on behalf of the user.

### What you need to know

- The session is already saved — no login required before booking.
- The theater defaults to **AMC Metreon 16** (the user's saved preference).
- Bookings are always **$0.00** via AMC Stubs A-List — never charge the user.
- The seat picker selects the **best seat in the last 4 rows**, back-center, skipping wheelchair spaces.
- Run `npm run get-showtimes -- --date "YYYY-MM-DD"` first to see what's playing and pick a movie/time.

### Booking command

```bash
npm run book -- --movie "<title>" --date "<YYYY-MM-DD>" --time "<H:MM PM>" --theater "AMC Metreon 16"
```

**Example:**
```bash
npm run book -- --movie "Project Hail Mary" --date "2026-05-10" --time "3:45 PM" --theater "AMC Metreon 16"
```

### How to pick a good movie and time

1. Run the booking with a plausible time. If the time isn't available, the error output lists every available time for that movie and date:
   ```
   Showtime "3:00 PM" not found. Available: 10:45am, 1:00pm, 3:45pm, 6:15pm, 9:30pm
   ```
2. Retry with a time from that list. Prefer **mid-afternoon** (1–4 PM) — morning shows have few competitors for seats, afternoon shows have plenty of availability.
3. Avoid times that end in `:00` on the dot (e.g. `7:00 PM`) since multiple nearby theaters may share that slot and the script will reject it if Metreon 16 isn't one of them.

### Reading the output

**Success** — exit code 0, final lines look like:
```
[INFO]  Booking confirmed! See screenshots/checkout-confirmed.png
[INFO]  Done. Enjoy the movie!
```

**Failure** — exit code 1, error is on the last line. Common cases:

| Error message | What to do |
|---|---|
| `Showtime "X" not found. Available: ...` | Retry with a time from the Available list |
| `"Movie" is not showing on YYYY-MM-DD` | Wrong date or movie not playing; try another date or title |
| `Seat was taken at the last moment` | Run again immediately — a fresh seat will be selected |
| `Seat is no longer available` | Same as above — run again |
| `No search results` / `Wrong theater` | The time exists only at a nearby theater; pick a different time |
| `No saved session found` | Session expired — tell the user to run `npm run launch-brave` then `npm run save-session` |

### Debugging a failed run

Screenshots are saved automatically at every checkout step. Read them in order to see where things went wrong:

```bash
# View the final state screenshot
screenshots/checkout-confirmed.png

# View step-by-step
screenshots/after-seat-click.png   # was a seat selected?
screenshots/checkout-step1.png     # did Continue work?
screenshots/checkout-step2.png     # was A-List applied?
screenshots/checkout-step3.png     # food page — should show $0.00
```

If `checkout-confirmed.png` shows a **"Thank You"** page with a confirmation number, the booking succeeded even if the script reported an error.

If it shows the **"Confirm Purchase"** page still open, the Purchase button click failed — run once more.

---

## How It Works

1. **Session login** — You log in manually once using your real Brave browser (no Cloudflare/Turnstile issues). The session is saved and reused for all future bookings.
2. **Seat selection** — Applies a radial-from-back-center algorithm: picks the seat closest to the back-center of the theater (best sightlines), skipping wheelchair spaces and front rows.
3. **Checkout** — Automatically selects the A-List reservation option, skips food add-ons, accepts terms, and clicks Purchase. Total is always $0.00.
4. **Email read** — Pulls the AMC confirmation email from Gmail (read-only scope), extracts only seat / time / date / theatre / QR, and saves them. Other email contents are never logged or stored.

## Prerequisites

- Node.js 18+
- An active [AMC Stubs A-List](https://www.amctheatres.com/amcstubs/alist) membership
- Brave browser installed at the default Windows path

## Setup

```bash
cd amc-book-movie
npm install
npx patchright install chromium
```

Copy `.env.example` to `.env` (credentials are only used for reference — login is done manually):

```
AMC_EMAIL=your@email.com
AMC_PASSWORD=yourpassword
```

## First-Time Login

You only need to do this once. The session is saved and persists across runs.

**Terminal 1** — launch Brave with the debug port:
```bash
npm run launch-brave
```

**Terminal 2** — connect and wait for you to log in:
```bash
npm run save-session
```

Navigate to `amctheatres.com` in the Brave window, sign in to your account, then press **Enter** in Terminal 2. Your session is saved to `playwright/.auth/session.json`.

## Booking a Movie

```bash
npm run book -- --movie "Movie Name" --date "YYYY-MM-DD" --time "H:MM PM" --theater "AMC Theater Name"
```

### Examples

```bash
# Book a specific showtime
npm run book -- --movie "Project Hail Mary" --date "2026-05-09" --time "3:45 PM" --theater "AMC Metreon 16"

# Without specifying a theater (uses your saved default)
npm run book -- --movie "The Sheep Detectives" --date "2026-05-10" --time "6:45 PM"
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--movie` | Yes | Movie title (partial match works) |
| `--date` | Yes | Date in `YYYY-MM-DD` format |
| `--time` | Yes | Showtime, e.g. `"3:45 PM"` or `"7:00 PM"` |
| `--theater` | No | Theater name; defaults to your saved session theater |

## Seat Selection Algorithm

Seats are scored by Euclidean distance from the **back-center** of the theater:

```
distance = sqrt((backRow - row)² + (col - centerCol)²)
```

The seat with the lowest score is selected. The algorithm automatically excludes:
- Wheelchair and companion spaces
- Front 2 rows (rows A and B)
- Occupied / unavailable seats

## Project Structure

```
src/
├── getShowtimes.ts   # Step 1 — scrape all movies/showtimes for a date → JSON
├── index.ts          # Step 2 — CLI entry, orchestrates booking flow
├── authEmail.ts      # Step 3 setup — Google OAuth flow, saves refresh token to .env
├── getTicketEmail.ts # Step 3 — reads AMC email, saves QR PNG + ticket JSON
├── saveSession.ts    # Session login via CDP-connected Brave
├── movieFinder.ts    # Navigates showtimes page, finds and clicks the showtime
├── seatSelector.ts   # Parses seat map, picks best seat in last 4 rows (radial)
├── checkout.ts       # A-List stubs, food skip, Confirm Purchase, safety checks
├── historyManager.ts # Read/write watched-history.json
├── crawlHistory.ts   # Scrape /my-amc/history → watched-history.json
├── ticketCapture.ts  # Navigate to ticket page and screenshot QR code
└── utils/
    ├── logger.ts     # Timestamped INFO/ERROR logging
    ├── human.ts      # Mouse movement, sleep, gotoWithQueue (Queue-it handler)
    ├── errors.ts     # Typed custom errors
    └── capsolver.ts  # CapSolver Turnstile API integration
```

## Debugging

Screenshots are saved to `screenshots/` at each checkout step:

| File | When |
|------|------|
| `after-seat-click.png` | After clicking the seat |
| `checkout-step1.png` | After first Continue |
| `checkout-step2.png` | After A-List stubs |
| `checkout-step3.png` | After food/combos |
| `checkout-confirmed.png` | Final confirmation page |
| `error-{timestamp}.png` | On any unhandled error |

Run with the debugger:
```bash
npm run debug -- --movie "..." --date "..." --time "..."
```

## Notes

- **Session expiry** — If bookings start failing with authentication errors, re-run the login flow (`npm run launch-brave` + `npm run save-session`).
- **Wrong theater** — The script verifies the theater name after clicking a showtime and aborts if it lands at a nearby theater instead.
- **Seat taken** — If a seat is taken at the last step, the script navigates away to release the A-List hold before exiting. Run again to pick a fresh seat.
- **A-List only** — This tool is designed for $0 A-List reservations. If the A-List option isn't detected on a showtime, the booking is aborted before any charge occurs.
