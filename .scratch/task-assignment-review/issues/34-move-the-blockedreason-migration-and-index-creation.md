# 34: Move the blockedReason migration and index creation out of openAssignStore

**What to build:** The one-off `blockedReason` to Note migration becomes a versioned, run-once migration instead of running on every start and in every test setup; `ensureIndexes()` is separate and readable. Behaviour for the both/reason-only/note-only/neither cases is unchanged and its tests are kept.

**Blocked by:** 12

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 12 migration runs every start; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 16 `openAssignStore` mixes indexes and data fix; [code-review](../../task-assignment-refresh/reviews/code-review.md) F10 migration notes (unindexed scan on every start)

**Acceptance criteria:**

- [ ] Startup does not scan Tasks for `blockedReason` after the migration has run.
- [ ] Index creation is in its own function.
- [ ] Migration tests still pass.
