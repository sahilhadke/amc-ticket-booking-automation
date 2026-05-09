# amc-book-movie

Playwright + TypeScript CLI that automatically books AMC movie tickets for AMC Stubs A-List members. Given a movie name, date, and showtime, it finds the best available seat and completes the full checkout at $0.00.

---

## For OpenClaw Agent

This section is for AI agents using this tool to book movie tickets on behalf of the user.

### What you need to know

- The session is already saved — no login required before booking.
- The theater defaults to **AMC Metreon 16** (the user's saved preference).
- Bookings are always **$0.00** via AMC Stubs A-List — never charge the user.
- The seat picker automatically selects the **best back-center seat**, skipping front rows and wheelchair spaces.

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
├── index.ts          # CLI entry — parses args, orchestrates the flow
├── saveSession.ts    # CDP-connects to Brave for manual login + session save
├── movieFinder.ts    # Navigates to theater showtimes, finds and clicks the showtime
├── seatSelector.ts   # Parses seat map, picks best seat via radial algorithm
├── checkout.ts       # Handles A-List stubs, food skip, Confirm Purchase
├── auth.ts           # (Unused in main flow) Login automation with CapSolver
└── utils/
    ├── logger.ts     # Timestamped INFO/ERROR logging
    ├── human.ts      # Human-like mouse movement, typing delays, sleep
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
