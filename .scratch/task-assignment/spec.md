# Spec: Task assignment

Status: needs-triage (awaiting the owner's review)

The requirements, with their TA-n IDs, are in [requirements.md](requirements.md). This spec says how they're built in this repo, and wins where the two differ.

## Problem Statement

I hand out jobs to people who have no account anywhere: a cleaner, a mover, a helper. Today that means a chat message with a list of bullets, no idea whether they read it, and asking "done yet?" over and over. I want to define my tasks once, group some into a list, send a person one link, and then watch on a board what they've opened, done or got stuck on, live.

## Solution

A separate web module of vlm_agent, **Task assignment**, in `src/assign/`. Owners sign up by email (magic link, optional password) and each gets a private workspace. In it they create Tasks (with tags and an instruction), group them into Lists, and assign a List to a Person, which makes a tiny link `/l/<code>`. The assignee opens the link with no login, ticks Tasks done, marks them blocked with a reason, or adds a note. The owner's Board shows each Person's Lists with progress, blocked Tasks, whether each link has been opened, and an activity feed. Every open screen updates within about two seconds over Server-Sent Events.

It shares only the MongoDB connection and the HTTP server with the voice-notes bot. The Telegram bot, the core and the existing dashboard are untouched.

## User Stories

Each story points at the requirement IDs it covers. P1 only; P2 is listed under **Later**.

### Owner accounts
1. As an owner, I want to sign up and log in by entering my email and clicking a link, so that I don't need yet another password (TA-45, TA-46).
2. As an owner, I want to be offered an optional password after my first login, with a Skip, so that I can log in faster later if I want (TA-47, TA-48).
3. As an owner, I want to stay logged in for 30 days on my device and be able to sign out here or everywhere, so that a lost laptop isn't a lasting risk (TA-49).
4. As an owner, I want nobody to be able to tell whether an email has an account, and repeated guesses to be slowed down, so that my account isn't a target (TA-46, TA-48, TA-52, TA-NFR-12).
5. As an owner, I want everything I make to be invisible to every other owner (TA-51, TA-NFR-3).

### Tasks and Lists
6. As an owner, I want to create, edit, delete and reopen Tasks with a title, tags and an instruction, so that I define all work in one place (TA-1–3, TA-5, TA-8).
7. As an owner, I want to filter my Tasks by tag (TA-6).
8. As an owner, I want to pick Tasks from the pool into a named List, add or remove them later, and be told which List already holds a Task, so that no Task is given out twice (TA-11–13, TA-23).
9. As an owner, I want to read, edit or clear the note an assignee left (TA-7).

### Assigning
10. As an owner, I want to assign a List to a Person by name, reusing the Person if the name already exists, and get a link with a copy button (TA-15–17).
11. As an owner, I want to reassign or revoke a link at any time, and the old link to stop working at once (TA-21, TA-22, TA-44, TA-NFR-8).
12. As an owner, I want deleting a List, Person or Task to tell me what it will revoke, and then do exactly that (TA-53).

### The assignee
13. As an assignee, I want to open the link with no sign-up and see the List, who it's for, and each Task with its tags, instruction, note, blocked reason and status, with done Tasks folded under "Done (n)" (TA-18, TA-10).
14. As an assignee, I want to mark a Task done, blocked with a reason, or open again, and add a note — and nothing more (TA-19, TA-20, TA-9, TA-NFR-2).

### The Board
15. As an owner, I want one section per Person with their Lists and progress ("3 of 5 done"), blocked Tasks highlighted with the reason, and unassigned Tasks and draft Lists in their own section (TA-25–27).
16. As an owner, I want to filter the Board by Person, tag or status (TA-28).
17. As an owner, I want to see whether each link is **Not opened** or **Viewed 10 min ago**, without my own visits or link previews counting (TA-36–39, TA-41).
18. As an owner, I want an activity feed with an unread badge, an entry when a link is first opened, one "list complete" entry when a List is all done, and a live alert when a Task is done or blocked (TA-30–32, TA-42).
19. As anyone with a page open, I want changes to appear within two seconds without refreshing, and the page to catch up by itself after a dropped connection (TA-33, TA-34, TA-NFR-6, TA-NFR-7).

## Implementation Decisions

- **Module boundary.** All code is in `src/assign/`, tests in `test/assign/`. It must not import from `src/core`, `src/telegram` or `src/dashboard`, and nothing there imports from it; an architecture test enforces both directions. Outside the module only `src/server.ts`, `src/main.ts` and `src/config.ts` change, to register the module when it's configured. It's off unless `ASSIGN_JWT_SECRET` and `PUBLIC_URL` are set.
- **Storage: MongoDB, not Postgres.** The same database and connection as the bot (ADR 0006). Each requirements table is a collection prefixed `ta_`: `ta_users`, `ta_login_tokens`, `ta_refresh_tokens`, `ta_tasks`, `ta_lists`, `ta_people`, `ta_assignments`, `ta_views`, `ta_events`. Tags are an array of lowercase strings on the Task (max 5), with the owner's tag set derived from their Tasks, so no `tags`/`task_tags` collections. Every collection except users and tokens has `ownerId`, and every query goes through a store that takes the owner's ID. Unique indexes: email; `(ownerId, nameLower)` on people; `code` on assignments.
- **One first view.** `TA-NFR-11` asks for a transaction. Instead, the first view is one atomic `findOneAndUpdate` that matches only while `firstViewedAt` is null; only the request that wins it writes the "opened" event. Later views `$inc` the count and set `lastViewedAt`. This needs no replica set.
- **Events.** `ta_events` get an increasing numeric `seq` per database (from a counter document) used as the SSE event ID and as `lastSeenEventId`. A change is written to its collection, then its event is written, then the event is broadcast (TA-NFR-7).
- **Live updates.** An in-process hub, owner-scoped. `GET /assign/events` streams the owner's events; `GET /l/<code>/events` streams only that assignment's List. A reconnect with `Last-Event-ID` replays later events from `ta_events`; if that ID is unknown or more than 500 events behind, the server sends a `reset` event and the page refetches. One server process is assumed (TA-NFR-9).
- **Auth, with no new packages.**
  - Magic link: 32 random bytes, base64url, stored as a SHA-256 hash, single-use, 15 minutes.
  - Passwords: `crypto.argon2` (`argon2id`, built into Node ≥ 24.7), minimum 10 characters.
  - Access token: HS256 JWT signed with `ASSIGN_JWT_SECRET`, 15 minutes, in the `ta_access` cookie.
  - Refresh token: random, hashed, 30 days, rotated on every use, in the `ta_refresh` cookie scoped to `/assign`. Reusing an already-rotated refresh token revokes the whole family.
  - Cookies are httpOnly, SameSite=Lax, and Secure when `PUBLIC_URL` is https.
  - CSRF: a double-submit `ta_csrf` cookie plus a hidden form field or `x-csrf-token` header on every non-GET `/assign` route.
- **Rate limits.** An in-memory sliding-window limiter, keyed by email or IP: login links 5 per 15 min per email and per IP; password attempts 5 per 15 min per email; new accounts 5 per hour per IP; link pages 60 per minute per IP. Behind a proxy, Fastify `trustProxy` is set from config.
- **Email.** A `Mailer` interface with two implementations: Resend (one `fetch` to its API with `RESEND_API_KEY` and `MAIL_FROM`) and console (logs the link) when no key is set. Login emails only.
- **Views.** The server renders `/l/<code>` without counting; a small script posts a beacon to `/l/<code>/view`. It counts only when the user agent isn't a known bot or preview crawler (WhatsApp, TelegramBot, Slackbot, facebookexternalhit, Discordbot, Twitterbot, LinkedInBot, Googlebot, bingbot, and anything with "bot", "crawler" or "preview"), it isn't a `HEAD` request, and there's no valid owner access cookie. Every beacon is logged in `ta_views` with `counted` true or false; the browser and device type are parsed from the user agent, and the IP is never stored.
- **Pages.** Fastify routes with server-rendered EJS and one small client script per page, in the dashboard's dark-mode style (copied into the module, not shared). Owner pages are under `/assign`; the assignee page is `/l/<code>` and sends `X-Robots-Tag: noindex` and a `noindex` meta tag. Text is escaped by EJS and length-limited (TA-NFR-5). Times are stored in UTC and shown in the browser's local time by the client script (TA-NFR-13).
- **Housekeeping.** A daily in-process timer deletes `ta_views` older than 90 days (`ASSIGN_VIEW_RETENTION_DAYS`), plus expired login tokens and refresh tokens. It's idempotent, so a restart that re-runs it does no harm.
- **Glossary.** The module's own terms (Owner, Assignee, List, Person, Assignment, Board, Assigned Task) get their own section in `GLOSSARY.md`, so they aren't confused with the bot's User and Task.

## Testing Decisions

- **One seam: the module's HTTP routes**, driven with `fastify.inject` against `buildAssign(...)` on in-memory MongoDB. Tests act as an owner or an assignee does: post forms, follow links, read pages and JSON. They don't test stores or helpers directly.
- **Email** goes to a fake mailer that records the messages, so a test can follow the magic link it sent.
- **Time** comes from an injected `now()`, so expiry, the 30-second rule and the purge are tested without waiting.
- **Live updates** are tested by opening the SSE route with a real listening server and reading events, including reconnecting with `Last-Event-ID`.
- **Module boundary** is checked by an architecture test, following `test/architecture.test.ts`.
- The existing 265 tests must keep passing unchanged.

## Out of Scope

Everything in the requirements' out-of-scope list, plus: Postgres and Drizzle, a separate process or port, sharing accounts with the bot's Users, and any change to the Telegram bot.

## Later (P2)

TA-4 due dates, TA-14 archiving Lists, TA-24 link expiry, TA-29 last activity, TA-35 the live indicator, TA-40 the 30-second reload rule, TA-43 logging failed views. Each becomes its own ticket after P1.
