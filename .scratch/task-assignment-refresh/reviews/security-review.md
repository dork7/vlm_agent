# Security review: Task assignment module (branch task-assignment-refresh)

Scope: `src/assign/*` (auth, workflow, sse, store, config, crypto, http, index, mailer, rate-limit, events, housekeeping, views/*.ejs), `.env.example`, mounting in `src/main.ts` / `src/server.ts`. Static review plus throwaway in-process Fastify `inject` probes (scratchpad only; no repo files changed). Dependencies were reviewed by reading `package.json` only; `npm audit` was not run (it would send the dependency list to an external service).

## Summary

The module is in good shape on the fundamentals: every Owner query is scoped by `ownerId`; Assignee writes are bound to `{ownerId, listId}` of the link; magic-link tokens are 256-bit, hashed, single-use and 15 minutes; link codes are ~59.5 bits with unbiased generation; output escaping is consistent; form bodies are reduced to strings so `$`-operator injection through forms is not possible.

Real weaknesses found, in order of importance:

1. **CSRF and `/l/` rate-limit protections are bypassed by a percent-encoded path** (`/%61ssign/...`), because the hooks use `request.url.startsWith("/assign")` on the raw URL. Verified by probe. (High/Med)
2. **Magic links are printed to stdout when `RESEND_API_KEY` is unset**, with no production guard. Anyone who can read logs can log in as any email. (Medium)
3. **Rate limiting is unsound behind a proxy** (`trustProxy` is all-or-nothing, so either one shared bucket for everyone or spoofable IPs), and the limiter map is never pruned (memory growth). (Medium)
4. **`argon2Sync` blocks the event loop** (~31 ms per verify, measured) and password-login has no per-IP limit. (Medium)
5. **No security headers at all** (no CSP, X-Frame-Options, Referrer-Policy, nosniff, Cache-Control). Clickjacking on state-changing pages and on bearer-secret URLs. (Medium)
6. **SSE streams outlive logout / logout-all / session revocation**, and an abort during replay can leak a hub listener and heartbeat timer. (Low/Med)
7. Assorted Low/Info items below.

No Critical findings. No XSS found in the paths reviewed.

---

## Findings

### F1. CSRF protection, CSRF cookie issuance and `/l/` rate limit skipped by percent-encoded path
- **Severity:** High (Medium if you weigh the SameSite=Lax mitigation) | **Confidence:** High (reproduced)
- **Where:** `src/assign/index.ts:27-28` (`request.url.startsWith("/l/")`, `startsWith("/assign")`), `index.ts:35` (CSRF preHandler), `index.ts:42` (onSend token injection); also `auth.ts:9` noLogin check.
- **Issue:** find-my-way decodes `%61` to `a` when routing, but `request.url` stays raw. Probe results: `POST /assign/logout` returned 403 (CSRF enforced), `POST /%61ssign/logout` returned 303 (route executed, CSRF check skipped). `GET /%6c/AAAAAAAAAA` 70 times never hit the 429 that `/l/AAAAAAAAAA` hits after 60 requests.
- **Impact:** (a) Login CSRF is reachable: a cross-site form posting to `/%61ssign/password-login` (no cookies needed) signs the victim into the attacker's account. (b) For authenticated POSTs the only remaining defence is SameSite=Lax, so any same-site context (sibling subdomain, or a browser that treats the request as same-site) can forge Owner actions (delete List, revoke, add Task, change password). (c) The per-IP `/l/` limiter, the only brute-force throttle on link codes, is bypassable (still ~2^59 space, so not practically exploitable, but the control is void). noLogin mode fails closed (falls through to cookie auth), so no auth bypass.
- **Remediation:** Do not gate on URL prefixes. Put Owner routes in a nested plugin (`app.register(ownerScope, { prefix: "/assign" })`) with the hooks added inside it, and the Assignee routes in another with its own limiter hook; or use `request.routeOptions.url` / `request.routeOptions.config` (the matched route pattern) instead of `request.url`. Add a regression test that POSTs `/%61ssign/logout` and expects 403.

### F2. Magic-link emails are logged to the console by default
- **Severity:** Medium | **Confidence:** High
- **Where:** `src/main.ts:79` (falls back to `consoleMailer()` whenever `RESEND_API_KEY` is empty), `src/assign/mailer.ts:3`.
- **Issue:** With `SIGNUP_MODE=open` and no Resend key, `/assign/login` prints `Log in: <publicUrl>/assign/auth?token=...` to stdout. The server's request logger redacts the token (`src/server.ts:15`) but this console.log does not. The `.env.example` lists RESEND_API_KEY as optional with no warning.
- **Impact:** Anyone with access to process logs (log aggregators, shared hosts, CI output) can take over any account by requesting a link for the victim's email and reading the log. Also, a misconfigured production deploy silently sends no email and leaks links.
- **Remediation:** Allow `consoleMailer` only when `PUBLIC_URL` is loopback (or an explicit `ASSIGN_DEV_MAILER=true`); otherwise throw `AssignConfigError` at startup. Never print the token at info level in production.

### F3. Rate limiting: proxy handling, unbounded memory, per-email-only password limit
- **Severity:** Medium | **Confidence:** High (code), Medium (deployment impact)
- **Where:** `src/assign/rate-limit.ts:1-9`; `src/assign/config.ts:30` (`trustProxy: boolean`); `src/server.ts:13`; `auth.ts:56,76,97`; `index.ts:27`.
- **Issues:**
  1. `ASSIGN_TRUST_PROXY=false` behind a reverse proxy makes `request.ip` the proxy for everyone: login is limited to 5 requests per 15 minutes in total (`ip:` key), signup 5/hour in total, and `/l/` to 60/minute in total across all Assignees. One attacker can lock everyone out. `true` makes Fastify trust any `X-Forwarded-For` hop, so a client can spoof its IP and defeat every per-IP limit.
  2. The `attempts` Map is never pruned. Keys are attacker-chosen (`email:<anything>`, `password:<anything>`), so unauthenticated requests grow memory without bound.
  3. `password:${email}` is the only password-login limit: an attacker can lock out a victim's password login (5 bad attempts per 15 min) and can spray many accounts with no global cap.
  4. Login/auth limits live in process memory (reset on restart, not shared across instances).
- **Remediation:** Accept a hop count or CIDR list for `trustProxy` (Fastify supports a number or list) and document it. Prune expired keys (periodic sweep or per-key delete when the window empties, plus a max-size cap). Add an IP limit on `/assign/password-login` and a global cap; consider a lockout that does not hard-block the legitimate user (e.g. increasing delay).

### F4. Synchronous argon2 on the event loop; password-login timing and DoS
- **Severity:** Medium (Low for the enumeration part) | **Confidence:** High (measured ~31 ms per verify)
- **Where:** `src/assign/crypto.ts:27,34` (`argon2Sync`), `auth.ts:94-101`, `auth.ts:91,105`.
- **Issue:** Each hash/verify blocks the single Node thread (shared with the Telegram bot, reminder scheduler, dashboard and Inventory API) for ~30 ms. `verifyPassword` runs only when the account exists and has a password, so response time distinguishes "no such account / no password" from "has a password" (enumeration oracle; the 400 message is otherwise identical). Passwords have no maximum length. Parameters themselves (argon2id, m=19456 KiB, t=2, p=1) match the OWASP minimum.
- **Impact:** With a list of known emails, ~5 attempts per account per 15 minutes each cost 30 ms of whole-process stall; account existence leaks via timing.
- **Remediation:** Use async `crypto.argon2` (promisified, runs on the threadpool). Run a dummy verify against a fixed hash when the account or hash is missing. Cap password length (e.g. 128 chars). Consider raising memory/passes if capacity allows.

### F5. No security headers or CSP
- **Severity:** Medium | **Confidence:** High (probe response headers: only content-type, set-cookie, content-length, date, connection)
- **Where:** global; nothing in `src/server.ts` or `src/assign/index.ts`. Inline `onclick` handlers (`workflow.ts:86,162,167`) and inline `<script>` blocks (`workflow.ts:19,20,167,184,305`, `theme.ejs:331`, `task-view.ejs`) mean a strict CSP currently cannot be adopted without refactoring.
- **Impact:**
  - Clickjacking: no `X-Frame-Options` / `frame-ancestors`, so Owner pages with one-click destructive buttons (Delete List, Revoke link, Sign out everywhere) and Assignee pages can be framed.
  - No CSP means any future escaping slip becomes full XSS with no second line of defence.
  - No `Referrer-Policy`: the secret code in `/l/CODE` and the magic token in `/assign/auth?token=` can go out in `Referer` if a page ever links off-site.
  - No `Cache-Control: no-store` on authenticated pages and `/l/` pages (shared devices, back button, proxies).
  - No `X-Content-Type-Options`, no HSTS (set at the proxy if TLS terminates there).
- **Remediation:** Add an onSend hook (or `@fastify/helmet`) for the assign scope: `Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'nonce-...'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on `/assign/*` and `/l/*`, HSTS when `secureCookies`. First step: move the inline scripts to nonce'd blocks and replace `onclick="this.closest('dialog').close()"` with the existing delegated handler pattern (`data-` attributes).

### F6. SSE streams are not tied to session or link lifetime; possible listener leak
- **Severity:** Low/Medium | **Confidence:** Medium (logic read; leak race not reproduced)
- **Where:** `src/assign/sse.ts:43-44` (heartbeat and `close` listener registered after the `await`s at lines 33-38), `sse.ts:47-51`, `events.ts:7` (`setMaxListeners(0)`).
- **Issues:**
  1. `/assign/events` authenticates only at connect. After logout, "sign out everywhere", password change or refresh-token reuse detection, an open stream keeps delivering Owner activity summaries (task titles, person names) until the socket closes.
  2. When `Last-Event-ID` is sent, the stream awaits DB queries (lines 33-38) before registering `reply.raw.on("close", ...)`. A client that disconnects during that window never triggers cleanup, leaving a `hub` listener and a 20 s heartbeat interval alive for the life of the process (the hub listener count is unbounded: `setMaxListeners(0)`).
  3. No cap on concurrent streams per Owner or per link; `/l/:code/events` is only covered by the per-IP `/l/` limiter (which F1 bypasses).
  4. Assignee streams subscribe to the Owner's whole event channel and filter server-side by `listId` (`sse.ts:15,23`). The filter is correct today (only events with the List's `listId` pass), but one missing `listId` on a future event kind that carries a `summary` would leak across Lists.
- **Remediation:** Register the `close` handler (and heartbeat) immediately after hijack, before any await. Re-check session validity on the heartbeat tick (or close streams on logout via the hub) for Owner streams. Cap concurrent streams per owner/code. Prefer a per-List channel key (`ownerId:listId`) so isolation does not depend on a filter.

### F7. Password can be set or changed without the current password or recent auth
- **Severity:** Low | **Confidence:** High
- **Where:** `src/assign/auth.ts:86-93` (password-offer), `auth.ts:103-109`.
- **Issue:** A stolen session (or a brief unattended device) can set a persistent password, giving the attacker a credential that survives "sign out everywhere" (that action does not clear `passwordHash`). Password change does revoke all sessions, which is good.
- **Remediation:** Require the current password (or a fresh magic link / re-auth within N minutes) to set or change a password; email the Owner on password set/change.

### F8. Account enumeration and mail-abuse details on `/assign/login`
- **Severity:** Low | **Confidence:** Medium
- **Where:** `src/assign/auth.ts:53-65`.
- **Issues:**
  - The response body is uniform, but `mailer.send` is awaited only for eligible addresses, so latency differs for allowlist/known vs unknown addresses, and a Resend failure turns into a 500 only for eligible addresses (oracle in allowlist mode).
  - The email regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`) accepts `Bob<me@evil.test>` (verified: a mail was sent and an account would be created under that literal address). Resend parses `to` as an address with an optional display name, so the attacker controls only their own recipient, but the stored identity is not a clean address and display-name text is attacker-chosen.
  - Multiple unused login tokens stay valid concurrently (up to 5 per 15 minutes), and they are not invalidated by a newer link or by a successful login.
- **Remediation:** Queue the send (fire-and-forget with error logging) so timing and status are uniform. Validate with a stricter pattern (reject `<>,;"` and quotes) and normalise. Invalidate older unused tokens for the same email on issue/consume.

### F9. Cookie scoping and session lifetime
- **Severity:** Low | **Confidence:** High
- **Where:** `src/assign/auth.ts:37` (`ta_access` has no `path`, so it defaults to `/`), `auth.ts:30,43` (refresh expiry), `http.ts:10-14`, `index.ts:32`.
- **Issues:**
  - `ta_access` is sent to every route on the host (dashboard, Inventory API, `/l/*`). It is a signed bearer token whose scope should be `/assign`. (`/l/*/view` and the Owner-vs-Assignee view counting rely on it being visible there: `workflow.ts:328`; if you scope it to `/assign` the owner-exclusion no longer works, so that check needs another mechanism.)
  - Refresh tokens slide forever (each rotation issues a fresh 30-day token in the same family); there is no absolute session lifetime.
  - Cookies are not `__Host-` prefixed; the CSRF token is a plain double-submit cookie (not signed or bound to the session) compared with `!==` (non-constant time), so cookie injection from a sibling subdomain defeats it.
  - Rotation race: parallel requests within the 30 s grace each mint a new refresh token in the same family (all remain valid).
  - Reuse detection (`auth.ts:14-17`) revokes all of the Owner's sessions on any stale-cookie request older than 30 s, which is the right security call, but legitimate stale tabs can trigger it.
- **Remediation:** Add an absolute session cap (e.g. 90 days), bind the CSRF token with an HMAC of the session id (or use a signed token), use `__Host-` names where the path allows, and compare with `timingSafeEqual`.

### F10. Assignee `POST /l/:code/*` has no CSRF token; unauthenticated write amplification on `/l/:code/view`
- **Severity:** Low | **Confidence:** High
- **Where:** `src/assign/index.ts:28,35` (CSRF only for `/assign`), `workflow.ts:308-323,324-342`.
- **Issue:** By design the 10-char code is the credential, so classic CSRF needs the secret and an attacker holding it can POST directly. Residual: (a) anyone with the code can insert unlimited `ta_views` rows (each up to 500 bytes of user-agent), limited only by the (bypassable) per-IP limiter and the 90-day purge; (b) `statusChange`/note writes accept any content-type; (c) view counting trusts `User-Agent` for bot detection (trivially spoofed, cosmetic).
- **Remediation:** Cap rows per assignment per day (or coalesce into one doc); accept the design but document that the code is a bearer secret; the F1 fix restores the limiter.

### F11. Link-code handling (revoked links, storage, referrer)
- **Severity:** Info/Low | **Confidence:** High
- **Where:** `workflow.ts:106-107,129,294-306`; `sse.ts:52-57`.
- **Notes:** Codes are 10 chars of base62, unbiased rejection sampling (`byte < 248`), unique index, ~59.5 bits: infeasible to guess. Revoked, replaced and never-existed codes all show the same page except that "replaced" only appears for codes that did exist (only reveals something to someone who already held the code). Inactive pages return HTTP 200 (SSE returns 404): harmless. Codes are stored in plaintext in `ta_assignments` (a database read gives access to every list; hashing is not possible because the Owner UI re-displays the link). The `fail()` back link and `/l/CODE` URLs have no `Referrer-Policy` (see F5).

### F12. `backPath` can emit a protocol-relative URL
- **Severity:** Low (practically unexploitable) | **Confidence:** Medium
- **Where:** `src/assign/workflow.ts:31-34`.
- **Issue:** The Referer pathname is echoed into `href` after checking only that the host matches. A Referer path starting with `//` would render `href="//evil.test/..."`. The attacker would need the victim to have navigated from a same-host URL such as `https://app//evil.test/x`, which does not render any app page, so exploitation is far-fetched. HTML escaping is applied.
- **Remediation:** Require `pathname.startsWith("/") && !pathname.startsWith("//")` and prefer an allow-list of known path shapes.

### F13. Unbounded growth and DoS surface
- **Severity:** Low | **Confidence:** Medium
- **Where:** `workflow.ts:160,213,243,346,364` (`.find({ownerId}).toArray()` with no limit); `store.ts:15-16` (events: global unique `seq`, no TTL; `purgeOld` does not purge events); `index.ts:16-22` (urlencoded body, default 1 MB limit); `config.ts:26`; open signup (`SIGNUP_MODE=open`, default).
- **Issues:** The 50-Task cap applies to Lists only. Tasks, Lists, People, events per Owner are unbounded, and every page loads them all into memory. Open signup (5 new accounts per IP per hour, bypassable via F3) lets anyone create accounts and fill the database. The global `events.seq` counter is a single hot document and its values leak global activity volume across tenants (visible in SSE `id:`).
- **Remediation:** Per-Owner quotas (tasks, lists, people), pagination on the Tasks/Board/People pages, TTL index on `ta_events` (e.g. 90 days), and consider `SIGNUP_MODE=allowlist` as the production default.

### F14. `noLogin` mode weaknesses
- **Severity:** Low (local-only) | **Confidence:** Medium
- **Where:** `src/assign/config.ts:11,19`; `auth.ts:9`; `.env.example` (`ASSIGN_NO_LOGIN`).
- **Notes:** The guard checks `PUBLIC_URL` hostname and `HOST`, but not the actual bind address (HOST empty means the app default, currently 127.0.0.1) and not a tunnel/reverse proxy that forwards to localhost (ngrok, cloudflared, Caddy on the same host expose an unauthenticated Owner UI). There is no Host-header validation, so DNS rebinding from a malicious page can reach `/assign` as the local owner and read the CSRF token. A hard-coded placeholder JWT secret is used.
- **Remediation:** Refuse noLogin when `NODE_ENV=production`, validate the `Host` header against `PUBLIC_URL` in noLogin mode, and log a loud startup warning.

### F15. Miscellaneous (Info)
- `src/assign/index.ts:16-22`: the urlencoded parser builds a plain `{}` and assigns `form[key]`; a `__proto__=a&__proto__=b` body sets that object's prototype to an array. It does not pollute `Object.prototype` and no code reads inherited keys, but use `Object.create(null)` or a `Map`.
- `src/assign/workflow.ts:193`: editing a Task via the form with no deadline input clears the existing deadline (`$unset: { deadline }`). Functional rather than security, but it is an owner-only field and a blank form from an older cached page silently deletes it.
- `src/assign/workflow.ts:365`: `GET /assign/feed` mutates state (`lastSeenEventId`), so a cross-site GET (`<img src>`) can mark activity as read. Trivial impact.
- `src/assign/housekeeping.ts`: the purge deletes expired token rows but not revoked ones before expiry (fine).
- Repository hygiene: `encrypted(3).fhc` (85-byte opaque file), `.run-local.mts`, `.DS_Store`, `skills-lock.json` and a second lockfile (`yarn.lock` next to `package-lock.json`) are untracked and not ignored; make sure none is committed (the `.fhc` file in particular). Two lockfiles make dependency auditing ambiguous.
- `.env.example` ships working-looking defaults for the wider app that must not reach production: `LIVEKIT_API_KEY=devkey` / `LIVEKIT_API_SECRET=secret`, and the notes say `ADMIN_PASSWORD` defaults to `changeme` when blank. `ASSIGN_JWT_SECRET` is correctly blank, but only length >= 32 is enforced (no entropy check); add a note: generate with `openssl rand -base64 48`.
- Dependencies (read only): `ejs ^3.1.10` is past the known RCE advisories and `renderFile` is never given request-controlled option keys; `fastify ^5`, `mongodb ^7`. Run `npm audit --omit=dev` in CI.

---

## Checked and OK

- **Magic-link tokens:** 32 random bytes (`randomBytes`), stored as SHA-256 (`auth.ts:60`), expiry 15 min, single use through atomic `findOneAndUpdate` with `usedAt: {$exists:false}` (`auth.ts:72`), link built from configured `PUBLIC_URL` (not the Host header), GET is non-consuming (confirm page) so mail scanners do not burn the link, token redacted in request logs (`server.ts:15`, `/assign/auth` log level silent).
- **Session fixation / token handling:** new family and refresh token on every login; access JWT is HMAC-SHA256 with `timingSafeEqual`, `exp` checked, header ignored (no `alg` confusion), and also validated against a live, unrevoked refresh family in the DB on each request, so logout and revocation are immediate for HTTP. Refresh tokens are hashed at rest and rotated; stale-token reuse revokes all sessions. Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL` is https, refresh scoped to `/assign`. Logout and logout-all clear cookies and revoke server-side; password change revokes all sessions.
- **Password storage:** argon2id with per-password 16-byte salt, OWASP-minimum parameters, constant-time compare, minimum length 10.
- **Authorization / IDOR:** every Owner read and write filters by `ownerId` (`ownTask`, `ownList`, `people.findOne({_id, ownerId})`, all `updateOne`/`deleteOne` include `ownerId`). `addTasks`, `/assign/lists`, `/remove` verify the Tasks belong to the Owner and the List. Assignee routes resolve the assignment from the code, then require `{_id, ownerId: assignment.ownerId, listId: assignment.listId}` for the Task (`workflow.ts:311,319`), so an Assignee cannot touch another List's Tasks. Deadline is only editable on the Owner edit route; Assignee routes only change status and note. Status transitions are validated server-side (`statusChange`).
- **CSRF on `/assign` POSTs (when path is not encoded):** double-submit cookie plus `x-csrf-token`/`csrf` field enforced in `preHandler` for all non-GET methods, including login, password-login, auth, logout, settings. Verified 403 on `/assign/logout` without token. (See F1 for the bypass.)
- **XSS / HTML injection:** all user-controlled strings (titles, names, notes, instructions, tags, list names, query params `tag`/`person`/`status`, error messages, feed text) pass through `esc()` (`ejs.escapeXML`, which escapes `& < > " '`) in both text and attribute contexts, including `addTaskFailure` value attributes and the `fail()` message. `<%= %>` is used in all EJS views. SSE payload is `JSON.stringify` and the client renders via `textContent`. Inline scripts interpolate only the constant `live` path (via `JSON.stringify`) or the code that was validated against `^[A-Za-z0-9]{10}$` / found in the DB. ObjectIds in markup come from DB documents. Dates render from `toISOString()`. `confirmDialog` message argument is built only from counts. The one HTML-bearing message path (`confirmDelete`) escapes the Person name.
- **NoSQL injection / mass assignment:** the urlencoded parser yields only `string | string[]`; `field()`/`fields()` drop non-strings, so JSON bodies with `{ "$ne": "" }` values are ignored (probe: JSON email object returned 400); `?tag[$ne]=x` is not parsed into an object and the value is wrapped in `String()`; ids go through `parseId` (24-hex) before `ObjectId`; link `code` is a path param (always a string). Documents are built field by field (no spreading of request bodies).
- **Open redirects:** all `Location` headers are constants or built from server-side ids (`workflow.ts`, `auth.ts`); only `backPath` echoes a Referer path (F12, escaped, same host).
- **Link codes:** 10-char base62, unbiased generation from `randomBytes`, unique index, regex validation before lookup, revoked/replaced/unknown pages carry no list data, `X-Robots-Tag: noindex` and a `noindex` meta, `/l/*` routes silenced in logs and URLs redacted in the logger.
- **Assignee data exposure:** the Assignee page shows only its List's Tasks, the Person name, removed-Task titles and the Owner-written notes; SSE events for an Assignee are filtered by `listId` and revoke/delete events close the stream.
- **Input size limits:** title 200, instruction/note 2000, tags 5 x 30, list/person name 200, email 254, 50-Task cap enforced with an atomic `taskCount` reservation (`workflow.ts:147`); body limit is Fastify's 1 MB default.
- **EJS data injection:** `render()` is only ever called with explicit data objects, never request-derived option bags.
- **Config validation:** JWT secret >= 32 chars, `PUBLIC_URL` must be an http(s) origin, `SIGNUP_MODE` validated, `MAIL_FROM` required with `RESEND_API_KEY`, secrets are not logged by the module (apart from F2). Resend API key only sent to `api.resend.com`.
- **Hook scoping:** `assignRoutes` is not wrapped in `fastify-plugin`, so its hooks do not touch the dashboard, Inventory or Telegram webhook routes.
