# Task assignment module: code-smell and maintainability review

Branch: task-assignment-refresh. Lens: Fowler's catalogue, overridden by AGENTS.md, GLOSSARY.md and ADR 0006 (`0006-task-assignment-as-separate-module-on-mongodb.md`). Read-only review; no source edited.

## Measurements

| File | Lines | Notes |
|---|---|---|
| src/assign/workflow.ts | 423 (62.6 KB) | 42 lines >300 chars, 7 lines >1000 chars, longest ~2,017 (line 167) |
| src/assign/auth.ts | 121 | lines up to ~200 chars, one 35-line function (`currentOwner`) |
| src/assign/store.ts | 24 | types plus indexes plus a legacy migration, 5 lines >300 chars |
| src/assign/sse.ts | 58 | `stream` is 34 lines doing 5 jobs |
| src/assign/index.ts | 53 | CSRF, content parser, purge timer all inline |
| src/assign/views/*.ejs | 11 files | 7 of 11 are 1-line minified (settings 1,401 chars, password-offer 1,085); `board.ejs` is a dead stub; theme.ejs 364 lines CSS plus 1 inline script |
| test/assign/workflow.test.ts | 819 | 50 tests; 14 lines >300 chars; 74 lines >200 |

Counts inside workflow.ts: 24 repeats of the `ownerOf` guard, 11 `textLimit(` calls, 17 `recordEvent(`, 57 `ownerId: owner._id`, 6 `{ $unset: { listId: "" } }`, 22 `active: true/false` assignment filters, 19 hand-written `<a href="/assign...">`, 60 `esc(` calls, 5 `<dialog`, 5 inline `<script` strings.

Note: workflow.ts holds roughly 25 route handlers plus all HTML rendering, domain rules and persistence. It is the single biggest maintainability risk in the module.

---

## Findings

Effort: S under 1 hour, M half a day, L 1 day or more. Priority: P1 high, P2 medium, P3 low.

### 1. Long Function / very long lines: workflow.ts (P1, L)
- `registerWorkflow` (workflow.ts:155-423) is one 268-line function. Its handlers average ~10 lines, but the long ones are 1,000-2,000-character template literals: l.167 `selected` (2,017 chars), l.184 `details` (1,622), l.162 `create` (1,076), l.48 `taskDisclosure` (1,136), l.246 (847), l.357 (792), l.47 (781).
- Why it hurts: no line-level diffs, no syntax highlighting or lint in the HTML, escape mistakes are invisible (every `${}` is a manual `esc()` call, 60 of them), and review of a change to one button means reading a 2 KB line.
- Refactor: move every page to an EJS view (the module already renders EJS in auth and has `login.ejs`/`task-view.ejs`). EJS autoescapes with `<%= %>`, which removes the manual `esc()` discipline. The 1-line minified `.ejs` files (settings, password-offer, confirm-login) should be reformatted at the same time. Done incrementally, one page per commit.
- Effort L (many pages), but mechanical. P1.

### 2. Inline HTML in TS template strings (P1, L; same refactor as 1)
- ~30 page fragments built as strings: page chrome (l.21-27), `statusForm` (l.47), `taskDisclosure` (l.48), `noteForm` (l.49), `confirmDialog` (l.52), `confirmDelete` (l.53), `addTaskFailure` (l.86), plus every route body. `addTaskFailure` (l.86, ~1,016 chars) duplicates the Add Task dialog markup from l.162.
- The module is split between two rendering styles (EJS for auth pages, concatenated strings for everything else) with `render()` in http.ts and `page()`/`sendPage()` in workflow.ts doing the same job differently. That is Duplicated Code at the architecture level.
- Refactor: single `render()`; EJS partials `partials/task-row.ejs`, `status-form.ejs`, `note-form.ejs`, `dialog.ejs`, `filters.ejs`. The dialog and Add Task form become one partial reused by l.162 and l.86.
- Priority P1.

### 3. Inline scripts: workflow.ts:19-20 and views (P2, M)
- `liveScript` (1,672 chars on one line) and `pageScript` (1,808 chars on one line) are JS in TS template strings: no linting, no type check, untestable except through the full HTTP stack. `task-view.ejs` is a pure script file with a misleading `.ejs` extension, and `theme.ejs:331-363` embeds another script inside a CSS partial (mixed concerns, and `taskViewScript`/`themeMarkup` are loaded by `readFileSync` at import time, l.14-16).
- Refactor: put scripts in `views/js/*.js` (live-reload, time formatting, task-view toggle), serve them as static assets or `include()` them raw. Rename `task-view.ejs` and split `theme.ejs` into `theme.css` plus script. Needs a CSP decision (inline scripts block a strict CSP; static files allow `script-src 'self'`).
- P2.

### 4. Duplicated Code
- **Owner guard**: `const owner = await ownerOf(ctx, request, reply); if (!owner) return;` at 24 sites, plus 177-char variants (l.189, 198, 205, 242, 255, 260, 275, 283, 289, 388, 394, 400, 405, 411, 415) that append `ownList`/`ownTask` lookups. Also `requireOwner` preHandler in auth.ts:46 does the same check again, and some auth routes call `requireOwner` and then `currentOwner` again (auth.ts:87, 104, 117), costing two token/DB round trips per request. Fix: Fastify `preHandler` decorates `request.owner`; helper `withOwnedTask(handler)` / `withOwnedList(handler)` to cut each handler by ~3 lines. S-M, P1.
- **Task validation**: `!title || !textLimit(title,200) || !textLimit(instruction,2000) || tags.length>5 || tags.some(...)` copy-pasted at l.173 (create) and l.191 (edit), with the Deadline parse repeated l.174/192. Extract `parseTaskForm(form)` returning `{ok, value} | {error}`. Also kills the divergent error paths (create re-renders via `addTaskFailure`, edit uses `fail`). S, P1.
- **Task attach rollback**: `updateMany({listId...}, {$unset:{listId:""}})` appears 6 times (l.150, 228, 234, 236, 278, 407) with slightly different filters. Extract `detachTasks(ctx, ownerId, listId, ids?)`. S, P2.
- **Revoke assignments**: `assignments.updateMany({..., active:true}, {$set:{active:false, revokedAt, ...}})` at l.130, 290, 406, 417. Extract `revokeAssignments(ctx, filter, reason)`. S, P2.
- **Task note update**: owner and assignee note handlers (l.204-209 vs l.318-320) and owner/assignee status handlers (l.197-203 vs l.308-316) are parallel copies with different auth only. Extract `saveNote()`; `statusChange` is already shared, extend this pattern. S, P2.
- **Add-to-list handlers**: l.259-265 and l.266-273 are near-identical. S, P3.
- **Cookie lifetime and session setup**: `30 * 86_400` and `30 * 86_400_000` in auth.ts:30, 32, 43, 44 and index.ts:32; refresh issuing is copied between `currentOwner` and `startSession`. Extract `issueRefreshToken()`. S, P2.
- **Password minimum**: `password.length < 10` in auth.ts:90 and 105, each with its own message. S, P3.
- **Link-expired / problem-message pages**: `render(..."message", {...})` assembled four times in auth.ts (l.49, 76, 81). Fold into one `showMessage()` helper. S, P3.

### 5. Magic numbers and strings (P1, S)
- 50-Task cap: literal `50` at workflow.ts:143 (twice), 147, 214 (UI hint "up to 50"), 221, plus the error string "A List holds at most 50 Tasks." at l.143 and 148 (duplicated; two lines for one rule). The `$lte: 50 - ids.length` at l.147 is easy to break. Introduce `LIMITS = { tasksPerList: 50, title: 200, text: 2000, tags: 5, ... }` in config.ts or a new `limits.ts`, and interpolate it into UI text.
- Other literals: `200` (title/name/person: 7), `2000` (instruction/note: 10), 5 tags, 500 UA slice (l.326), `840` minutes tz (l.82), 24-char hex and 10-char code regex `{10}` at l.33 and l.71 (code length 10 also at l.129), `248` rejection-sampling cutoff (l.129, undocumented; it is `256 - 256 % 62`), 500-event replay window (sse.ts:35), 20 s heartbeat (sse.ts:43), 30 s refresh grace (auth.ts:14), 900 s JWT TTL (auth.ts:37) and 900_000 ms login token TTL (auth.ts:56, 60, 97), rate limits `5, 900_000` x4, `60, 60_000`, `5, 3_600_000`, 86_400_000 purge (index.ts:50), 90 days retention default (config.ts:25).
- UI messages are scattered as inline strings (≈60 distinct). If localisation is ever needed, extract to a `messages.ts`; for now at least dedupe repeats ("Note is too long." x3, "Task not found." x6+, "Invalid status." x2).
- Refactor: `limits.ts` / `constants.ts`; for time constants name them (`REFRESH_TTL_MS`, `ACCESS_TTL_S`, `LOGIN_LINK_TTL_MS`). S, P1 for the 50-cap and text limits, P2 for the rest.

### 6. Repeated Switches / Primitive Obsession
- **Event kinds**: `EventKind = string` (store.ts:11) while kinds are bare string literals in 17 `recordEvent` calls, a 7-branch `if` chain in the feed `describe` (workflow.ts:370-377), `["assignment.revoke","list.delete","person.delete"].includes` in sse.ts:24 and `"assignment.opened"` in sse.ts:23. Adding an event needs edits in 3 places with no compiler help. Refactor: `type EventKind = "task.create" | ...` plus a `describeEvent: Record<EventKind, (ctx) => string>` map and an `ENDS_ASSIGNEE_STREAM` set. S-M, P1.
- **Task status**: legal transition table is an inline boolean at l.91; `STATUSES` const (l.39) is unused and `["open","blocked","done"].includes` is re-typed at l.200, 314 and `["blocked","done"]` etc. at l.91, while `TaskStatus` is a separate literal union in store.ts. Define `const STATUSES = [...] as const; type TaskStatus = typeof STATUSES[number]` once plus `const TRANSITIONS: Record<TaskStatus, TaskStatus[]>`; parse via `isStatus()`. S, P2.
- **IDs and codes as strings**: `parseId` returns `ObjectId | null`; assignment code, CSRF token, cookie names (`"ta_access"`, `"ta_refresh"`, `"ta_csrf"`, 11 occurrences across 3 files) are raw literals. Export `COOKIES = {...}`. S, P3.
- **Deadline parser** returns `Date | null | "invalid"` (l.73): a three-state primitive that callers compare against string. Return a Result `{ok:true, value}|{ok:false}`. S, P3.
- **Paths**: 19 hand-built `/assign/...` hrefs and routes; a `routes.ts` with `taskPath(id)`, `listPath(id)`, `assigneePath(code)` would remove typos and ease the Shotgun Surgery below. S, P3.

### 7. Shotgun Surgery
- Adding a Task field, e.g. a priority, touches: `TaskDoc` (store.ts:6), the Add form (l.162 and again l.86), create handler (l.172-175), edit form (l.184), edit handler (l.190-194), event `fromValue` JSON (l.194), `taskDisclosure` (l.48), assignee view (l.299-305), and the migrate block if shape changes. 9+ places.
- Adding an event kind: recordEvent call, feed `describe`, sse special-casing, and tests.
- Adding a rate-limited auth route: limits are literals inline.
- Refactor: extract `parseTaskForm`, `TaskForm` partial, event registry (see 4, 6). P2.

### 8. Divergent Change / God module: workflow.ts (P1, L)
- Reasons to change in one file: HTTP routing for 25 routes, HTML/CSS-class markup, input validation, domain rules (status transitions, completion sync, list caps, Additional/Removed Task), persistence queries, list assignment (code generation, rollback), view analytics (UA sniffing l.326-331, bot regex), Board filtering. This is Large Class in module form.
- Refactor within ADR 0006 (everything stays under `src/assign/`, no imports from core/telegram/dashboard): split into
  - `tasks.ts` / `lists.ts` / `assignments.ts` (domain operations: `statusChange`, `syncCompletion`, `removedTask`, `assignList`, `addTasks`; these already are standalone functions at l.89-154),
  - `routes/owner-tasks.ts`, `routes/owner-lists.ts`, `routes/assignee.ts`, `routes/board.ts` (thin handlers),
  - `views/` for markup (see 1-2),
  - `analytics.ts` for `classifyUserAgent()`.
  The existing architecture.test.ts boundary test (test/architecture.test.ts:31-36) uses `reachableImports("src/assign/index.ts")` so it keeps protecting new files automatically.
- Effort L, P1. Do the domain-function extraction first; it needs no behaviour change and is already covered by 50 integration tests.

### 9. Feature Envy and Data Clumps
- Handlers reach into `ctx.store.<collection>` ~100 times with the same filter clump `{ _id: x, ownerId: owner._id }` (57 `ownerId: owner._id`). Each query repeats tenant scoping by hand; one missed `ownerId` is a cross-tenant leak (a real security smell, not just style). Refactor: `ownerScope(ctx, ownerId)` repository returning scoped `tasks.find(id)`, `lists.find(id)` etc. (`ownTask`/`ownList` at l.64-69 are the start of this). M, P1.
- The clump `(ctx, ownerId, listId)` threads through `syncCompletion`, `addTasks`, `assignList`: a `ListRef`/`OwnerCtx` type would shorten signatures. S, P3.
- `deadlineTag`, `overdueTag`, `additionalTag` (l.44-46) are domain predicates (`isOverdue`, `isAdditional`) that live in markup helpers; `overdue` is computed twice (l.44 and 45). Extract `isOverdue(task, now)`. S, P2.
- `taskDisclosure(task, action, now, list, owner=false, noteAction?)` (l.48): 6 positional params including a boolean flag (`owner`) switching behaviour. Flag-argument smell; pass an options object or split owner/assignee partials. S, P2.

### 10. Middle Man / Speculative Generality
- `send` (workflow.ts:156) wraps `sendPage` (l.29) which wraps `page` (l.21): three layers to add `noLogin`. Move `noLogin` into the shared page context. S, P3.
- `redirect` (l.30) vs auth.ts's repeated `reply.code(303).header("location", ...).send()` (7 sites) and `reply.code(302).header(...)` (3 sites; 302 vs 303 is inconsistent: auth uses both). Share `redirect()` through http.ts and decide one status. S, P2.
- `EventKind = string` is a type alias with no information (store.ts:11); `Form = Record<...>|undefined` plus `parseForm`/`field`/`fields` is a reasonable mini-layer but `parseForm` is re-implemented inline in index.ts:37 and :19. `textLimit(text, limit)` (l.59) is a one-line wrapper for `text.length <= limit` used 11 times; either validate once in a schema (zod is already a typical choice) or delete it.
- `consoleMailer` (mailer.ts:3) logs the full message text, which includes the login link: acceptable for dev, but name it `devConsoleMailer` and avoid use in prod (log-leak risk).
- P3.

### 11. Mysterious Name
- Single-letter / opaque: `t`, `l`, `p`, `a` in lambdas (fine locally, but l.351 one 631-char callback uses all four); `won` (l.103) for the atomic-claim result; `first` (l.334); `wrong` (auth.ts:96 is a view-model); `old`/`rawLast`/`last` in sse.ts; `reserved`/`attached` ok. `removedTask` (l.108) is a verb-phrase that is a noun: should be `markTaskRemoved`. `inactiveLink` (l.107) both looks up and renders. `ownerOf` vs `currentOwner` vs `requireOwner`: three near-synonyms, with different failure behaviours (redirect vs null vs preHandler). `STATUSES` is unused. `Params` has `{id, code}` for routes that have only one of them. `field` vs `fields` differ by one letter.
- Refactor: rename and group; document the owner-guard contract. S, P3.

### 12. Dead Code and stubs
- `STATUSES` const at workflow.ts:39: defined, never referenced.
- `src/assign/views/board.ejs`: a 1-line "Your workspace is ready." placeholder with no `render(..., "board")` caller (the Board is built in workflow.ts:343-361). Delete or use.
- `views/style.ejs` (1 line) just includes `theme`; `nav.ejs` is compiled at import (l.15), but `themeMarkup` is read at l.14 and also included by EJS via style.ejs: two code paths load the same CSS.
- store.ts:17-22: the one-off `blockedReason` to `note` migration runs on every `openAssignStore` (every startup, and in every test `beforeEach`). Move to a versioned migration script, run once, then remove. M, P2.
- Verify before removing: `fields`/`parseCookies` exports used outside? (grep before deleting). P3.

### 13. Comments hygiene
- Comments are sparse and mostly good, e.g. sse.ts:22 (why assignee visit is not forwarded), workflow.ts:18 and 51. Gaps: none of the rules with real constraints are explained: the 248 cutoff (l.129), `$lte: 50 - ids.length` atomic reservation (l.147), 30-second refresh-rotation grace (auth.ts:14), the rollback blocks (l.150, 227-231, 234-236), regexp bot list (l.327). Add a one-line "why" to each. The ADR-describing comment lives nowhere in `src/assign/index.ts`. S, P3.
- Test names have drifted from GLOSSARY: "requires a blocked reason" (workflow.test.ts:258) while the term is now a Note (Glossary: "Replaces the former separate blocked reason"). Rename. S, P3.

### 14. Inconsistent error handling (P2, M)
- Three styles: (a) `fail(reply, code, message)` returns HTML (l.35); (b) `addTaskFailure` renders its own page (l.85); (c) auth.ts renders `message` view via `render`; (d) domain functions return `string | null` as error (`statusChange`, `addTasks`, l.89, 142), while `assignList` throws (l.125, 139). Callers mix `try/catch { return fail(500...) }` (l.285) with `if (error) return fail(400, error)`.
- Silent catches: `catch {` x4 in workflow.ts (l.32 `new URL`, l.124 duplicate-key race, l.236, l.285) and auth.ts:79 swallow all errors, not just duplicate-key (E11000). A DB outage looks like "Could not assign" or `owner` null, and nothing is logged. Refactor: discriminate on `error.code === 11000`, rethrow others, log the rest via `request.log`. Introduce a `Result<T, UserMessage>` return type or a typed `UserError` class thrown from domain functions and handled by a single Fastify `setErrorHandler`. M, P2.
- Non-atomic multi-step writes: `removedTask` (l.108-119) does three separate `lists.updateOne` calls ($inc, then $push) that could be one update; `assignList`/`deleteList` have rollback code instead of ordering. ADR 0006 deliberately avoids replica-set transactions, so keep the compensation style but make it uniform (one `compensate()` helper).
- 302 vs 303 in redirects (see 10); status 500 returned for validation-ish failure at l.285.

### 15. Message Chains and Feature misc
- `ctx.store.tasks.find(...).toArray()` chains are fine, but `request.query as {tag?: string}` / `request.params as Params` casts occur 12 times; use Fastify route generics or a schema. `(request.query as { token?: string }).token` (auth.ts:67). S, P3.
- O(n^2) lookups in feed and Board: `lists.find(l => l._id.equals(id))` inside `map` (l.161, 351, 367-369). Cap is small (50), so it is a readability issue more than a perf one: build `Map<string, Doc>` once. S, P3.
- `new ObjectId()` used as a never-matching sentinel (l.367-369: `event.taskId || new ObjectId()`): clever but opaque; use optional chaining on the map. S, P3.

### 16. sse.ts / index.ts / store.ts structure
- `stream()` (sse.ts:11-45) mixes header writing, replay buffering, relevance filtering, revoke detection, heartbeat and cleanup; extract `replayMissed()` and `eventPayload()`. `send()` at l.8-10 is a 1-line 330-char writer. M, P3.
- `index.ts`: CSRF handled by three hooks that regex-inject `<input name=csrf>` into HTML via `payload.replace(/(<form...method="post"...>)/gi)` (l.44). This is brittle (it breaks on `method=post` without quotes, single quotes, or `<form` in a code sample) and a hidden coupling between templates and plugin. With EJS partials, emit the token explicitly (`<%- csrf() %>`). Move CSRF to its own `csrf.ts`. M, P2.
- `openAssignStore` creates 9 indexes in a single 600+ character line and also runs the migration (Divergent Change: schema + data fix in one function). Split `ensureIndexes()` and `migrations/`. S, P3.
- `store.ts` exports 11 document types that are used both as storage shape and as view-model; all fine, but `ListDoc.removedTasks` embedded array has no bound (grows forever, unlike the 50-Task cap). Note as design debt. P3.

### 17. Tests (test/assign/)
- workflow.test.ts is 819 lines with a single top-level describe, 50 tests, 14 lines >300 chars, and its own `browser()` fake-cookie client and helpers defined inside the describe closure. Extract `test/assign/helpers.ts` (`browser`, `seedTasks`, `openStream`, `activeCode`) and split by feature: `lists.test.ts`, `deadline.test.ts`, `sse.test.ts`, `removed-tasks.test.ts`, `status.test.ts`. M, P2.
- Strength: tests go through the HTTP seam (consistent with the project's "deep module" approach) and each does `beforeEach` with a fresh DB, so they are isolated. Weakness: assertions on rendered HTML via `toContain("...")` (58) are coupled to markup, so the template extraction in 1-2 will break many tests; prefer `data-testid` or role-based selectors, or a tiny `$()` helper over `cheerio`/`node-html-parser`.
- Pure logic with no test below the HTTP layer: `deadlineFrom`, `tagsFrom`, status transition table, `classifyUserAgent`, code generator. Once extracted (see 8), unit-test them cheaply. S, P3.
- config.test.ts / login.test.ts / task-view.test.ts: small and clean; no issue.

### 18. Docs and standards observations
- docs/adr has two files numbered 0006 (task assignment and voice assistant). Renumber one (ADR numbering is the repo's own standard). S, P3.
- AGENTS.md requires a WorkLog for every new feature; check that `task-assignment-refresh` has one. Out of scope to fix here.
- GLOSSARY compliance is good in UI text ("Additional task", "Removed", "List", "Person", "Assignee"); minor: UI says "Unassigned Tasks" (l.50) and "Workspace"; "Unassigned Tasks" is not a defined term; "someone" fallback (l.246). Add to GLOSSARY or avoid.

---

## Prioritised refactoring plan (top 5, inside the ADR 0006 boundary)

All new files stay under `src/assign/`; nothing imports from or into the core, Telegram adapter or dashboard, and `test/architecture.test.ts` guards that automatically.

1. **Extract constants and typed enums (S, ~2 h).** `limits.ts` (50 tasks, 200/2000 text, 5 tags, TTLs, rate limits), `COOKIES`, one `STATUSES` + `TRANSITIONS`, a closed `EventKind` union with an event-description map; delete dead `STATUSES`/`board.ejs`. Zero behaviour change, kills 20+ magic literals and the Repeated Switches.
2. **De-duplicate the request plumbing (S-M, ~half a day).** One `request.owner` preHandler, `withOwnedTask/withOwnedList` wrappers, `parseTaskForm` shared by create/edit, `detachTasks`, `revokeAssignments`, shared `redirect`. Shrinks `registerWorkflow` by ~25% and removes the hand-repeated tenant scoping (security smell #9).
3. **Pull domain logic out of workflow.ts (M-L, ~1 day).** Move `statusChange`, `syncCompletion`, `removedTask`, `assignList`, `addTasks`, deadline/tag parsing, UA classification into `tasks.ts`, `lists.ts`, `assignments.ts`, `analytics.ts`; add unit tests for the pure ones. Then split routes into owner-tasks, owner-lists, assignee, board modules.
4. **Move HTML and scripts to views (L, ~1-2 days, incremental).** One page per commit: replace template strings with EJS pages/partials (autoescape), unify `render`/`page`, reformat minified `.ejs`, move `liveScript`/`pageScript`/`task-view` to real `.js` files, replace regex CSRF injection with an explicit helper. Update tests to selector-based assertions as pages move.
5. **Uniform error model and migration hygiene (M, ~half a day).** `UserError`/Result type plus one Fastify error handler; catch only duplicate-key (11000) and log everything else; one redirect status; move the `blockedReason` migration out of `openAssignStore`. Finish by splitting workflow.test.ts into per-feature files with a shared `helpers.ts`.
