# 26: Extract domain operations out of workflow.ts

**What to build:** Behaviour-neutral. Move `statusChange`, `syncCompletion`, `removedTask`, `assignList`, `addTasks`, deadline and tag parsing, and user-agent classification into `tasks.ts`, `lists.ts`, `assignments.ts` and `analytics.ts`, all under `src/assign/` (ADR 0006). Add cheap unit tests for the pure parts (`deadlineFrom`, `tagsFrom`, transition table, `classifyUserAgent`, code generator). Do this after the race fixes so the extraction carries the corrected logic.

**Blocked by:** 25

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 8 Divergent Change / God module; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Refactoring plan step 3

**Acceptance criteria:**

- [ ] `workflow.ts` no longer contains domain rules or persistence queries for these operations.
- [ ] Pure functions have unit tests.
- [ ] Existing tests pass unchanged in behaviour, and the architecture boundary test (ADR 0006: nothing imports into or out of `src/assign/` from core, Telegram, dashboard) still passes.
