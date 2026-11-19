# 28: Split registerWorkflow into route modules

**What to build:** Behaviour-neutral. Thin handlers move to `routes/owner-tasks.ts`, `routes/owner-lists.ts`, `routes/assignee.ts` and `routes/board.ts` (names are the review's suggestion). Hook scoping from the encoded-path fix is preserved.

**Blocked by:** 26, 03

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 8 route split; Finding 1 `registerWorkflow` is a 268-line function

**Acceptance criteria:**

- [ ] `registerWorkflow` only composes route modules.
- [ ] No file in the module exceeds a size the maintainer sets; no single handler contains page markup beyond a render call after the views ticket.
- [ ] Existing tests pass unchanged in behaviour, and the architecture boundary test (ADR 0006: nothing imports into or out of `src/assign/` from core, Telegram, dashboard) still passes.
