# 30: Render pages through EJS partials with one render path

**What to build:** Incremental, one page per commit, behaviour-neutral. Replace the HTML template strings in `workflow.ts` with EJS pages and partials (`task-row`, `status-form`, `note-form`, `dialog`, `filters`), unify `render()` and `page()`/`sendPage()`, and use autoescaping `<%= %>` instead of manual `esc()`. The Add Task dialog and `addTaskFailure` share one partial. Reformat the one-line minified `.ejs` files. Update tests that assert on markup strings toward role or `data-testid` selectors as pages move.

**Blocked by:** 28

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 1 Long Function / very long lines; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 2 Inline HTML in TS template strings; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Refactoring plan step 4

**Acceptance criteria:**

- [ ] No page markup is built from template-literal strings in route code.
- [ ] Add Task dialog markup exists once.
- [ ] Manual `esc()` calls are gone from view code.
- [ ] Existing HTTP-seam tests pass, with markup assertions migrated where pages moved.
