# 27: Owner-scoped repository so tenant scoping is not hand-written

**What to build:** Queries go through an `ownerScope(ctx, ownerId)` helper (`tasks.find(id)`, `lists.find(id)` and similar), extending `ownTask`/`ownList`, so a handler cannot forget the Owner filter. The `ListRef`/`OwnerCtx` data clump and the `taskDisclosure` boolean `owner` flag are replaced by a type and an options object. `isOverdue(task, now)` replaces the duplicated overdue computation.

**Blocked by:** 26

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 9 Feature Envy and Data Clumps (the `ownerId` clump is called out as a security smell)

**Acceptance criteria:**

- [ ] No handler writes `{ ownerId: owner._id }` by hand for Task, List or Person lookups.
- [ ] A test shows an Owner cannot read or write another Owner's Task or List through any extracted function.
- [ ] Existing tests pass unchanged in behaviour, and the architecture boundary test (ADR 0006: nothing imports into or out of `src/assign/` from core, Telegram, dashboard) still passes.
