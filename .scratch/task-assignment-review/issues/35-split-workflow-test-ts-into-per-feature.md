# 35: Split workflow.test.ts into per-feature files with shared helpers

**What to build:** The 819-line single-describe `workflow.test.ts` is split into `lists`, `deadline`, `sse`, `removed-tasks`, `status` test files with `test/assign/helpers.ts` (`browser`, `seedTasks`, `openStream`, `activeCode`). Markup `toContain` assertions use selectors (role, `data-testid` or a small HTML parser) so they survive template changes.

**Blocked by:** 30

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 17 Tests; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Refactoring plan step 5 (test split)

**Acceptance criteria:**

- [ ] All 50 existing tests still run, now in per-feature files.
- [ ] Shared helpers live in one module.
- [ ] Markup assertions are selector-based.
