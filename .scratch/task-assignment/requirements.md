# vlm_agent — Task assignment requirements

Nov 12, 2026 · Core requirements: [[Projects/vlm_agent/requirements|requirements]] · Plan: [[Projects/vlm_agent/plan|plan]] · Handoff: [[Projects/vlm_agent/handoff-task-assignment|handoff]]

Status: requirements agreed after a grilling session (Nov 12, 2026). All earlier open questions are resolved.

> Kept here as the source of the TA-n IDs. Where `spec.md` differs (MongoDB instead of Postgres + Drizzle, the paths, the module boundary), `spec.md` wins.

## Overview

**Pitch:** a simple task app. An owner defines tasks, picks some, groups them into a **list**, and assigns the list to a person by sending them a link. The owner sees who is doing what and is told when they finish.

**Who it's for:** **owners** (people with an account) and **assignees** (people an owner sends a list to, who have no account).

**Flow:** define tasks → select some → make a list → assign to a person (tiny link) → they tick tasks off → the owner sees progress and alerts live.

**Principles.**

- Simple first: web only, no Telegram. The only extra service is transactional email, used for login only.
- One place to define all tasks, assigned or not.
- Assigning is one step: the link is the assignment.
- Assignees need no sign-up: open the link, tick tasks.
- Real time: changes show on every open screen within about a second.

## Concepts

| Term | Meaning |
| --- | --- |
| **Owner / user** | A person with an account (email login). Has a private workspace |
| **Task** | One thing to do: title, tags, optional note, optional instruction, optional blocked reason, status |
| **List** | A named group of tasks the owner picked. A task is in at most one list at a time |
| **Person** | Someone the owner assigns to, identified by a name (unique per owner, case-insensitive) |
| **Assignment** | A list given to one person, with its own tiny link |
| **Board** | The owner's overview of who is doing what |

## Decisions

- Everything happens on the web: the owner app is behind login, and assignees use only their link page.
- One list goes to one person at a time. To give the same tasks to two people, make two lists.
- "Viewed" is tracked at list level only, not per task.
- Assignees can only act on existing tasks (done, blocked, open, add a note). They can't add or edit tasks.
- `instruction` is written by the owner and is read-only for the assignee. `note` is written by the assignee. The owner can read, edit or clear it. Every change is logged in `events`.
- The blocked reason is its own field (`blocked_reason`), shown on the board and cleared when the task leaves **blocked**.
- Statuses belong to the task, not the assignment. They carry over on reassign and when a task is removed from a list.
- Done tasks stay on the assignee page in a collapsed "Done (n)" section and can be reopened.
- Links are served at `/l/<code>` on the main domain. A short domain can come later with no schema change.
- Each owner has a private workspace. There is no sharing between owners in the MVP.
- The link is the only assignee credential, so it is unguessable and revocable.
- All timestamps are stored in UTC. They are shown in the viewer's local time, with relative wording ("Viewed 10 min ago").

## Functional requirements

Priority: **P1** = MVP, **P2** = next.

### Accounts and sessions (owners)

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-45 | Sign up and log in by entering an email and following a **magic link**. `SIGNUP_MODE=open\|allowlist` (default `open`) controls whether any email may create an account | P1 |
| TA-46 | Magic links are single-use, expire after 15 minutes, and tokens are random and stored hashed. The response is identical whether or not the email can sign in. Requests are rate-limited per email and per IP (e.g. 5 per 15 min) | P1 |
| TA-47 | After the first login, offer **Set a password?** with a visible Skip. If skipped, the user stays on magic-link login. A password can be set or changed later in settings | P1 |
| TA-48 | The login screen offers "email me a link" and, if a password is set, password login. Passwords use argon2id, minimum 10 characters, and failed attempts are rate-limited. Magic link is the recovery path, so there is no separate "forgot password" flow | P1 |
| TA-49 | Sessions use a short-lived access JWT (15 min) plus a rotating refresh token (30 days) in httpOnly, Secure, SameSite=Lax cookies. Refresh tokens are stored hashed in the database. Logout, "sign out everywhere" and password change revoke them | P1 |
| TA-50 | CSRF protection: SameSite=Lax plus a double-submit CSRF token on all non-GET owner routes. Assignee link pages use no cookie and need none | P1 |
| TA-51 | Every owner has a private workspace. Every table carries `owner_id` and every query is scoped by it | P1 |
| TA-52 | Per-IP cap on new accounts (e.g. 5 per hour) | P1 |

### Tasks

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-1 | Create a task with a title; it starts **open** and **unassigned** | P1 |
| TA-2 | Statuses: **open**, **blocked**, **done** | P1 |
| TA-3 | Edit, delete and reopen a task | P1 |
| TA-4 | Optional due date | P2 |

### Tags, notes and instructions

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-5 | Add zero or more tags to a task (up to 5, each up to 30 characters). Tags are trimmed, lowercased, unique per owner and reused | P1 |
| TA-6 | Filter tasks and the board by tag | P1 |
| TA-7 | Optional **note** on a task: free text written by the assignee. The owner can read, edit or clear it | P1 |
| TA-8 | Optional **instruction** on a task: what the assignee should do. Written by the owner, read-only for the assignee | P1 |
| TA-9 | **Blocked** requires a reason, saved in `blocked_reason` and cleared when the task leaves blocked | P1 |
| TA-10 | Notes, instructions and blocked reasons are visible to the assignee | P1 |

### Lists

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-11 | Select tasks from the pool and **group them into a named list** | P1 |
| TA-12 | Add or remove tasks in a list; removed tasks return to the pool unassigned and keep their status | P1 |
| TA-13 | A task already in a list can't be added to another (show which list has it) | P1 |
| TA-14 | Archive a list when finished; it leaves the board but stays findable | P2 |

### People and assignment

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-15 | Add a person by name and reuse them when assigning. Names are unique per owner, case-insensitive; a duplicate reuses the existing person | P1 |
| TA-16 | **Assign** a list to a person: creates a tiny link such as `/l/k7Qx2m` with a copy button | P1 |
| TA-17 | The code is random, at least 8 characters, unguessable | P1 |
| TA-18 | Opening the link shows the list, who it's for, and its tasks with tags, notes, instructions, blocked reasons and status. No login. Done tasks are collapsed under "Done (n)" | P1 |
| TA-19 | The assignee can mark a task **done**, **blocked** (with a reason) or **open** again, and add a note | P1 |
| TA-20 | The assignee can't edit titles, tags or instructions, can't add tasks, and can't see other lists or the pool | P1 |
| TA-21 | **Reassign** a list: the old link stops working and a new one is made. Task statuses carry over | P1 |
| TA-22 | **Revoke** a link at any time; it then shows "no longer available" | P1 |
| TA-23 | A list can stay unassigned (draft) until the owner assigns it | P1 |
| TA-24 | Optional link expiry | P2 |
| TA-53 | **Deletion:** deleting a list revokes its active link and returns its tasks to the pool (statuses kept). Deleting a person revokes all their active assignments and keeps views and events as history. Deleting a task in an active list removes it from the assignee page immediately. Delete asks for confirmation and names the effect (e.g. "revokes 2 active links") | P1 |

### Viewed tracking

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-36 | When the assignee opens the link, the assignment is marked **viewed** in the database | P1 |
| TA-37 | Store `first_viewed_at`, `last_viewed_at` and `view_count` on the assignment | P1 |
| TA-38 | Keep a log of every open: assignment, timestamp, and basic device info (browser and device type from the user agent) | P1 |
| TA-39 | The server renders `/l/<code>` without counting. The page's JS posts a beacon to `/l/<code>/view`, which counts the view only if the user agent is not a known bot or link-preview crawler (WhatsApp, Telegram, Slack, facebookexternalhit, `HEAD` requests) and the request has no valid owner session cookie | P1 |
| TA-40 | Count a view once per page load; rapid reloads within 30 seconds count as one | P2 |
| TA-41 | The board shows each list as **Not opened** or **Viewed** with the time of the last view (e.g. "Viewed 10 min ago") | P1 |
| TA-42 | The first open creates an entry in the activity feed ("Sara opened Move-out checklist") and a live alert if the board is open | P1 |
| TA-43 | A revoked or expired link opened afterwards is logged as a failed view (server-side, on render) and does not mark the assignment viewed | P2 |
| TA-44 | Reassigning a list starts fresh: the new assignment has its own viewed state, and the old log is kept as history | P1 |

### Board: who's doing what

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-25 | One section per person with their lists and progress (e.g. 3 of 5 done) | P1 |
| TA-26 | Highlight **blocked** tasks with the reason | P1 |
| TA-27 | Show unassigned tasks and draft lists in their own section | P1 |
| TA-28 | Filter the board by person, tag or status | P1 |
| TA-29 | Show each list's last activity (last view or last task change) | P2 |

### Notifications (in-app)

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-30 | When an assignee marks a task done or blocked, a live alert appears on the owner's board if it's open | P1 |
| TA-31 | An **activity feed** on the board lists recent changes (who, what, when), capped to the last 200 entries in the UI. The unread badge counts events newer than the user's `last_seen_event_id` and clears when the feed is opened | P1 |
| TA-32 | When a whole list is done, the feed shows one "list complete" entry | P1 |

### Real-time updates

| ID | Requirement | Priority |
| --- | --- | --- |
| TA-33 | Any change appears on every open screen (assignee pages and board) within 1–2 seconds, without a refresh | P1 |
| TA-34 | If the connection drops, the page reconnects and catches up. SSE uses `events.id` as the event ID; the client sends `Last-Event-ID` and the server replays later events. If the gap is too large or the ID is unknown, the client refetches full state | P1 |
| TA-35 | Small "live" / "reconnecting…" indicator | P2 |

## Non-functional requirements

| ID | Requirement |
| --- | --- |
| TA-NFR-1 | **Link security:** codes use a secure random source; assignee pages send `noindex`; codes are never logged |
| TA-NFR-2 | **Scoped access:** a link exposes only that list's tasks, nothing else |
| TA-NFR-3 | **Owner access:** the app and board are behind login, never public. Owners can only see their own workspace |
| TA-NFR-4 | **Limits:** 60 requests per minute per IP on link pages; 50 tasks per list |
| TA-NFR-5 | **Input safety:** text is escaped on render and length-limited: 200 characters for titles, 2,000 for note, instruction and blocked reason |
| TA-NFR-6 | **Latency:** changes reach other viewers within 2 seconds in normal conditions |
| TA-NFR-7 | **Save first:** a change is saved before it is broadcast, so it is never lost |
| TA-NFR-8 | **Privacy:** revoking, reassigning or deleting removes the tasks from the old assignee's page immediately |
| TA-NFR-9 | **Scale:** a few hundred tasks per owner, a dozen people, a few dozen viewers |
| TA-NFR-10 | **View data privacy:** store only what is listed (time, user agent, device type). Do not store IP addresses or precise location. Delete the view log with its assignment, and after 90 days by default, using an idempotent in-process daily purge (no queue or cron service) |
| TA-NFR-11 | **View accuracy:** `view_count` and the first-view alert are written in one transaction, so two tabs opening at once produce one first-view entry |
| TA-NFR-12 | **Auth security:** login tokens and refresh tokens are stored hashed; passwords use argon2id; login responses don't reveal whether an email exists |
| TA-NFR-13 | **Time:** timestamps are stored in UTC and displayed in the viewer's local time |

## Data model (sketch)

Every table below except `users`, `login_tokens` and `refresh_tokens` carries `owner_id`.

| Table | Main fields |
| --- | --- |
| `users` | id, email (unique), password_hash (nullable), last_seen_event_id, created_at |
| `login_tokens` | id, user_id or email, token_hash, expires_at, used_at |
| `refresh_tokens` | id, user_id, token_hash, expires_at, revoked_at, replaced_by |
| `tasks` | id, owner_id, title, status, note, instruction, blocked_reason, due_at, list_id (nullable), created_at, updated_at |
| `tags`, `task_tags` | tag name (unique per owner, lowercase); task ↔ tag link |
| `lists` | id, owner_id, name, status (draft / active / archived) |
| `people` | id, owner_id, name (unique per owner, case-insensitive) |
| `assignments` | id, list_id, person_id, code (unique), expires_at, revoked_at, first_viewed_at, last_viewed_at, view_count |
| `assignment_views` | id, assignment_id, viewed_at, user_agent, device_type, counted (false for bots or the owner), outcome (ok / revoked / expired) |
| `events` | id, owner_id, task_id, list_id, person_id, kind, from_value, to_value, created_at (feeds the activity feed, SSE replay and history) |

A task has at most one `list_id`. A list has at most one active assignment.

## How it fits the current stack

| Need | Choice |
| --- | --- |
| App, board, assignee page | Fastify routes and server-rendered pages with light client script |
| Owner auth | Magic link by email, optional argon2id password, access JWT plus rotating refresh token in httpOnly cookies, CSRF token |
| Email | A small mailer interface over an SMTP or API provider (e.g. Resend or SES). In dev it logs the link to the console. Login emails only |
| Real-time | Server-Sent Events from Fastify: one stream per assignment, one for the board, with `Last-Event-ID` replay from `events` |
| Tiny link | Short random code in Postgres, served at `/l/<code>` |
| View counting | JS beacon to `/l/<code>/view` plus a user-agent bot filter |
| Storage | Postgres + Drizzle, shared with the rest of vlm_agent |
| Housekeeping | In-process daily timer for the 90-day view-log purge |

No job queue or Redis is needed for this feature.

## Conflicts with the current requirements

The core requirements say there is **no web UI**, that **Telegram is the only interface**, and that there is a **single owner**. This feature changes all three, so that section needs to change when it is accepted. Suggested wording: "Owners have accounts (email link, optional password), each with a private workspace. Assignees never have accounts and use their link page only."

## Out of scope (for now)

- Telegram, email or push notifications (the only email sent is login).
- Creating tasks from voice notes.
- Accounts, logins or roles for assignees.
- Shared workspaces or teams between owners.
- A short link domain.
- Comments or chat on a task (only the note field).
- Recurring tasks, sub-tasks and list templates.
- Auto-suggested tags.
