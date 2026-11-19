# 24: Extract limits, cookie names, statuses and event kinds; delete dead code

**What to build:** Behaviour-neutral. One module holds the named limits (50 Tasks per List, 200/2000 text, 5 tags, TTLs, rate-limit numbers), `COOKIES`, a single `STATUSES` with a `TRANSITIONS` table, and a closed `EventKind` union with a description map and an assignee-stream-ending set, so adding an event or status is a compile-checked change. UI hints interpolate the limits. Dead `STATUSES` const and the unused `views/board.ejs` stub are removed (grep for `fields`/`parseCookies` outside use before deleting).

**Blocked by:** 01, 04

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 5 Magic numbers and strings; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 6 Repeated Switches / Primitive Obsession; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 12 Dead code (`STATUSES`, `board.ejs`) and refactoring plan step 1

**Acceptance criteria:**

- [ ] No literal `50`, `200`, `2000`, cookie-name strings, or event-kind strings remain outside the constants module (except in tests).
- [ ] `EventKind` is a closed union; the feed `describe` and SSE ending kinds are driven from it.
- [ ] Existing tests pass unchanged in behaviour, and the architecture boundary test (ADR 0006: nothing imports into or out of `src/assign/` from core, Telegram, dashboard) still passes.
