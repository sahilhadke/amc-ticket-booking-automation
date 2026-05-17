---
name: amc
description: Book an AMC movie ticket for a given date and time. Invoke when the user says "/amc", "book a movie", "book AMC tickets", or wants to reserve a movie seat at AMC. The movie selection is intentionally hidden from the user — only the final seat / time / date / theatre / QR are revealed.
argument-hint: [date] [time]
allowed-tools: [Bash, Read]
disable-model-invocation: true
---

# AMC Movie Booking — Surprise Mode

Automates the full AMC booking flow: discover showtimes → pick the best movie internally → book the seat → confirm via email.

**Project location:** `C:\Users\sahil\Desktop\projects\amc-book-movie`

---

## CRITICAL — Movie title is a secret

The movie identity must remain hidden from the user at **every** step of this skill. Treat the movie title as if it were a password.

**Do NOT, under any circumstances:**
- Show, list, or rank candidate movie titles
- Echo `npm run book`'s log lines that contain the title (e.g. `Booked: <Title>`, `Movie not found`, `Resolved slug ...`)
- Mention which movie failed during retries (e.g. "X is full, trying Y")
- Reveal the title in error messages, even on total failure
- Hint at the title via genre, year, runtime, cast, format-only clues, or "you'll love it"–style commentary

**Do:**
- Internally read the showtimes JSON, internally rank, internally retry — keep all of that in the agent's head, never in user-facing text
- Refer to the movie only as "your movie" or "the booking"
- If the user asks "what movie?", say: `"That's the surprise — you'll find out at the theatre."` and do not reveal it

---

## Step 1 — Resolve date and time

If `$ARGUMENTS` already contains both a date and a time, extract them. Otherwise, ask the user for both in one message:
- **Date** — e.g. "May 15", "tomorrow", "2026-05-15"
- **Time** — e.g. "7:30 PM", "3:45 PM"

Normalise:
- Date → `YYYY-MM-DD` (use today's year if omitted; resolve "tomorrow" relative to today)
- Time → `H:MM AM/PM` (e.g. `"7:30 PM"`)
- Time (compact) → lowercase no-space form for JSON matching (e.g. `"7:30pm"`)

Tell the user only:
```
Booking your movie for {date} at {time}...
```

No other detail. No mention of theater unless they ask.

---

## Step 2 — Discover and rank silently

Run the showtime scraper:

```bash
cd "C:\Users\sahil\Desktop\projects\amc-book-movie" && npm run get-showtimes -- --date {YYYY-MM-DD}
```

Read `C:\Users\sahil\Desktop\projects\amc-book-movie\showtimes\amc-metreon-16-{YYYY-MM-DD}.json` with the `Read` tool.

**Filter:** Keep only movies whose `showtimes[].time` matches the requested time (case-insensitive, compact form, e.g. `"7:30pm"`). For each, remember the matching showtime's `format` and `availability`. Also remove the movies which the user has already watched, you can find it in `watched-history.json`.

**Rank internally** (do not show this to the user):
- Sort by popularity using your knowledge of box-office performance, franchise recognition, and cultural relevance.
- Boost any movie whose matching showtime has `"Almost Full"` in `availability` (signals high demand).
- Final ordering is your private working list.

If zero movies match the requested time, tell the user:
> "Nothing's playing at {time} on {date}. Try a different time or date."

Stop and do not proceed to Step 3.

**Do not** print the candidate list, the count of candidates, the ranking, or any title at this stage.

---

## Step 3 — Book in private until one succeeds

Walk your private ranked list top-to-bottom. For each attempt, run:

```bash
cd "C:\Users\sahil\Desktop\projects\amc-book-movie" && npm run book -- --movie "{Movie Title}" --date "{YYYY-MM-DD}" --time "{H:MM AM/PM}"
```

Allow up to **180 seconds** per attempt.

**On success** (exit code 0, output contains `✓  BOOKED`):
- Do **not** parse or echo the success block to the user. It contains the title.
- Stop the loop. Proceed to Step 4.

**On failure** (non-zero exit), classify by output content:

| Pattern in output | Action |
|---|---|
| `NoSeatsAvailable`, `no longer available`, `purchased by another`, `reached capacity` | Seats full → try next candidate |
| `ShowtimeNotFound`, `MovieNotFound` | Try next candidate |
| `BookingFailed` with A-List error | Try next candidate |
| Anything else (unexpected) | Stop. Tell user `"Booking hit an unexpected error. Try again in a moment."` Do not include any output lines that name the movie. |

**Between retries, say nothing.** Stay silent until either a booking succeeds or the list is exhausted. If you must signal progress (e.g. the user has been waiting >60s with no message), use only neutral phrasing:
> "First option wasn't available — trying another..."

Never say "First option was {Title}" or "now trying {Title}". Never give a count of how many movies remain.

If all candidates exhaust without a successful booking, tell the user:
> "No seats available at {time} on {date}. Try a different time or date."

Do not list which movies were tried.

---

## Step 4 — Fetch confirmation email and reveal only the 5 fields

Wait 35 seconds, then read the email:

```bash
sleep 35 && cd "C:\Users\sahil\Desktop\projects\amc-book-movie" && npm run get-ticket-email
```

The command prints exactly 5 lines and writes `tickets/ticket-{orderNumber}.json`. The ticket JSON deliberately omits the movie title, so it is safe to read.

**Resolve** the relative `tickets\qr-{orderNumber}.png` path to an absolute path against the project root:
`C:\Users\sahil\Desktop\projects\amc-book-movie\tickets\qr-{orderNumber}.png`

**Final user-facing output — emit exactly this, nothing more, nothing less:**

```
Your ticket is ready.

Seat:     {seat}
Time:     {time}
Date:     {date}
Theatre:  Auditorium {theatre}
QR Code:  {absolute-qr-path}

ATTACHMENT: {absolute-qr-path}
```

The trailing `ATTACHMENT: <absolute-path>` line is **mandatory** and must always be emitted (no conditional check, no detection logic). The Claude Dispatch surface scans for this marker and attaches the PNG. The line must:
- Be on its own line
- Start at column 0
- Use the literal prefix `ATTACHMENT: ` (uppercase, single space after the colon)
- Contain the absolute Windows path to the QR PNG

**Forbidden in final output:**
- Movie title
- Order / confirmation number
- A-List savings, totals, payment info
- Member info
- Any line from the booking script's stdout other than what's templated above

If the email read returns empty or `No AMC emails found` / `No QR code found`, wait another 30 seconds and retry once:

```bash
sleep 30 && cd "C:\Users\sahil\Desktop\projects\amc-book-movie" && npm run get-ticket-email
```

If still empty, tell the user:
> "Your booking is confirmed. The AMC email is taking longer than usual — check your inbox in a minute for the QR code."

Do **not** fall back to the booking-script's success block, since that contains the title.

---

## Quick self-check before sending any message to the user

Before every user-facing message during this skill, ask yourself: *Does this text contain, hint at, or allow the user to look up the movie title?* If yes, rewrite it. If you cannot rewrite it without losing information the user needs, omit the message entirely.
