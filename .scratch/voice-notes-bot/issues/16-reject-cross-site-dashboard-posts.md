# 16: Reject cross-site form posts to the dashboard

**What to build:** The dashboard no longer requires a login: a request without credentials acts as the first admin (`src/dashboard/dashboard.ts`, `onRequest` hook). With no credentials and no CSRF check, any web page the admin visits can submit a form to `http://127.0.0.1:3000/...` and the dashboard carries it out as the admin. That includes `POST /users`, `/users/:id/password`, `/users/:id/identities` (which links a Telegram identity to a User and so gives bot access), `/users/:id/delete`, and the Note and Task edit and delete routes. The fix is to refuse state-changing requests that come from another site.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] A dashboard `POST` whose `Sec-Fetch-Site` is `cross-site` or `same-site` gets 403, and nothing changes.
- [ ] When `Sec-Fetch-Site` is missing, a `POST` whose `Origin` is present and is not the dashboard's own origin gets 403.
- [ ] A `POST` from the dashboard's own pages (`Sec-Fetch-Site: same-origin`, or a matching `Origin`) still works, as do `curl`/test requests that send neither header.
- [ ] It covers every dashboard `POST` route, including the Users portal and `/voice/token`, with one hook rather than a check in each route.
- [ ] Tests through `buildServer` cover a cross-site post to `/users/:id/password` and `/notes/:id/delete` being refused.

## Comments

- Brought up while merging PR #4 (Voice page and dashboard without required login, commit `11dccb1`).
- `/assign` has its own sessions and CSRF handling (task-assignment issue 02) and is not part of this.
