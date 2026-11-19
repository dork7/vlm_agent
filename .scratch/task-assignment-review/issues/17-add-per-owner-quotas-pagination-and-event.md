# 17: Add per-Owner quotas, pagination and event retention

**What to build:** Owners have quotas on Tasks, Lists and People; Tasks, Board and People pages paginate instead of loading everything; `ta_events` has a retention TTL; view rows per Assignment are capped or coalesced per day. The global event sequence no longer leaks cross-tenant activity volume to SSE `id:` values. The production default for `SIGNUP_MODE` is reviewed. This is a larger design change than most Low items; the maintainer should confirm quota values.

**Blocked by:** None

**Status:** needs-triage

**Severity:** Low

**Source:** [security-review](../../task-assignment-refresh/reviews/security-review.md) F13 Unbounded growth and DoS surface; [security-review](../../task-assignment-refresh/reviews/security-review.md) F10 residual: unlimited `ta_views` rows per Assignment; [code-smells](../../task-assignment-refresh/reviews/code-smells.md) Finding 16 note: `ListDoc.removedTasks` is unbounded (design debt)

**Acceptance criteria:**

- [ ] Creating past a quota returns a clear message.
- [ ] Tasks, Board and People pages page their results.
- [ ] Events older than the retention window are purged by housekeeping.
- [ ] Repeated `/l/:code/view` calls do not create unbounded rows.
- [ ] Covered by tests through the existing HTTP workflow test seam.
