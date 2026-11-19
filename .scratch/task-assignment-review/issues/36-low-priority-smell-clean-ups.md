# 36: Low-priority smell clean-ups

**What to build:** Small, optional, behaviour-neutral items: `deadlineFrom` returns a Result rather than `Date | null | "invalid"`; a `routes.ts` path builder; rename `removedTask` to `markTaskRemoved` and clarify `ownerOf`/`currentOwner`/`requireOwner`; one-line "why" comments for the 248 cutoff, atomic reservation, 30 s grace, rollbacks and the bot regex; Fastify route generics instead of `as` casts; `Map` lookups in the feed and Board instead of `find` in `map` (and no `new ObjectId()` sentinel); `stream()` in `sse.ts` split into `replayMissed()` and `eventPayload()`; "Unassigned Tasks", "Draft Lists" and "Workspace" added to GLOSSARY.md or reworded.

**Blocked by:** 28

**Status:** needs-triage

**Severity:** Low

**Source:** [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Findings 6 (deadline Result, `routes.ts`), 11 Mysterious Name, 13 comments, 15 casts and O(n^2) lookups, 16 `sse.ts` structure, 18 glossary terms

**Acceptance criteria:**

- [ ] Each bullet is done or explicitly dropped by the maintainer.
- [ ] Existing tests pass unchanged in behaviour, and the architecture boundary test (ADR 0006: nothing imports into or out of `src/assign/` from core, Telegram, dashboard) still passes.
