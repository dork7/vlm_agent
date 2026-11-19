# 25: De-duplicate request plumbing in the workflow routes

**What to build:** Behaviour-neutral. A single owner `preHandler` decorates the request (no double token/DB round trip from `requireOwner` plus `currentOwner`), `withOwnedTask`/`withOwnedList` wrappers remove the repeated guard, `parseTaskForm` is shared by create and edit, and helpers exist for `detachTasks`, `revokeAssignments`, shared note save, refresh-token issue and one `redirect()` (resolve 302 vs 303). `registerWorkflow` shrinks by roughly a quarter.

**Blocked by:** 24

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 4 Duplicated Code; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 10 Middle Man (redirect helpers); [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Refactoring plan step 2

**Acceptance criteria:**

- [ ] Owner guard code appears once, not 24+ times.
- [ ] Create and edit Task share one validator and the same error path.
- [ ] Detach, revoke and redirect logic each live in one helper.
- [ ] Existing tests pass unchanged in behaviour, and the architecture boundary test (ADR 0006: nothing imports into or out of `src/assign/` from core, Telegram, dashboard) still passes.
